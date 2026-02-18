import { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTranscoder } from './hooks/useTranscoder';
import { FileDropzone } from './components/FileDropzone';
import { SettingsPanel } from './components/SettingsPanel';
import { Progress } from './components/Progress';
import { DarkModeToggle } from './components/DarkModeToggle';
import { cn } from './lib/utils';

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetSizeMB, setTargetSizeMB] = useState(8);
  const [outputBlobURL, setOutputBlobURL] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(null);
  const [isLoadingDuration, setIsLoadingDuration] = useState(false);
  const [sizeValidation, setSizeValidation] = useState<{
    valid: boolean;
    minSizeMB?: number;
    recommendedSizeMB?: number;
  } | null>(null);
  const [qualityEstimate, setQualityEstimate] = useState<{
    score: number;
    level: 'excellent' | 'good' | 'fair' | 'poor' | 'very-poor';
    bitratePerPixel: number;
    estimatedQualityLoss: number;
  } | null>(null);
  const [qualityBasedRecommendations, setQualityBasedRecommendations] = useState<number[] | null>(null);
  const [removeAudio, setRemoveAudio] = useState(false);
  const [optimizeAudio, setOptimizeAudio] = useState(false);
  const [outputResolution, setOutputResolution] = useState<'original' | '1080p' | '720p' | '480p'>('original');

  const {
    isLoaded,
    isTranscoding,
    progress,
    error,
    load,
    transcode,
    clearError,
    getVideoDuration,
    getQualityBasedRecommendations,
    validateTargetSize,
    estimateQuality,
  } = useTranscoder();

  // Load FFmpeg on mount
  useEffect(() => {
    load().catch((err) => {
      console.error('Failed to load FFmpeg:', err);
    });
  }, [load]);

  // Recalculate quality estimate when audio settings, target size, or resolution change
  useEffect(() => {
    if (videoDuration) {
      const quality = estimateQuality(
        targetSizeMB,
        videoDuration,
        videoResolution?.width,
        videoResolution?.height,
        removeAudio,
        optimizeAudio,
        outputResolution
      );
      setQualityEstimate(quality);
    }
  }, [removeAudio, optimizeAudio, videoDuration, targetSizeMB, outputResolution, videoResolution?.width, videoResolution?.height, estimateQuality]);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setOutputBlobURL(null);
    setVideoDuration(null);
    setVideoResolution(null);
    setSizeValidation(null);
    setIsLoadingDuration(false);

    // Try to get video duration and resolution to show recommendations
    // Only if FFmpeg is loaded (so we can use the fallback method)
    if (isLoaded) {
      setIsLoadingDuration(true);
      try {
        // Use the hook's getVideoDuration which has FFmpeg fallback
        const duration = await getVideoDuration(file);
        setVideoDuration(duration);
        
        // Try to get video resolution for quality estimation
        let capturedWidth: number | undefined;
        let capturedHeight: number | undefined;
        try {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true;
          video.playsInline = true;

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
            video.onloadedmetadata = () => {
              clearTimeout(timeout);
              capturedWidth = video.videoWidth;
              capturedHeight = video.videoHeight;
              setVideoResolution({ width: capturedWidth!, height: capturedHeight! });

              // Warn about high resolution videos
              if (capturedWidth! > 2560 || capturedHeight! > 1440) {
                console.warn(`[Video] High resolution detected: ${capturedWidth}x${capturedHeight}. Browser processing may fail.`);
              }

              video.remove();
              resolve();
            };
            video.onerror = () => {
              clearTimeout(timeout);
              video.remove();
              reject(new Error('Could not load video'));
            };
            video.src = URL.createObjectURL(file);
          });
        } catch (resErr) {
          // Silently fail - resolution check is optional
          console.log('Could not check video resolution:', resErr);
        }

        // Validate current target size
        const validation = validateTargetSize(duration, targetSizeMB);
        setSizeValidation(validation);

        // Calculate quality estimate (works with or without resolution)
        if (duration) {
          const quality = estimateQuality(
            targetSizeMB,
            duration,
            capturedWidth,
            capturedHeight,
            removeAudio,
            optimizeAudio,
            outputResolution
          );
          setQualityEstimate(quality);
          
          // Get quality-based recommendations
          if (capturedWidth != null && capturedHeight != null) {
            const recommendations = getQualityBasedRecommendations(
              duration,
              capturedWidth,
              capturedHeight
            );
            setQualityBasedRecommendations(recommendations);
          } else {
            // Get recommendations even without resolution (will use defaults)
            const recommendations = getQualityBasedRecommendations(duration);
            setQualityBasedRecommendations(recommendations);
          }
        }

        // Auto-adjust target size if it's too small
        if (!validation.valid && validation.recommendedSizeMB) {
          setTargetSizeMB(validation.recommendedSizeMB);
        }
      } catch (err) {
        // Log error but don't block - we'll validate during compression
        console.warn('Could not preload video duration:', err);
        // Still show a warning in the UI
        setSizeValidation({
          valid: true, // Don't show as invalid, just missing duration
          recommendedSizeMB: undefined,
        });
      } finally {
        setIsLoadingDuration(false);
      }
    }
  };

  const handleTranscode = async () => {
    if (!selectedFile || !isLoaded) return;

    // Pre-validate if we have duration
    if (videoDuration) {
      const validation = validateTargetSize(videoDuration, targetSizeMB);
      if (!validation.valid) {
        // Error will be shown via the error state
        return;
      }
    }

    const blobURL = await transcode(
      selectedFile,
      targetSizeMB,
      removeAudio,
      optimizeAudio,
      outputResolution,
      videoResolution?.width,
      videoResolution?.height
    );
    if (blobURL) {
      setOutputBlobURL(blobURL);
    }
  };

  const handleTargetSizeChange = (size: number) => {
    setTargetSizeMB(size);
    // Re-validate if we have duration
    if (videoDuration) {
      const validation = validateTargetSize(videoDuration, size);
      setSizeValidation(validation);
      // Quality estimate will be recalculated by useEffect
    }
  };

  const handleRemoveAudioChange = (value: boolean) => {
    setRemoveAudio(value);
    // If removing audio, disable optimize audio
    if (value) {
      setOptimizeAudio(false);
    }
    // Quality will be recalculated by useEffect
  };

  const handleOptimizeAudioChange = (value: boolean) => {
    setOptimizeAudio(value);
    // If optimizing audio, disable remove audio
    if (value) {
      setRemoveAudio(false);
    }
    // Quality will be recalculated by useEffect
  };

  const handleDownload = () => {
    if (!outputBlobURL || !selectedFile) return;

    const link = document.createElement('a');
    link.href = outputBlobURL;
    link.download = `shrunk_${selectedFile.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setOutputBlobURL(null);
    setTargetSizeMB(8);
    setRemoveAudio(false);
    setOptimizeAudio(false);
    setOutputResolution('original');
    clearError();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4 transition-colors duration-200">
      <DarkModeToggle />
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent mb-3">
            Media Shrinker
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg mb-4">
            Compress your videos directly in the browser
          </p>
          <a
            href="/pro.html"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-sm font-medium transition-colors"
          >
            ⚡ Try Pro — GPU-accelerated encoding
          </a>
        </div>

        {/* FFmpeg Loading Status */}
        {!isLoaded && !error && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6 flex items-center gap-3 shadow-sm">
            <Loader2 className="w-5 h-5 text-yellow-600 dark:text-yellow-400 animate-spin" />
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Loading FFmpeg engine... This may take a moment.
            </p>
          </div>
        )}

        {/* SharedArrayBuffer Check */}
        {typeof SharedArrayBuffer === 'undefined' && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Browser Compatibility Issue
                </p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  SharedArrayBuffer is not available. Please ensure:
                </p>
                <ul className="text-sm text-red-700 dark:text-red-300 mt-2 list-disc list-inside space-y-1">
                  <li>You are accessing via <code className="bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">localhost</code> or <code className="bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">127.0.0.1</code> (not <code className="bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">file://</code>)</li>
                  <li>The dev server is running with proper headers</li>
                  <li>You are using a modern browser (Chrome/Edge/Firefox latest)</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
              <div className="text-sm text-red-700 dark:text-red-300 mt-1 whitespace-pre-line">
                {error}
              </div>
              {error.includes('high-resolution') || error.includes('timeout') ? (
                <div className="mt-3 p-3 bg-red-100 dark:bg-red-900/40 rounded-lg border border-red-300 dark:border-red-700">
                  <p className="text-xs font-medium text-red-900 dark:text-red-200 mb-1">Why this happens:</p>
                  <p className="text-xs text-red-800 dark:text-red-300">
                    Videos over 1080p resolution require significant memory. Browser-based tools have limits (~2-4GB).
                    Your video (3440x1440) exceeds these limits, causing FFmpeg to hang or fail.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="space-y-6">
          {/* File Dropzone */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg hover:shadow-xl transition-shadow duration-200">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Select Video File
            </h2>
            <FileDropzone
              onFileSelect={handleFileSelect}
              acceptedFile={selectedFile}
              disabled={!isLoaded || isTranscoding}
            />
          </div>

          {/* Loading Duration Indicator */}
          {selectedFile && isLoadingDuration && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6 flex items-center gap-3 shadow-sm">
              <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Analyzing video to determine duration and recommend target size...
              </p>
            </div>
          )}

          {/* Settings Panel */}
          {selectedFile && (
            <SettingsPanel
              targetSizeMB={targetSizeMB}
              onTargetSizeChange={handleTargetSizeChange}
              disabled={isTranscoding || isLoadingDuration}
              videoDuration={videoDuration}
              videoResolution={videoResolution}
              sizeValidation={sizeValidation}
              qualityEstimate={qualityEstimate}
              qualityBasedRecommendations={qualityBasedRecommendations}
              originalFileSizeMB={selectedFile ? selectedFile.size / (1024 * 1024) : null}
              removeAudio={removeAudio}
              onRemoveAudioChange={handleRemoveAudioChange}
              optimizeAudio={optimizeAudio}
              onOptimizeAudioChange={handleOptimizeAudioChange}
              outputResolution={outputResolution}
              onOutputResolutionChange={setOutputResolution}
            />
          )}

          {/* Progress Bar */}
          {isTranscoding && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Compressing Video...
                </h2>
              </div>
              <Progress value={progress} />
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 text-center">
                {(progress * 100).toFixed(1)}% complete
              </p>
            </div>
          )}

          {/* Success Message & Download */}
          {outputBlobURL && !isTranscoding && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6 shadow-lg">
              <div className="flex items-start gap-3 mb-4">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Compression Complete!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                    Your video has been compressed successfully.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <button
                    onClick={handleDownload}
                    className="flex-1 bg-green-600 dark:bg-green-500 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition-colors flex items-center justify-center gap-2 font-medium shadow-md hover:shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    Download Compressed Video
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    Start Over
                  </button>
                </div>
                <a
                  href="https://buymeacoffee.com/yourusername"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium shadow-md hover:shadow-lg text-sm"
                >
                  ☕ Support this Project
                </a>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {selectedFile && !isTranscoding && !outputBlobURL && (
            <div className="flex gap-3">
              <button
                onClick={handleTranscode}
                disabled={!isLoaded || !selectedFile || isLoadingDuration}
                className={cn(
                  'flex-1 bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600',
                  'text-white px-6 py-3.5 rounded-lg font-medium transition-all duration-200',
                  'hover:from-blue-700 hover:to-blue-800 dark:hover:from-blue-600 dark:hover:to-blue-700',
                  'disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2 shadow-lg hover:shadow-xl',
                  'disabled:shadow-none transform hover:scale-[1.02] disabled:transform-none'
                )}
              >
                {!isLoaded ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading Engine...
                  </>
                ) : isLoadingDuration ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing Video...
                  </>
                ) : (
                  'Compress Video'
                )}
              </button>
              <button
                onClick={handleReset}
                disabled={isLoadingDuration}
                className="px-6 py-3.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400 space-y-2">
          <p>
            Processing happens entirely in your browser. Your files never leave
            your device.
          </p>
          <p>
            <a
              href="https://www.descript.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Need professional editing? Try Descript
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
