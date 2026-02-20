import { useState, useRef, useCallback } from 'react';
import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
} from 'mediabunny';
import { useTranscoder } from './useTranscoder';

/** Check if WebCodecs (VideoEncoder) is available for hardware-accelerated encoding */
export function isWebCodecsAvailable(): boolean {
  return typeof globalThis.VideoEncoder !== 'undefined';
}

interface QualityEstimate {
  score: number;
  level: 'excellent' | 'good' | 'fair' | 'poor' | 'very-poor';
  bitratePerPixel: number;
  estimatedQualityLoss: number;
}

interface UseTranscoderProReturn {
  isLoaded: boolean;
  isTranscoding: boolean;
  progress: number;
  error: string | null;
  engine: 'webcodecs' | 'wasm' | 'loading';
  /** User-friendly explanation when WebCodecs wasn't used (e.g. fallback to FFmpeg) */
  webcodecsUnavailableReason: string | null;
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

/**
 * Pro transcoder: Uses WebCodecs (GPU) via MediaBunny when available, falls back to FFmpeg.wasm.
 * Provides the same API as useTranscoder but with significantly faster encoding when WebCodecs is available.
 */
export function useTranscoderPro(): UseTranscoderProReturn {
  const wasmTranscoder = useTranscoder();
  const [engine, setEngine] = useState<'webcodecs' | 'wasm' | 'loading'>('loading');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [webcodecsUnavailableReason, setWebcodecsUnavailableReason] = useState<string | null>(null);
  const [isTranscodingPro, setIsTranscodingPro] = useState(false);
  const webCodecsAttempted = useRef(false);

  const load = useCallback(async () => {
    if (webCodecsAttempted.current) {
      if (engine === 'wasm') {
        await wasmTranscoder.load();
      }
      return;
    }

    webCodecsAttempted.current = true;

    if (isWebCodecsAvailable()) {
      setEngine('webcodecs');
      setWebcodecsUnavailableReason(null);
    } else {
      setEngine('wasm');
      setWebcodecsUnavailableReason(
        'WebCodecs (VideoEncoder) is not supported in this browser. Use Chrome, Edge, or another Chromium-based browser for GPU acceleration.'
      );
      await wasmTranscoder.load();
    }
  }, [engine, wasmTranscoder]);

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
      await load();

      const resolution = outputResolution;
      const width = inputWidth;
      const height = inputHeight;

      if (engine === 'wasm') {
        return wasmTranscoder.transcode(
          file,
          targetSizeMB,
          removeAudio,
          optimizeAudio,
          resolution,
          width,
          height
        );
      }

      // Try WebCodecs (MediaBunny) first
      setIsTranscodingPro(true);
      setError(null);
      setWebcodecsUnavailableReason(null);
      try {
        const { result, fallbackReason } = await transcodeWithMediaBunny(
          file,
          targetSizeMB,
          removeAudio,
          optimizeAudio,
          resolution,
          width,
          height,
          setProgress,
          setError
        );

        // If MediaBunny couldn't handle the file (unsupported codecs), fall back to FFmpeg
        if (result === null && !wasmTranscoder.error) {
          setError(null);
          setProgress(0);
          setWebcodecsUnavailableReason(
            fallbackReason ??
              'Your video uses codecs that WebCodecs cannot process. Using FFmpeg fallback for compatibility.'
          );
          await wasmTranscoder.load();
          setEngine('wasm');
          return wasmTranscoder.transcode(
            file,
            targetSizeMB,
            removeAudio,
            optimizeAudio,
            resolution,
            width,
            height
          );
        }

        return result;
      } finally {
        setIsTranscodingPro(false);
      }
    },
    [engine, load, wasmTranscoder]
  );

  const clearError = useCallback(() => {
    setError(null);
    setWebcodecsUnavailableReason(null);
    wasmTranscoder.clearError();
  }, [wasmTranscoder]);

  const getVideoDuration = useCallback(
    async (file: File): Promise<number> => {
      if (engine === 'webcodecs') {
        try {
          const input = new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(file),
          });
          return await input.computeDuration();
        } catch {
          // Fallback to video element if MediaBunny fails
          return getVideoDurationFromElement(file);
        }
      }
      return wasmTranscoder.getVideoDuration(file);
    },
    [engine, wasmTranscoder]
  );

  const isLoaded = engine === 'webcodecs' || wasmTranscoder.isLoaded;
  const isTranscoding = engine === 'wasm' ? wasmTranscoder.isTranscoding : isTranscodingPro;
  const currentProgress = engine === 'wasm' ? wasmTranscoder.progress : progress;
  const currentError = engine === 'wasm' ? wasmTranscoder.error : error;

  return {
    ...wasmTranscoder,
    getVideoDuration,
    isLoaded,
    isTranscoding,
    progress: currentProgress,
    error: currentError,
    engine,
    webcodecsUnavailableReason,
    load,
    transcode,
    clearError,
  };
}

async function getVideoDurationFromElement(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const blobURL = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(blobURL);
      video.remove();
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(blobURL);
      video.remove();
      reject(new Error('Could not load video metadata'));
    };
    video.src = blobURL;
  });
}

/**
 * Calculate video bitrate for target file size.
 * Hardware encoders (WebCodecs) often overshoot bitrate targets significantly,
 * so we apply a ~0.55 multiplier to compensate.
 */
function calculateVideoBitrate(
  targetSizeMB: number,
  durationSeconds: number,
  audioBitrateBps: number
): number {
  // Scale buffer with target size: 2% of target, min 250KB, max 2MB
  const BUFFER_MIN_MB = 0.244140625;
  const BUFFER_MAX_MB = 2;
  const bufferMB = Math.min(BUFFER_MAX_MB, Math.max(BUFFER_MIN_MB, targetSizeMB * 0.02));
  const adjustedTargetSizeMB = Math.max(0.1, targetSizeMB - bufferMB);
  const targetSizeBits = adjustedTargetSizeMB * 8192 * 1000; // kilobits to bits
  const totalBitrateBps = targetSizeBits / durationSeconds;
  const videoBitrateBps = (totalBitrateBps - audioBitrateBps) * 0.95;
  // Hardware encoders typically overshoot - apply ~0.55 to stay closer to target
  const HARDWARE_ENCODER_OVERSHOOT_FACTOR = 0.55;
  return Math.floor(Math.max(100000, videoBitrateBps * HARDWARE_ENCODER_OVERSHOOT_FACTOR));
}

function getFallbackReasonFromDiscardedTracks(
  discardedTracks: Array<{ reason: string }>
): string {
  const reasons = new Set(discardedTracks.map((t) => t.reason));
  const parts: string[] = [];

  if (reasons.has('undecodable_source_codec')) {
    parts.push(
      'Your video uses a codec that WebCodecs cannot decode (e.g. HEVC, certain VP9, or older formats)'
    );
  }
  if (reasons.has('no_encodable_target_codec')) {
    parts.push(
      'Your audio or video cannot be encoded to the target format with WebCodecs'
    );
  }
  if (reasons.has('unknown_source_codec')) {
    parts.push('Your file uses an unknown or unsupported codec');
  }

  if (parts.length === 0) {
    return 'WebCodecs cannot process this file.';
  }
  return parts.join('. ') + '. Using FFmpeg fallback for compatibility.';
}

async function transcodeWithMediaBunny(
  file: File,
  targetSizeMB: number,
  removeAudio: boolean,
  optimizeAudio: boolean,
  outputResolution: 'original' | '1080p' | '720p' | '480p',
  inputWidth: number | undefined,
  inputHeight: number | undefined,
  setProgress: (p: number) => void,
  setError: (e: string | null) => void
): Promise<{ result: string | null; fallbackReason?: string }> {
  setError(null);
  setProgress(0);

  try {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const duration = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();

    if (!videoTrack) {
      throw new Error('No video track found in file');
    }

    const trackWidth = videoTrack.displayWidth;
    const trackHeight = videoTrack.displayHeight;
    const srcWidth = inputWidth ?? trackWidth;
    const srcHeight = inputHeight ?? trackHeight;
    const { getTargetDimensions } = await import('../lib/resolution');
    const dimensions = getTargetDimensions(outputResolution, srcWidth, srcHeight);
    // Always pass explicit dimensions: for 'original' use track size to avoid transmux/pass-through
    const outWidth = dimensions?.width ?? trackWidth;
    const outHeight = dimensions?.height ?? trackHeight;
    const audioBitrateBps = removeAudio ? 0 : optimizeAudio ? 96000 : 128000;
    const videoBitrateBps = calculateVideoBitrate(targetSizeMB, duration, audioBitrateBps);

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: () => ({
        width: outWidth,
        height: outHeight,
        fit: 'contain' as const,
        bitrate: videoBitrateBps,
        codec: 'avc' as const,
        hardwareAcceleration: 'prefer-hardware' as const,
        // Force re-encode; prevents transmux/pass-through that can return original file
        forceTranscode: true,
        // Fewer keyframes = faster encoding (trade-off: slightly worse seeking)
        keyFrameInterval: 10,
      }),
      audio: audioTrack && !removeAudio
        ? {
            discard: false,
            bitrate: audioBitrateBps,
            numberOfChannels: optimizeAudio ? 1 : 2,
            codec: 'aac' as const,
          }
        : { discard: true },
      tags: {},
    });

    if (!conversion.isValid) {
      const fallbackReason = getFallbackReasonFromDiscardedTracks(conversion.discardedTracks);
      return { result: null, fallbackReason };
    }

    conversion.onProgress = (p) => setProgress(p);
    await conversion.execute();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('Output file is empty');
    }

    // Sanity check: if output is nearly identical to input size, likely pass-through (shouldn't happen with forceTranscode)
    const outputSizeMB = buffer.byteLength / 1024 / 1024;
    const inputSizeMB = file.size / 1024 / 1024;
    if (outputSizeMB >= inputSizeMB * 0.98) {
      console.warn(
        `[MediaBunny] Output (${outputSizeMB.toFixed(2)}MB) nearly matches input (${inputSizeMB.toFixed(2)}MB). ` +
          'Compression may not have applied. Falling back to FFmpeg.'
      );
      return {
        result: null,
        fallbackReason:
          'WebCodecs output matched input size—compression may not have applied. Using FFmpeg for reliable compression.',
      };
    }

    setProgress(1);
    const blob = new Blob([buffer], { type: 'video/mp4' });
    return { result: URL.createObjectURL(blob) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcoding failed';
    setError(message);
    console.error('[MediaBunny] Transcode error:', err);
    return {
      result: null,
      fallbackReason: 'WebCodecs encountered an error. Using FFmpeg fallback for compatibility.',
    };
  }
}
