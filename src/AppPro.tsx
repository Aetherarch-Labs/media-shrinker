import { useState, useEffect, useRef } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle2, Zap, CreditCard } from 'lucide-react';
import { useTranscoderPro, isWebCodecsAvailable } from './hooks/useTranscoderPro';
import { FileDropzone } from './components/FileDropzone';
import { SettingsPanel } from './components/SettingsPanel';
import { Progress } from './components/Progress';
import { DarkModeToggle } from './components/DarkModeToggle';
import { cn } from './lib/utils';

// Placeholder credits - would integrate with backend/payment in production
const CREDITS_PER_COMPRESSION = 1;
const DEMO_CREDITS = 5; // Demo credits for testing

function AppPro() {
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
  const [credits, setCredits] = useState(DEMO_CREDITS);
  const outputBlobURLRef = useRef<string | null>(null);

  const {
    isLoaded,
    isTranscoding,
    progress,
    error,
    engine,
    webcodecsUnavailableReason,
    load,
    transcode,
    clearError,
    getVideoDuration,
    getQualityBasedRecommendations,
    validateTargetSize,
    estimateQuality,
  } = useTranscoderPro();

  useEffect(() => {
    load().catch((err) => {
      console.error('Failed to load:', err);
    });
  }, [load]);

  // Keep ref in sync and revoke blob URL on unmount to prevent memory leaks
  useEffect(() => {
    outputBlobURLRef.current = outputBlobURL;
    return () => {
      const url = outputBlobURLRef.current;
      if (url) URL.revokeObjectURL(url);
    };
  }, [outputBlobURL]);

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
    setOutputBlobURL((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setVideoDuration(null);
    setVideoResolution(null);
    setSizeValidation(null);
    setIsLoadingDuration(false);

    if (isLoaded) {
      setIsLoadingDuration(true);
      try {
        const duration = await getVideoDuration(file);
        setVideoDuration(duration);

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
        } catch {
          // Silently fail
        }

        const validation = validateTargetSize(duration, targetSizeMB);
        setSizeValidation(validation);

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

          if (capturedWidth != null && capturedHeight != null) {
            setQualityBasedRecommendations(
              getQualityBasedRecommendations(duration, capturedWidth, capturedHeight)
            );
          } else {
            setQualityBasedRecommendations(getQualityBasedRecommendations(duration));
          }
        }

        if (!validation.valid && validation.recommendedSizeMB) {
          setTargetSizeMB(validation.recommendedSizeMB);
        }
      } catch (err) {
        console.warn('Could not preload video duration:', err);
        setSizeValidation({ valid: true, recommendedSizeMB: undefined });
      } finally {
        setIsLoadingDuration(false);
      }
    }
  };

  const handleTranscode = async () => {
    if (!selectedFile || !isLoaded) return;
    if (credits < CREDITS_PER_COMPRESSION) {
      return;
    }

    if (videoDuration) {
      const validation = validateTargetSize(videoDuration, targetSizeMB);
      if (!validation.valid) return;
    }

    // Revoke previous output URL before creating new one (prevents stale download)
    setOutputBlobURL((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

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
      setCredits((c) => Math.max(0, c - CREDITS_PER_COMPRESSION));
    }
  };

  const handleTargetSizeChange = (size: number) => {
    setTargetSizeMB(size);
    if (videoDuration) {
      setSizeValidation(validateTargetSize(videoDuration, size));
    }
  };

  const handleRemoveAudioChange = (value: boolean) => {
    setRemoveAudio(value);
    if (value) setOptimizeAudio(false);
  };

  const handleOptimizeAudioChange = (value: boolean) => {
    setOptimizeAudio(value);
    if (value) setRemoveAudio(false);
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
    setOutputBlobURL((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSelectedFile(null);
    setTargetSizeMB(8);
    setRemoveAudio(false);
    setOptimizeAudio(false);
    setOutputResolution('original');
    clearError();
  };

  const hasCredits = credits >= CREDITS_PER_COMPRESSION;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50/50 via-white to-purple-50/50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4 transition-colors duration-200">
      <DarkModeToggle />
      <div className="max-w-4xl mx-auto">
        {/* Pro Header with Credits */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <h1 className="text-5xl font-bold bg-gradient-to-r from-amber-500 via-orange-500 to-purple-600 dark:from-amber-400 dark:via-orange-400 dark:to-purple-400 bg-clip-text text-transparent">
                Media Shrinker
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                PRO
              </span>
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-lg flex items-center gap-2 justify-center md:justify-start">
              <Zap className="w-5 h-5 text-amber-500" />
              GPU-accelerated compression with WebCodecs
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg">
              <CreditCard className="w-5 h-5 text-amber-500" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Credits</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{credits}</p>
              </div>
            </div>
            <a
              href="/app.html"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              ← Standard
            </a>
          </div>
        </div>

        {/* Engine indicator */}
        {isLoaded && (
          <div
            className={`mb-6 px-4 py-3 rounded-lg border text-sm ${
              engine === 'webcodecs'
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
            }`}
          >
            {engine === 'webcodecs' ? (
              <>Using <strong>WebCodecs</strong> (GPU) — hardware-accelerated encoding</>
            ) : (
              <div>
                <p className="font-medium">Using FFmpeg.wasm (CPU) fallback</p>
                {webcodecsUnavailableReason && (
                  <p className="mt-1.5 text-xs opacity-90">{webcodecsUnavailableReason}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {!isLoaded && !error && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6 flex items-center gap-3 shadow-sm">
            <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {engine === 'loading' && isWebCodecsAvailable()
                ? 'Initializing WebCodecs engine...'
                : 'Loading engine...'}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6 flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Error</p>
              <div className="text-sm text-red-700 dark:text-red-300 mt-1 whitespace-pre-line">{error}</div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg hover:shadow-xl transition-shadow duration-200">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Select Video File</h2>
            <FileDropzone
              onFileSelect={handleFileSelect}
              acceptedFile={selectedFile}
              disabled={!isLoaded || isTranscoding}
            />
          </div>

          {selectedFile && isLoadingDuration && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6 flex items-center gap-3 shadow-sm">
              <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
              <p className="text-sm text-amber-800 dark:text-amber-200">Analyzing video...</p>
            </div>
          )}

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
              originalFileSizeMB={selectedFile?.size ? selectedFile.size / (1024 * 1024) : null}
              removeAudio={removeAudio}
              onRemoveAudioChange={handleRemoveAudioChange}
              optimizeAudio={optimizeAudio}
              onOptimizeAudioChange={handleOptimizeAudioChange}
              outputResolution={outputResolution}
              onOutputResolutionChange={setOutputResolution}
            />
          )}

          {isTranscoding && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
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
                  href="#"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors font-medium shadow-md hover:shadow-lg text-sm"
                >
                  <CreditCard className="w-4 h-4" />
                  Buy More Credits
                </a>
              </div>
            </div>
          )}

          {selectedFile && !isTranscoding && !outputBlobURL && (
            <div className="flex gap-3">
              <button
                onClick={handleTranscode}
                disabled={!isLoaded || !selectedFile || isLoadingDuration || !hasCredits}
                className={cn(
                  'flex-1 bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-500 dark:to-orange-600',
                  'text-white px-6 py-3.5 rounded-lg font-medium transition-all duration-200',
                  'hover:from-amber-600 hover:to-orange-700 dark:hover:from-amber-600 dark:hover:to-orange-700',
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
                ) : !hasCredits ? (
                  'No Credits — Buy More'
                ) : (
                  `Compress Video (${CREDITS_PER_COMPRESSION} credit)`
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

        <div className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400 space-y-2">
          <p>
            Pro uses GPU-accelerated WebCodecs when available. Processing happens entirely in your browser.
          </p>
          <p>
            <a href="/app.html" className="text-amber-600 dark:text-amber-400 hover:underline">
              Use the free standard app instead
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default AppPro;
