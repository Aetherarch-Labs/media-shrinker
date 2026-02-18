import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { getTargetDimensions } from '../lib/resolution';

interface TranscoderState {
  isLoaded: boolean;
  isTranscoding: boolean;
  progress: number;
  error: string | null;
}

interface QualityEstimate {
  score: number; // 0-100, higher is better
  level: 'excellent' | 'good' | 'fair' | 'poor' | 'very-poor';
  bitratePerPixel: number; // bits per pixel per second
  estimatedQualityLoss: number; // percentage of quality loss (0-100)
}

interface UseTranscoderReturn extends TranscoderState {
  load: () => Promise<void>;
  transcode: (
    file: File,
    targetSizeMB: number,
    removeAudio?: boolean,
    optimizeAudio?: boolean,
    outputResolution?: 'original' | '1080p' | '720p' | '480p',
    inputWidth?: number,
    inputHeight?: number
  ) => Promise<string | null>;
  clearError: () => void;
  getVideoDuration: (file: File) => Promise<number>;
  getRecommendedTargetSize: (durationSeconds: number) => number;
  getQualityBasedRecommendations: (
    durationSeconds: number,
    inputWidth?: number,
    inputHeight?: number
  ) => number[];
  validateTargetSize: (
    durationSeconds: number,
    targetSizeMB: number
  ) => { valid: boolean; minSizeMB?: number; recommendedSizeMB?: number };
  estimateQuality: (
    targetSizeMB: number,
    durationSeconds: number,
    inputWidth?: number,
    inputHeight?: number,
    removeAudio?: boolean,
    optimizeAudio?: boolean,
    outputResolution?: 'original' | '1080p' | '720p' | '480p'
  ) => QualityEstimate;
}

const FFMPEG_VERSION = '0.12.9';
// Self-hosted paths (same-origin) - required for COEP: require-corp; CDN fetches fail without CORP
const SELF_HOSTED_BASE = '/ffmpeg';
const CDN_BASE_UNPKG = `https://unpkg.com/@ffmpeg/core-mt@${FFMPEG_VERSION}/dist/esm`;
const CDN_BASE_JSDELIVR = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${FFMPEG_VERSION}/dist/esm`;

/**
 * Custom hook for FFmpeg transcoding operations.
 * Handles loading the FFmpeg WASM core and transcoding video files.
 * 
 * @returns Transcoder state and methods
 */
export function useTranscoder(): UseTranscoderReturn {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isTranscoding, setIsTranscoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Loads the FFmpeg WASM core (multi-threaded version).
   * Uses toBlobURL to convert CDN URLs to blob URLs, avoiding MIME type issues.
   */
  const load = useCallback(async () => {
    // If already loaded, return early
    if (isLoaded && ffmpegRef.current) {
      return;
    }

    try {
      setError(null);

      // Check if SharedArrayBuffer is available (required for multi-threading)
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error(
          'SharedArrayBuffer is not available. ' +
          'This usually means Cross-Origin Isolation headers are not set correctly. ' +
          'Make sure you are accessing the app via localhost (not file://) and that ' +
          'the server is configured with COOP: same-origin and COEP: require-corp headers.'
        );
      }

      // Create FFmpeg instance if it doesn't exist
      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
      }

      const ffmpeg = ffmpegRef.current;

      // Set up progress handler
      ffmpeg.on('progress', ({ progress: prog }) => {
        // Progress is a value between 0 and 1
        // Time is the current processing time in seconds
        if (typeof prog === 'number' && !isNaN(prog)) {
          setProgress(Math.max(0, Math.min(1, prog))); // Clamp between 0 and 1
        }
        // Removed verbose progress logging - only update state, not console
      });

      // Set up log handler - only log errors and critical warnings
      // Note: This handler runs for ALL FFmpeg operations, including transcoding
      // The transcode() function adds its own handler that parses progress
      ffmpeg.on('log', ({ message }) => {
        // Filter out common non-critical warnings and progress messages
        const ignoredPatterns = [
          /non monotonically increasing dts/i,
          /Application provided invalid/i,
          /frame=\s*\d+/i, // Progress frames
          /time=\d{2}:\d{2}:\d{2}/i, // Progress time
          /fps=/i, // FPS info
          /size=/i, // Size info
          /bitrate=/i, // Bitrate info
        ];
        
        // Only log errors and critical warnings, not progress messages
        const isError = /error|failed|abort/i.test(message.toLowerCase());
        const shouldLog = isError && !ignoredPatterns.some(pattern => pattern.test(message));
        
        if (shouldLog) {
          console.error('[FFmpeg]', message);
        }
      });

      // Load multi-threaded core - prefer self-hosted (same-origin) for COEP compatibility
      // CDN fetches fail with COEP: require-corp because CDNs don't send Cross-Origin-Resource-Policy
      const loadCoreFile = async (filename: string, mimeType: string) => {
        const selfHosted = `${SELF_HOSTED_BASE}/${filename}`;
        const cdnUrls = [
          `${CDN_BASE_JSDELIVR}/${filename}`,
          `${CDN_BASE_UNPKG}/${filename}`,
        ];
        const urls = [selfHosted, ...cdnUrls];

        let lastError: Error | null = null;

        for (const url of urls) {
          try {
            const blobURL = await toBlobURL(url, mimeType);
            return blobURL;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const errorMsg = error.message || String(err);
            if (url === selfHosted) {
              console.warn(`[FFmpeg] Self-hosted ${filename} failed, trying CDN:`, errorMsg);
            } else {
              console.error(`[FFmpeg] Failed to load ${filename} from ${url}:`, errorMsg);
            }
            lastError = error;
            continue;
          }
        }

        const errorDetails = lastError?.message || 'Unknown error';
        throw new Error(
          `Failed to load FFmpeg core file (${filename}). ` +
          `Error: ${errorDetails}. ` +
          `Ensure public/ffmpeg/ contains the core files (run: npm run copy:ffmpeg). ` +
          `CDN fallback may fail with COEP headers.`
        );
      };

      const coreURL = await loadCoreFile('ffmpeg-core.js', 'text/javascript');
      const wasmURL = await loadCoreFile('ffmpeg-core.wasm', 'application/wasm');
      const workerURL = await loadCoreFile(
        'ffmpeg-core.worker.js',
        'text/javascript'
      );

      await ffmpeg.load({
        coreURL,
        wasmURL,
        workerURL,
      });

      setIsLoaded(true);
      setProgress(0);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to load FFmpeg. Your browser may not support SharedArrayBuffer.';
      setError(errorMessage);
      console.error('FFmpeg load error:', err);
      throw err;
    }
  }, [isLoaded]);

  /**
   * Utility function to calculate the target video bitrate based on target file size and duration.
   * Subtracts audio bitrate (if audio is present) and reserves 5% overhead for the container.
   * Also subtracts 250KB buffer to ensure output is below target size.
   * 
   * @param targetSizeMB - Target file size in megabytes
   * @param durationSeconds - Video duration in seconds
   * @param audioBitrateKbps - Audio bitrate in kbps (default: 128, 96 for optimized, 0 for removed)
   * @returns Target video bitrate in kbps (not clamped)
   */
  const calculateBitrate = useCallback(
    (
      targetSizeMB: number,
      durationSeconds: number,
      audioBitrateKbps: number = 128
    ): number => {
      if (durationSeconds <= 0) {
        throw new Error('Invalid duration: must be greater than 0');
      }

      if (targetSizeMB <= 0) {
        throw new Error('Invalid target size: must be greater than 0');
      }

      // Scale buffer with target size: 2% of target, min 250KB, max 2MB
      // Larger targets need more buffer to avoid overshoot (e.g. 49MB→50MB)
      const BUFFER_MIN_MB = 0.244140625; // 250KB
      const BUFFER_MAX_MB = 2;
      const bufferMB = Math.min(BUFFER_MAX_MB, Math.max(BUFFER_MIN_MB, targetSizeMB * 0.02));
      const adjustedTargetSizeMB = Math.max(0.1, targetSizeMB - bufferMB);

      // Convert target size from MB to kilobits
      // 1 MB (binary) = 1024 KB = 1024 * 8 kilobits = 8192 kilobits
      // Note: Using binary MB (1024) for file size, decimal k (1000) for bitrate
      const targetSizeKbits = adjustedTargetSizeMB * 8192;

      // Calculate total allowed bitrate (kbps)
      const totalBitrateKbps = targetSizeKbits / durationSeconds;

      // Subtract audio bitrate
      const videoBitrateKbps = totalBitrateKbps - audioBitrateKbps;

      // Apply 5% overhead buffer for container (MP4 headers, muxing data)
      const bitrateWithOverhead = videoBitrateKbps * 0.95;

      // Return the calculated bitrate (not clamped - validation happens in transcode)
      return Math.floor(bitrateWithOverhead);
    },
    []
  );

  /**
   * Calculates the minimum target size required for a video of given duration.
   * Uses minimum bitrate of 100 kbps for video + 128 kbps for audio.
   * 
   * @param durationSeconds - Video duration in seconds
   * @returns Minimum target size in MB
   */
  const calculateMinimumSize = useCallback((durationSeconds: number): number => {
    const minVideoBitrateKbps = 100;
    const audioBitrateKbps = 128;
    const totalBitrateKbps = minVideoBitrateKbps + audioBitrateKbps;
    
    // Add 5% overhead buffer
    const bitrateWithOverhead = totalBitrateKbps / 0.95;
    
    // Convert to MB: (kbps * duration) / 8192 (kilobits per MB)
    const minSizeMB = (bitrateWithOverhead * durationSeconds) / 8192;
    
    return Math.ceil(minSizeMB * 10) / 10; // Round up to 0.1 MB
  }, []);

  /**
   * Calculates target size needed to achieve a specific quality score.
   * Works backwards from quality score to bitrate per pixel, then to target size.
   * 
   * @param qualityScore - Target quality score (0-100)
   * @param durationSeconds - Video duration in seconds
   * @param inputWidth - Original video width (optional, defaults to 1920)
   * @param inputHeight - Original video height (optional, defaults to 1080)
   * @returns Target size in MB needed to achieve the quality score
   */
  const calculateTargetSizeForQuality = useCallback(
    (
      qualityScore: number,
      durationSeconds: number,
      inputWidth?: number,
      inputHeight?: number
    ): number => {
      // Determine output resolution (match scaling logic from transcode)
      let outputWidth = inputWidth || 1920;
      let outputHeight = inputHeight || 1080;
      
      if (inputWidth && inputHeight) {
        if (inputWidth > 1920 || inputHeight > 1080) {
          const aspectRatio = inputWidth / inputHeight;
          if (inputWidth > 2560 || inputHeight > 1440) {
            outputHeight = 720;
            outputWidth = Math.round(720 * aspectRatio);
          } else {
            outputHeight = 1080;
            outputWidth = Math.round(1080 * aspectRatio);
          }
        }
      }
      
      const pixels = outputWidth * outputHeight;
      const fps = 30; // Estimate
      
      // Reverse-engineer bitrate per pixel from quality score
      // Using the same thresholds as estimateQuality
      let bitratePerPixel: number;
      
      if (qualityScore >= 90) {
        // Excellent range: 90-100, bitratePerPixel >= 0.15
        // score = 90 + min(10, (bpp - 0.15) * 100)
        // For score 90: bpp = 0.15
        // For score 100: bpp = 0.15 + 0.10 = 0.25
        bitratePerPixel = 0.15 + ((qualityScore - 90) / 10) * 0.10;
      } else if (qualityScore >= 70) {
        // Good range: 70-90, bitratePerPixel 0.10-0.15
        // score = 70 + ((bpp - 0.10) / 0.05) * 20
        bitratePerPixel = 0.10 + ((qualityScore - 70) / 20) * 0.05;
      } else if (qualityScore >= 50) {
        // Fair range: 50-70, bitratePerPixel 0.06-0.10
        // score = 50 + ((bpp - 0.06) / 0.04) * 20
        bitratePerPixel = 0.06 + ((qualityScore - 50) / 20) * 0.04;
      } else if (qualityScore >= 30) {
        // Poor range: 30-50, bitratePerPixel 0.03-0.06
        // score = 30 + ((bpp - 0.03) / 0.03) * 20
        bitratePerPixel = 0.03 + ((qualityScore - 30) / 20) * 0.03;
      } else {
        // Very poor range: 0-30, bitratePerPixel < 0.03
        // score = bpp / 0.03 * 30
        bitratePerPixel = (qualityScore / 30) * 0.03;
      }
      
      // Calculate video bitrate from bitrate per pixel
      // bitratePerPixel = (videoBitrate * 1000) / (pixels * fps)
      // videoBitrate = bitratePerPixel * pixels * fps / 1000
      const videoBitrateKbps = (bitratePerPixel * pixels * fps) / 1000;
      const audioBitrateKbps = 128;
      
      // Add 5% overhead buffer
      const totalBitrateKbps = (videoBitrateKbps + audioBitrateKbps) / 0.95;
      
      // Convert to MB: (kbps * duration) / 8192
      const targetSizeMB = (totalBitrateKbps * durationSeconds) / 8192;
      
      return Math.max(0.1, Math.ceil(targetSizeMB * 10) / 10); // Round to 0.1 MB, minimum 0.1 MB
    },
    []
  );

  /**
   * Gets quality-based recommended target sizes.
   * Returns sizes for 60%, 75%, 90%, and 100% quality levels.
   * 
   * @param durationSeconds - Video duration in seconds
   * @param inputWidth - Original video width (optional)
   * @param inputHeight - Original video height (optional)
   * @returns Array of recommended sizes in MB, ordered from lowest to highest quality
   */
  const getQualityBasedRecommendations = useCallback(
    (
      durationSeconds: number,
      inputWidth?: number,
      inputHeight?: number
    ): number[] => {
      const qualityLevels = [60, 75, 90, 100];
      const recommendations = qualityLevels.map(score =>
        calculateTargetSizeForQuality(score, durationSeconds, inputWidth, inputHeight)
      );
      
      // Ensure recommendations are in ascending order and unique
      const uniqueRecommendations = [...new Set(recommendations)].sort((a, b) => a - b);
      
      return uniqueRecommendations;
    },
    [calculateTargetSizeForQuality]
  );

  /**
   * Gets a recommended target size based on video duration.
   * Provides quality-based recommendations (defaults to 75% quality).
   * 
   * @param durationSeconds - Video duration in seconds
   * @returns Recommended target size in MB
   */
  const getRecommendedTargetSize = useCallback(
    (durationSeconds: number): number => {
      // Default to 75% quality recommendation
      return calculateTargetSizeForQuality(75, durationSeconds);
    },
    [calculateTargetSizeForQuality]
  );

  /**
   * Validates if a target size is feasible for the given video duration.
   * 
   * @param durationSeconds - Video duration in seconds
   * @param targetSizeMB - Target file size in MB
   * @returns Validation result with suggestions
   */
  const validateTargetSize = useCallback(
    (
      durationSeconds: number,
      targetSizeMB: number
    ): { valid: boolean; minSizeMB?: number; recommendedSizeMB?: number } => {
      const minSize = calculateMinimumSize(durationSeconds);
      const recommendedSize = getRecommendedTargetSize(durationSeconds);
      const calculatedBitrate = calculateBitrate(targetSizeMB, durationSeconds);

      return {
        valid: calculatedBitrate >= 100,
        minSizeMB: minSize,
        recommendedSizeMB: recommendedSize,
      };
    },
    [calculateBitrate, calculateMinimumSize, getRecommendedTargetSize]
  );

  /**
   * Estimates video quality based on bitrate per pixel.
   * Higher bitrate per pixel = better quality.
   * Lower resolution + same file size = higher bpp = better quality.
   * 
   * @param targetSizeMB - Target output size in MB
   * @param durationSeconds - Video duration in seconds
   * @param inputWidth - Original video width (optional)
   * @param inputHeight - Original video height (optional)
   * @param removeAudio - If true, audio is removed (more bitrate for video)
   * @param optimizeAudio - If true, audio is optimized to 96kbps mono (more bitrate for video)
   * @param outputResolution - User-selected output resolution (affects pixels, thus bpp)
   * @returns Quality estimate with score, level, and estimated quality loss
   */
  const estimateQuality = useCallback(
    (
      targetSizeMB: number,
      durationSeconds: number,
      inputWidth?: number,
      inputHeight?: number,
      removeAudio: boolean = false,
      optimizeAudio: boolean = false,
      outputResolution: 'original' | '1080p' | '720p' | '480p' = 'original'
    ): QualityEstimate => {
      // Determine audio bitrate based on settings
      let audioBitrateKbps = 128; // Default stereo
      if (removeAudio) {
        audioBitrateKbps = 0;
      } else if (optimizeAudio) {
        audioBitrateKbps = 96; // Mono optimized
      }
      
      const videoBitrate = calculateBitrate(targetSizeMB, durationSeconds, audioBitrateKbps);
      
      // Determine output resolution from user selection (matches transcode logic)
      let outputWidth: number;
      let outputHeight: number;
      if (inputWidth && inputHeight) {
        const dimensions = getTargetDimensions(outputResolution, inputWidth, inputHeight);
        if (dimensions) {
          outputWidth = dimensions.width;
          outputHeight = dimensions.height;
        } else {
          outputWidth = inputWidth;
          outputHeight = inputHeight;
        }
      } else {
        outputWidth = 1920;
        outputHeight = 1080;
      }
      
      const pixels = outputWidth * outputHeight;
      const fps = 30; // Estimate (most videos are 30fps)
      const bitratePerPixel = (videoBitrate * 1000) / (pixels * fps); // bits per pixel per second
      
      // Debug logging to verify audio settings impact
      if (removeAudio || optimizeAudio) {
        console.log(`[Quality Estimate] Audio settings impact:`, {
          removeAudio,
          optimizeAudio,
          audioBitrateKbps,
          videoBitrate,
          bitratePerPixel: bitratePerPixel.toFixed(5),
        });
      }
      
      // Quality thresholds based on bitrate per pixel (bpp)
      // These are approximate thresholds for H.264 encoding:
      // - Excellent: >0.15 bpp (high quality, minimal loss)
      // - Good: 0.10-0.15 bpp (good quality, slight loss)
      // - Fair: 0.06-0.10 bpp (acceptable quality, noticeable loss)
      // - Poor: 0.03-0.06 bpp (low quality, significant loss)
      // - Very Poor: <0.03 bpp (very low quality, heavy artifacts)
      
      let score: number;
      let level: QualityEstimate['level'];
      let estimatedQualityLoss: number;
      
      if (bitratePerPixel >= 0.15) {
        score = 90 + Math.min(10, (bitratePerPixel - 0.15) * 100);
        level = 'excellent';
        estimatedQualityLoss = Math.max(0, 5 - (bitratePerPixel - 0.15) * 20);
      } else if (bitratePerPixel >= 0.10) {
        score = 70 + ((bitratePerPixel - 0.10) / 0.05) * 20;
        level = 'good';
        estimatedQualityLoss = 10 + ((0.15 - bitratePerPixel) / 0.05) * 10;
      } else if (bitratePerPixel >= 0.06) {
        score = 50 + ((bitratePerPixel - 0.06) / 0.04) * 20;
        level = 'fair';
        estimatedQualityLoss = 25 + ((0.10 - bitratePerPixel) / 0.04) * 15;
      } else if (bitratePerPixel >= 0.03) {
        score = 30 + ((bitratePerPixel - 0.03) / 0.03) * 20;
        level = 'poor';
        estimatedQualityLoss = 45 + ((0.06 - bitratePerPixel) / 0.03) * 20;
      } else {
        score = Math.max(0, bitratePerPixel / 0.03 * 30);
        level = 'very-poor';
        estimatedQualityLoss = 70 + ((0.03 - bitratePerPixel) / 0.03) * 25;
      }
      
      // Clamp values
      score = Math.max(0, Math.min(100, Math.round(score)));
      estimatedQualityLoss = Math.max(0, Math.min(100, Math.round(estimatedQualityLoss)));
      
      return {
        score,
        level,
        bitratePerPixel,
        estimatedQualityLoss,
      };
    },
    [calculateBitrate]
  );

  /**
   * Retrieves video duration using an HTMLVideoElement.
   * Falls back to using FFmpeg to probe the file if browser can't decode it.
   * 
   * @param file - Video file
   * @returns Duration in seconds
   */
  const getVideoDuration = useCallback(
    async (file: File): Promise<number> => {
      // First, try using HTMLVideoElement (fastest method)
      try {
        const duration = await new Promise<number>((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true; // Mute to avoid autoplay restrictions
          video.playsInline = true; // Required for some browsers
          video.crossOrigin = 'anonymous'; // Help with CORS if needed

          let blobURL: string | null = null;
          let resolved = false;

          const cleanup = () => {
            if (blobURL) {
              window.URL.revokeObjectURL(blobURL);
            }
            video.remove();
          };

          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(new Error('Timeout waiting for video metadata (10s)'));
            }
          }, 10000); // 10 second timeout

          video.onloadedmetadata = () => {
            if (resolved) return;
            clearTimeout(timeout);
            if (video.duration && isFinite(video.duration) && video.duration > 0) {
              resolved = true;
              cleanup();
              resolve(video.duration);
            } else {
              resolved = true;
              cleanup();
              reject(new Error('Invalid video duration received'));
            }
          };

          video.onerror = () => {
            if (resolved) return;
            clearTimeout(timeout);
            resolved = true;
            const errorCode = video.error?.code;
            const errorMsg = video.error?.message || 'Unknown video error';
            cleanup();
            reject(
              new Error(
                `Browser could not decode video: ${errorMsg} (Code: ${errorCode})`
              )
            );
          };

          // Set source and load
          blobURL = URL.createObjectURL(file);
          video.src = blobURL;
          video.load(); // Explicitly trigger load
        });

        return duration;
      } catch (browserError) {
        console.warn(
          '[FFmpeg] Browser could not decode video metadata, trying FFmpeg probe:',
          browserError
        );

        // Fallback: Use FFmpeg to probe the file duration
        if (!ffmpegRef.current || !isLoaded) {
          throw new Error(
            'Could not determine video duration. Your browser cannot decode this video format. ' +
            'Please try a video with H.264 codec (MP4 format recommended), or wait for FFmpeg to finish loading.'
          );
        }

        try {
          const ffmpeg = ffmpegRef.current;
          const inputData = await fetchFile(file);
          const probeFileName = 'probe-input.mp4';

          // Write file to MEMFS temporarily
          await ffmpeg.writeFile(probeFileName, inputData);

          // Use FFmpeg to get duration by running a probe command
          // FFmpeg outputs duration info immediately when you run -i, before processing frames
          let durationLog = '';
          let extractedDuration: number | null = null;
          let execPromise: Promise<number> | null = null;
          
          // Set up a temporary log handler to capture duration info
          const logHandler = ({ message }: { message: string }) => {
            durationLog += message + '\n';
            
            // Try to parse duration immediately when we see it
            // FFmpeg outputs: Duration: HH:MM:SS.mm or Duration: HH:MM:SS.mmm
            if (!extractedDuration) {
              const durationMatch = message.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})[\.:](\d{2,3})/);
              if (durationMatch) {
                const hours = parseInt(durationMatch[1], 10);
                const minutes = parseInt(durationMatch[2], 10);
                const seconds = parseInt(durationMatch[3], 10);
                const milliseconds = parseInt(durationMatch[4], 10);
                // Handle both 2-digit (centiseconds) and 3-digit (milliseconds) formats
                const msDivisor = durationMatch[4].length === 2 ? 100 : 1000;
                const duration = hours * 3600 + minutes * 60 + seconds + milliseconds / msDivisor;
                
                if (duration > 0) {
                  extractedDuration = duration;
                  // Duration extracted successfully
                }
              }
            }
          };
          
          ffmpeg.on('log', logHandler);

          try {
            // Run a command that will output file info (duration is in logs)
            // Using -t 0.1 to only process 0.1 seconds of video (much faster than full file)
            // This gets us the duration from headers without processing the whole video
            execPromise = ffmpeg.exec([
              '-hide_banner',
              '-i',
              probeFileName,
              '-t',
              '0.1', // Only process 0.1 seconds - enough to get duration from headers
              '-f',
              'null',
              '-',
            ]);
            
            // Set a timeout to prevent hanging (5 seconds should be plenty)
            const timeoutPromise = new Promise<void>((_, reject) => {
              setTimeout(() => {
                if (!extractedDuration) {
                  reject(new Error('Timeout waiting for duration extraction'));
                }
              }, 5000);
            });
            
            // Race between exec and timeout
            await Promise.race([execPromise, timeoutPromise]);
          } catch (execError) {
            // FFmpeg exec may "fail" when probing (exit code != 0), but we get the info we need
            // The duration is in the log output before the error
            // If we already extracted duration, this is fine
            if (!extractedDuration) {
              // Only log if we didn't get duration
              console.warn('[FFmpeg] Probe command had issues, but may have extracted duration');
            }
          } finally {
            // Remove the temporary log handler
            ffmpeg.off('log', logHandler);
          }

          // Check if we extracted duration during logging
          if (extractedDuration) {
            await ffmpeg.deleteFile(probeFileName);
            return extractedDuration;
          }

          // Parse duration from accumulated log output as fallback
          // FFmpeg outputs: Duration: HH:MM:SS.mm or Duration: HH:MM:SS.mmm
          const durationMatch = durationLog.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})[\.:](\d{2,3})/);
          
          if (durationMatch) {
            const hours = parseInt(durationMatch[1], 10);
            const minutes = parseInt(durationMatch[2], 10);
            const seconds = parseInt(durationMatch[3], 10);
            const milliseconds = parseInt(durationMatch[4], 10);
            const msDivisor = durationMatch[4].length === 2 ? 100 : 1000;
            const duration = hours * 3600 + minutes * 60 + seconds + milliseconds / msDivisor;
            
            // Clean up
            await ffmpeg.deleteFile(probeFileName);
            
            if (duration > 0) {
              // Duration extracted via fallback method
              return duration;
            }
          }

          // Clean up
          await ffmpeg.deleteFile(probeFileName);
          
          // Log a sample of the output for debugging (first 500 chars)
          const logSample = durationLog.substring(0, 500);
          console.error('[FFmpeg] Could not find duration in log output. Sample:', logSample);
          
          throw new Error(
            'Could not extract duration from video file. ' +
            'The video format may not be supported, or the file may be corrupted. ' +
            'Try converting your video to MP4 with H.264 codec first.'
          );
        } catch (ffmpegError) {
          const errorMsg = ffmpegError instanceof Error ? ffmpegError.message : String(ffmpegError);
          throw new Error(
            `Could not determine video duration. Browser error: ${browserError instanceof Error ? browserError.message : String(browserError)}. ` +
            `FFmpeg probe error: ${errorMsg}`
          );
        }
      }
    },
    [isLoaded]
  );

  /**
   * Transcodes a video file to a target file size.
   * 
   * @param file - Input video file
   * @param targetSizeMB - Target output size in megabytes
   * @param removeAudio - If true, remove audio track completely
   * @param optimizeAudio - If true, optimize audio to 96kbps mono
   * @returns Blob URL of the transcoded video, or null on error
   */
  const transcode = useCallback(
    async (
      file: File,
      targetSizeMB: number,
      removeAudio: boolean = false,
      optimizeAudio: boolean = false,
      outputResolution: 'original' | '1080p' | '720p' | '480p' = 'original',
      inputWidth?: number,
      inputHeight?: number
    ): Promise<string | null> => {
      if (!ffmpegRef.current) {
        setError('FFmpeg not loaded. Call load() first.');
        return null;
      }

      if (!isLoaded) {
        setError('FFmpeg is not loaded yet.');
        return null;
      }

      try {
        setIsTranscoding(true);
        setError(null);
        setProgress(0);

        const ffmpeg = ffmpegRef.current;

        // Check file size - warn about memory limits
        // Note: High resolution videos can cause OOM even at smaller file sizes
        const fileSizeMB = file.size / 1024 / 1024;
        if (fileSizeMB > 500) {
          console.warn(
            `[FFmpeg] Large file detected (${fileSizeMB.toFixed(1)}MB). ` +
            `Files over 500MB may cause out-of-memory errors depending on resolution and available browser memory. ` +
            `Proceeding with caution...`
          );
          // Don't block, but log a warning - let the user try
          // The actual memory limit depends on browser and system resources
        }

        // Dynamically determine video duration using HTMLVideoElement
        const duration = await getVideoDuration(file);
        // Check video duration - very long videos can cause memory issues
        if (duration > 600) { // 10 minutes
          console.warn(`[FFmpeg] Warning: Long video (${(duration / 60).toFixed(1)} minutes) may cause memory issues`);
        }

        // Determine audio bitrate based on settings
        let audioBitrateKbps = 128; // Default stereo
        if (removeAudio) {
          audioBitrateKbps = 0;
        } else if (optimizeAudio) {
          audioBitrateKbps = 96; // Mono optimized
        }

        // Calculate target bitrate using utility function
        const targetBitrate = calculateBitrate(targetSizeMB, duration, audioBitrateKbps);

        // Validate bitrate - if too low, the target size is impossible
        if (targetBitrate < 100) {
          const validation = validateTargetSize(duration, targetSizeMB);
          const minSize = validation.minSizeMB ?? calculateMinimumSize(duration);
          const recommendedSize =
            validation.recommendedSizeMB ?? getRecommendedTargetSize(duration);

          const durationMinutes = (duration / 60).toFixed(1);
          throw new Error(
            `Target size (${targetSizeMB}MB) is too small for this ${durationMinutes}-minute video. ` +
            `The calculated bitrate (${targetBitrate} kbps) is below the minimum of 100 kbps.\n\n` +
            `💡 Suggestions:\n` +
            `   • Minimum size: ${minSize.toFixed(1)}MB (lowest quality)\n` +
            `   • Recommended size: ${recommendedSize.toFixed(1)}MB (good quality)\n` +
            `   • For best quality: ${(recommendedSize * 1.5).toFixed(1)}MB+\n\n` +
            `Please choose a larger target size to proceed.`
          );
        }

        // Read input file - use file.size for accurate size reporting
        const inputData = await fetchFile(file);
        // Log file info only once at start
        
        // Determine input file extension from MIME type or filename
        const getFileExtension = (file: File): string => {
          const mimeToExt: Record<string, string> = {
            'video/mp4': 'mp4',
            'video/quicktime': 'mov',
            'video/x-msvideo': 'avi',
            'video/x-matroska': 'mkv',
            'video/webm': 'webm',
          };
          
          const extFromMime = mimeToExt[file.type];
          if (extFromMime) return extFromMime;
          
          // Fallback to filename extension
          const filenameExt = file.name.split('.').pop()?.toLowerCase();
          return filenameExt && ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(filenameExt) 
            ? filenameExt 
            : 'mp4'; // Default to mp4
        };
        
        const inputExt = getFileExtension(file);
        const inputFileName = `input.${inputExt}`;
        const outputFileName = 'output.mp4';

        // Write input file to MEMFS
        await ffmpeg.writeFile(inputFileName, inputData);
        console.log(`[FFmpeg] Written input file to MEMFS: ${inputFileName}`);
        
        // Verify file was written (read it back and check size matches file.size)
        try {
          const verifyData = await ffmpeg.readFile(inputFileName);
          // Allow small differences (up to 1MB) - MEMFS might have slight differences
          const sizeDiff = Math.abs(verifyData.length - file.size);
          if (sizeDiff > 1024 * 1024) {
            console.warn(`[FFmpeg] File size mismatch: expected ${file.size} bytes, got ${verifyData.length} bytes`);
            // Don't throw - file might still work, just log the warning
          }
        } catch (verifyError) {
          console.error('[FFmpeg] Verification error:', verifyError);
          // Don't throw - verification is just for debugging, file might still work
        }

        // Execute FFmpeg command
        // -i: input file
        // -c:v libx264: use H.264 codec
        // -b:v: video bitrate
        // -preset faster: encoding speed preset (faster = quicker encoding, larger file)
        // -c:a aac: re-encode audio to AAC (more compatible than copy)
        // -b:a 128k: audio bitrate
        // -movflags +faststart: optimize for web playback
        // -y: overwrite output file
        console.log(`[FFmpeg] Starting transcoding with bitrate: ${targetBitrate}k`);
        
        // Track encoding errors and critical failures
        let encodingErrors: string[] = [];
        let oomDetected = false;
        let abortedDetected = false;
        let frameCount = 0;
        let totalFramesEstimate = 0;
        let encodingCompleted = false; // Track if encoding actually finished
        let lastProgressUpdate = Date.now(); // Track when we last saw progress
        let lastProgressValue = 0; // Track last progress value
        
        // Throttle progress logging to reduce console spam
        let lastProgressLog = 0;
        const PROGRESS_LOG_INTERVAL = 5000; // Log progress every 5 seconds max
        
        const errorHandler = ({ message }: { message: string }) => {
          const lowerMsg = message.toLowerCase();
          
          // Detect completion: FFmpeg outputs final stats like "video:15296kB audio:1424kB"
          // This appears AFTER encoding completes, before cleanup
          if (message.includes('video:') && message.includes('audio:') && message.includes('kB')) {
            encodingCompleted = true;
            console.log('[FFmpeg] ✅ Encoding completed');
            setProgress(1.0); // Ensure progress is 100%
          }
          
          // Check for critical failures - these indicate encoding failed
          if (lowerMsg.includes('aborted(oom)') || lowerMsg.includes('out of memory')) {
            oomDetected = true;
            encodingErrors.push(message);
            console.error('[FFmpeg] Out of memory error:', message);
          } else if (lowerMsg.includes('aborted') && !encodingCompleted) {
            abortedDetected = true;
            encodingErrors.push(message);
            console.error('[FFmpeg] Abort detected:', message);
          } else if ((lowerMsg.includes('error') || lowerMsg.includes('failed')) && !lowerMsg.includes('non-critical')) {
            encodingErrors.push(message);
            console.error('[FFmpeg] Encoding error:', message);
          }
          
          // Parse progress from log messages (fallback if progress events don't work)
          // FFmpeg outputs: frame= 1234 fps=123 q=28.0 size=...
          const frameMatch = message.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            const newFrameCount = parseInt(frameMatch[1], 10);
            if (newFrameCount > frameCount) {
              frameCount = newFrameCount;
              
              // Estimate total frames from duration and fps
              if (duration && !totalFramesEstimate) {
                totalFramesEstimate = Math.floor(duration * 60);
              }
              
              // Update progress if we have an estimate
              if (totalFramesEstimate > 0) {
                const estimatedProgress = Math.min(0.99, frameCount / totalFramesEstimate);
                setProgress(estimatedProgress);
                lastProgressUpdate = Date.now();
                lastProgressValue = estimatedProgress;
                
                // Throttle progress logging
                const now = Date.now();
                if (now - lastProgressLog > PROGRESS_LOG_INTERVAL) {
                  lastProgressLog = now;
                  // Only log milestone percentages (25%, 50%, 75%, etc.)
                  const progressPercent = Math.floor(estimatedProgress * 100);
                  if (progressPercent % 25 === 0 && progressPercent > 0) {
                    console.log(`[FFmpeg] Progress: ${progressPercent}%`);
                  }
                }
              } else {
                lastProgressUpdate = Date.now();
              }
            }
          }
          
          // Also check for time-based progress: time=00:01:23.45
          const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (timeMatch && duration) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const centiseconds = parseInt(timeMatch[4], 10);
            const currentTime = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
            
            if (currentTime > 0 && duration > 0) {
              const timeProgress = Math.min(0.99, currentTime / duration);
              setProgress(timeProgress);
              lastProgressUpdate = Date.now();
              lastProgressValue = timeProgress;
              
              // Throttle time-based progress logging
              const now = Date.now();
              if (now - lastProgressLog > PROGRESS_LOG_INTERVAL) {
                lastProgressLog = now;
                const progressPercent = Math.floor(timeProgress * 100);
                if (progressPercent % 25 === 0 && progressPercent > 0) {
                  console.log(`[FFmpeg] Progress: ${progressPercent}%`);
                }
              }
            }
          }
        };
        
        // Add temporary error handler (will receive ALL log messages, including progress)
        ffmpeg.on('log', errorHandler);
        
        // Use progress-based stall detection instead of hard timeout
        // This allows longer compressions for high-quality settings while still detecting failures
        let encodingTimedOut = false;
        let timeoutInterval: NodeJS.Timeout | null = null;
        let stallReject: ((error: Error) => void) | null = null;
        let lastWarningTime = 0;
        const WARNING_INTERVAL = 5 * 60 * 1000; // Warn every 5 minutes if still processing
        const STALL_THRESHOLD = 3 * 60 * 1000; // 3 minutes without progress = stalled
        
        // Use an interval to check if progress is actually happening
        // This detects real failures (OOM, hangs) without limiting legitimate long compressions
        timeoutInterval = setInterval(() => {
          const timeSinceLastProgress = Date.now() - lastProgressUpdate;
          const progressStalled = timeSinceLastProgress > STALL_THRESHOLD;
          
          if (progressStalled && !encodingCompleted && !encodingTimedOut) {
            // No progress for 3+ minutes - likely hung or OOM
            encodingTimedOut = true;
            const stalledMinutes = Math.round(timeSinceLastProgress / 60000);
            console.error(`[FFmpeg] Encoding stalled: No progress for ${stalledMinutes} minutes`);
            
            // Reject the exec promise if we have a reject function
            if (stallReject) {
              stallReject(new Error(
                `FFmpeg encoding stalled: No progress detected for ${stalledMinutes} minutes.\n\n` +
                `This usually indicates:\n` +
                `   • Out of memory (OOM) - browser ran out of RAM\n` +
                `   • Video too large/high resolution for browser processing\n` +
                `   • Encoding process hung\n\n` +
                `💡 Solutions:\n` +
                `   1. Try a smaller video file or shorter clip\n` +
                `   2. Use desktop tools: HandBrake (free) or FFmpeg CLI\n` +
                `   3. Pre-downscale the video resolution before compressing\n` +
                `   4. Close other browser tabs/apps to free up memory\n\n` +
                `Browser-based encoding has memory limits (~2-4GB) that large/high-resolution videos can exceed.`
              ));
            }
          } else if (!encodingCompleted && !encodingTimedOut && lastProgressValue > 0) {
            // Show periodic warnings for long-running compressions (but don't fail)
            const timeSinceWarning = Date.now() - lastWarningTime;
            if (timeSinceWarning > WARNING_INTERVAL) {
              const elapsedMinutes = Math.round(timeSinceLastProgress / 60000);
              console.log(`[FFmpeg] Compression still running... (${elapsedMinutes} minutes elapsed, ${(lastProgressValue * 100).toFixed(1)}% complete)`);
              lastWarningTime = Date.now();
            }
          }
        }, 30000); // Check every 30 seconds
        
        try {
          console.log(`[FFmpeg] Starting compression (target: ${targetSizeMB}MB)`);
          
          // Determine target resolution from user selection
          const { getTargetDimensions } = await import('../lib/resolution');
          const dimensions = inputWidth && inputHeight
            ? getTargetDimensions(outputResolution, inputWidth, inputHeight)
            : undefined;
          
          let scaleFilter: string;
          if (dimensions) {
            const { width, height } = dimensions;
            scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear`;
          } else {
            // No scaling - pass through (requires scale to avoid filter issues, use original size)
            scaleFilter = 'scale=iw:ih:flags=fast_bilinear';
          }
          
          // Use scale filter with fast bilinear algorithm for lower memory usage
          
          // Use target bitrate (-b:v) for precise size control instead of CRF
          // CRF gives better quality but doesn't guarantee file size
          // Using -b:v with maxrate/bufsize gives us better size control
          // Target 4% below calculated to stay under target (encoding variance)
          const videoBitrateTarget = Math.round(targetBitrate * 0.96);
          const maxrate = Math.round(targetBitrate * 1.0); // Hard cap at target to prevent overshoot
          const bufsize = Math.round(targetBitrate * 1.2); // Smaller buffer for tighter rate control
          
          // Build FFmpeg command arguments
          const ffmpegArgs: string[] = [
            '-i',
            inputFileName,
            '-vf',
            scaleFilter,
            '-sws_flags',
            'lanczos', // Higher quality scaling algorithm (better than fast_bilinear)
            '-c:v',
            'libx264',
            '-b:v',
            `${videoBitrateTarget}k`, // Target bitrate for precise size control
            '-maxrate',
            `${maxrate}k`, // Maximum bitrate (hard limit to prevent overshooting)
            '-bufsize',
            `${bufsize}k`, // Buffer size for rate control
            '-minrate',
            `${Math.round(targetBitrate * 0.8)}k`, // Minimum bitrate (80% of target) to maintain quality
            '-preset',
            'veryfast', // Balanced preset (better quality than ultrafast, still fast)
            '-profile:v',
            'high', // Use high profile for better compression efficiency
            '-level',
            '4.0', // H.264 level 4.0 (widely compatible)
            '-threads',
            '2', // Limit threads to reduce memory
            '-tune',
            'film', // Optimize for film/video content (better than fastdecode for quality)
            '-x264-params',
            'keyint=60:min-keyint=30:scenecut=40', // Better keyframe settings for quality
          ];

          // Handle audio settings
          if (removeAudio) {
            // Remove audio track completely
            ffmpegArgs.push('-an');
          } else if (optimizeAudio) {
            // Optimize audio: 96kbps mono
            ffmpegArgs.push('-c:a', 'aac', '-b:a', '96k', '-ac', '1'); // -ac 1 = mono
          } else {
            // Default: 128kbps stereo
            ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k');
          }

          // Add output options
          ffmpegArgs.push(
            '-movflags',
            '+faststart', // Optimize for web playback
            '-y',
            outputFileName
          );

          const execPromise = ffmpeg.exec(ffmpegArgs);
          
          // Execute FFmpeg command - no hard timeout, rely on progress stall detection
          // The interval above will detect if encoding stalls (no progress for 3+ minutes)
          // Wrap execPromise to allow stall detection to reject it
          const execWithStallDetection = new Promise<void>((resolve, reject) => {
            stallReject = reject; // Store reject function for stall detection
            
            execPromise
              .then(() => {
                if (!encodingTimedOut) {
                  resolve();
                }
                // If timed out, reject was already called by interval
              })
              .catch((err) => {
                reject(err);
              });
          });
          
          await execWithStallDetection;
          
          // Clear timeout interval
          if (timeoutInterval) {
            clearInterval(timeoutInterval);
            timeoutInterval = null;
          }
          
          // Remove error handler
          ffmpeg.off('log', errorHandler);
          
          // Check if encoding actually completed successfully
          // We detect this from:
          // 1. Final muxing stats in logs (video:...kB audio:...kB) - most reliable
          // 2. Progress near 100%
          // 3. Significant frame count processed
          const encodingLikelyCompleted = 
            encodingCompleted || // Detected final stats
            progress >= 0.95 || // Progress near completion
            (frameCount > 0 && frameCount >= totalFramesEstimate * 0.9); // Processed most frames
          
          if (encodingLikelyCompleted) {
            console.log('[FFmpeg] ✅ Encoding completed successfully');
            console.log(`[FFmpeg] Progress: 100.0%, Frames: ${frameCount}/${totalFramesEstimate || 'unknown'}`);
            setProgress(1.0); // Ensure progress is 100%
          }
          
          // Check for critical failures, but allow completion if encoding finished
          if ((oomDetected || abortedDetected) && !encodingLikelyCompleted) {
            const durationMinutes = duration ? (duration / 60).toFixed(1) : 'unknown';
            const durationSeconds = duration || 0;
            
            // Provide more specific guidance based on video characteristics
            let specificGuidance = '';
            if (durationSeconds > 300) {
              specificGuidance = 'Long duration videos require more memory. ';
            }
            if (fileSizeMB > 200) {
              specificGuidance += 'Large file size increases memory needs. ';
            }
            
            throw new Error(
              `Out of Memory Error: Browser-based processing cannot handle this video.\n\n` +
              `Your video (${(file.size / 1024 / 1024).toFixed(1)}MB, ${durationMinutes} minutes) ` +
              `exceeds FFmpeg.wasm memory limits (~2-4GB total heap). ` +
              `${specificGuidance}High resolution videos require significant memory during encoding.\n\n` +
              `💡 Recommended Solutions:\n` +
              `   1. Close other browser tabs/apps to free up memory\n` +
              `   2. Try again - browser memory can vary\n` +
              `   3. Use desktop tools: HandBrake (free) or FFmpeg CLI for more reliable processing\n` +
              `   4. Pre-downscale: Use HandBrake to reduce resolution first, then compress here`
            );
          }
          
          // If encoding completed but aborted during cleanup, log a warning but continue
          if ((oomDetected || abortedDetected) && encodingLikelyCompleted) {
            console.warn('[FFmpeg] ⚠️ Completed but aborted during cleanup');
          }
          
          if (encodingErrors.length > 0 && !encodingLikelyCompleted) {
            console.warn('[FFmpeg] Encoding had errors:', encodingErrors);
          }
          
          if (encodingLikelyCompleted) {
            console.log(`[FFmpeg] ✅ Compression completed`);
          }
        } catch (execError) {
          // Clear timeout interval
          if (timeoutInterval) {
            clearInterval(timeoutInterval);
            timeoutInterval = null;
          }
          
          // Remove error handler
          ffmpeg.off('log', errorHandler);
          
          console.error('[FFmpeg] Exec error:', execError);
          
          // Check for WebAssembly errors (signature mismatch usually means version incompatibility)
          const errorStr = String(execError);
          const errorLower = errorStr.toLowerCase();
          if (errorLower.includes('signature mismatch') || errorLower.includes('indirect call')) {
            throw new Error(
              `WebAssembly Error: FFmpeg version compatibility issue detected.\n\n` +
              `This may be caused by:\n` +
              `   • Browser compatibility issues\n` +
              `   • FFmpeg.wasm version mismatch\n` +
              `   • Memory corruption\n\n` +
              `💡 Solutions:\n` +
              `   • Refresh the page and try again\n` +
              `   • Try a different browser (Chrome/Edge recommended)\n` +
              `   • Close other tabs to free up memory\n` +
              `   • If persistent, use desktop tools for this video`
            );
          }
          
          // Check for out-of-memory errors
          if (errorLower.includes('oom') || errorLower.includes('out of memory') || errorLower.includes('aborted')) {
            const durationMinutes = duration ? (duration / 60).toFixed(1) : 'unknown';
            throw new Error(
              `Out of Memory Error: The video file is too large for browser-based processing.\n\n` +
              `FFmpeg.wasm has memory limits (~2-4GB). Your file (${(file.size / 1024 / 1024).toFixed(1)}MB, ${durationMinutes} min) ` +
              `exceeded these limits during processing.\n\n` +
              `💡 Solutions:\n` +
              `   • Close other browser tabs/apps to free memory\n` +
              `   • Try again - browser memory can vary\n` +
              `   • Use a desktop video compression tool (HandBrake, FFmpeg CLI)\n` +
              `   • Try compressing a shorter clip first`
            );
          }
          
          // Handle other errors
          let errorMsg = 'Unknown error';
          if (execError instanceof Error) {
            errorMsg = execError.message || execError.toString();
          } else if (typeof execError === 'string') {
            errorMsg = execError;
          } else {
            errorMsg = String(execError);
          }
          
          const errorDetails = encodingErrors.length > 0 
            ? `\n\nFFmpeg errors encountered:\n${encodingErrors.slice(0, 3).join('\n')}`
            : '';
          
          throw new Error(
            `FFmpeg encoding failed: ${errorMsg}${errorDetails}`
          );
        }

        // Read output file from MEMFS
        // Even if FFmpeg aborted, the file might still be valid if encoding completed
        // Normalize FileData to Uint8Array backed by ArrayBuffer (required for Blob constructor)
        let outputData: Uint8Array;
        try {
          const raw = await ffmpeg.readFile(outputFileName);
          outputData = raw instanceof Uint8Array
            ? new Uint8Array(raw)
            : new TextEncoder().encode(raw);
        } catch (readError) {
          // If we can't read the file, check if encoding completed
          if (progress >= 0.95) {
            throw new Error(
              `Encoding completed (${(progress * 100).toFixed(1)}%) but output file could not be read. ` +
              `This may indicate a memory issue during final write. Try again or use desktop tools.`
            );
          }
          throw new Error(
            `Failed to read output file: ${readError instanceof Error ? readError.message : String(readError)}`
          );
        }

        // Validate output file size
        if (!outputData || outputData.length === 0) {
          throw new Error('Output file is empty. Encoding may have failed.');
        }

        const outputSizeMB = outputData.length / 1024 / 1024;
        
        // Check if file is reasonable size (at least 1MB for a 90-second video)
        if (outputSizeMB < 1) {
          // If encoding showed completion but file is small, it might have been cut off
          if (progress >= 0.95) {
            throw new Error(
              `Encoding appeared to complete but output file is too small (${outputSizeMB.toFixed(2)}MB). ` +
              `The file may have been cut off due to memory issues. Try again or use desktop tools.`
            );
          }
          throw new Error(
            `Output file is too small (${outputSizeMB.toFixed(2)}MB). ` +
            `This usually means encoding failed. Check console for FFmpeg errors.`
          );
        }
        
        console.log(`[FFmpeg] ✅ Output file validated: ${outputSizeMB.toFixed(2)}MB (target: ${targetSizeMB}MB)`);

        // Clean up MEMFS
        await ffmpeg.deleteFile(inputFileName);
        await ffmpeg.deleteFile(outputFileName);

        // Create blob URL - copy to new ArrayBuffer to satisfy Blob constructor (avoids SharedArrayBuffer)
        const buffer = new ArrayBuffer(outputData.length);
        new Uint8Array(buffer).set(outputData);
        const blob = new Blob([buffer], { type: 'video/mp4' });
        const blobURL = URL.createObjectURL(blob);

        console.log(`[FFmpeg] ✅ Complete: ${outputSizeMB.toFixed(2)}MB (target: ${targetSizeMB}MB)`);
        setProgress(1);
        return blobURL;
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'Transcoding failed. Please try again.';
        setError(errorMessage);
        console.error('Transcoding error:', err);
        return null;
      } finally {
        setIsTranscoding(false);
      }
    },
    [isLoaded, calculateBitrate, getVideoDuration]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoaded,
    isTranscoding,
    progress,
    error,
    load,
    transcode,
    clearError,
    getVideoDuration,
    getRecommendedTargetSize,
    getQualityBasedRecommendations,
    validateTargetSize,
    estimateQuality,
  };
}
