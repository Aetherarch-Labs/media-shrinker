import { Settings } from 'lucide-react';
import type { OutputResolution } from '../lib/resolution';
import { RESOLUTION_PRESETS } from '../lib/resolution';

interface QualityEstimate {
  score: number; // 0-100, higher is better
  level: 'excellent' | 'good' | 'fair' | 'poor' | 'very-poor';
  bitratePerPixel: number;
  estimatedQualityLoss: number; // percentage of quality loss (0-100)
}

interface SettingsPanelProps {
  targetSizeMB: number;
  onTargetSizeChange: (size: number) => void;
  disabled?: boolean;
  videoDuration?: number | null;
  videoResolution?: { width: number; height: number } | null;
  sizeValidation?: {
    valid: boolean;
    minSizeMB?: number;
    recommendedSizeMB?: number;
  } | null;
  qualityEstimate?: QualityEstimate | null;
  qualityBasedRecommendations?: number[] | null;
  originalFileSizeMB?: number | null;
  removeAudio: boolean;
  onRemoveAudioChange: (value: boolean) => void;
  optimizeAudio: boolean;
  onOptimizeAudioChange: (value: boolean) => void;
  outputResolution: OutputResolution;
  onOutputResolutionChange: (value: OutputResolution) => void;
}

export function SettingsPanel({
  targetSizeMB,
  onTargetSizeChange,
  disabled = false,
  videoDuration,
  videoResolution,
  sizeValidation,
  qualityEstimate,
  qualityBasedRecommendations,
  originalFileSizeMB,
  removeAudio,
  onRemoveAudioChange,
  optimizeAudio,
  onOptimizeAudioChange,
  outputResolution,
  onOutputResolutionChange,
}: SettingsPanelProps) {
  const presetSizes = [8, 25, 50, 100];
  
  // Generate dynamic presets based on quality recommendations if available
  const getDynamicPresets = () => {
    // Use quality-based recommendations if available
    if (qualityBasedRecommendations && qualityBasedRecommendations.length > 0) {
      return qualityBasedRecommendations.map(size => Math.ceil(size));
    }
    
    // Fallback to old logic if quality recommendations not available
    if (!videoDuration || !sizeValidation?.recommendedSizeMB) {
      return presetSizes;
    }
    
    const recommended = sizeValidation.recommendedSizeMB;
    const min = sizeValidation.minSizeMB || 8;
    
    // Create presets around the recommended size
    const presets = [
      Math.max(8, Math.floor(min)),
      Math.ceil(recommended * 0.7),
      Math.ceil(recommended),
      Math.ceil(recommended * 1.5),
    ].filter((size, index, arr) => 
      size > 0 && arr.indexOf(size) === index // Remove duplicates and invalid sizes
    );
    
    return presets.length > 0 ? presets : presetSizes;
  };
  
  const displayPresets = getDynamicPresets();
  
  // Get quality labels for each preset
  const getQualityLabel = (size: number): string => {
    if (!qualityBasedRecommendations || qualityBasedRecommendations.length === 0) {
      return '';
    }
    
    const sortedRecs = [...qualityBasedRecommendations].sort((a, b) => a - b);
    const index = sortedRecs.findIndex(rec => Math.abs(rec - size) < 0.5);
    
    if (index === 0) return '60%';
    if (index === 1) return '75%';
    if (index === 2) return '90%';
    if (index === 3) return '100%';
    
    return '';
  };

  // Platform presets with max file sizes
  const platformPresets = [
    { name: 'Discord', size: 10, description: 'Free limit' },
    { name: 'Discord Nitro', size: 500, description: 'Nitro limit' },
    { name: 'WhatsApp', size: 16, description: 'Video limit' },
    { name: 'Steam', size: 200, description: 'Profile video' },
    { name: 'Twitter/X', size: 512, description: 'Video limit' },
    { name: 'Instagram', size: 100, description: 'Video limit' },
    { name: 'Facebook', size: 1000, description: 'Video limit' },
    { name: 'Gmail', size: 25, description: 'Attachment limit' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-lg hover:shadow-xl transition-shadow duration-200">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="target-size"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Target File Size (MB)
          </label>
          <div className="flex gap-2">
            <input
              id="target-size"
              type="number"
              min="1"
              max="1000"
              step="0.1"
              value={targetSizeMB}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value) && value > 0) {
                  onTargetSizeChange(value);
                }
              }}
              disabled={disabled}
              className={`
                flex-1 px-3 py-2 border rounded-lg shadow-sm focus:outline-none focus:ring-2 
                disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:cursor-not-allowed
                bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                [-moz-appearance:textfield]
                ${
                  sizeValidation && !sizeValidation.valid
                    ? 'border-red-300 dark:border-red-700 focus:ring-red-500 focus:border-red-500'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                }
              `}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400 self-center">MB</span>
          </div>
          
          {/* Show validation warnings */}
          {sizeValidation && !sizeValidation.valid && (
            <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-xs">
              <p className="text-yellow-800 dark:text-yellow-200 font-medium mb-1">⚠️ Target size too small</p>
              {sizeValidation.minSizeMB && (
                <p className="text-yellow-700 dark:text-yellow-300">
                  Minimum: <button
                    type="button"
                    onClick={() => onTargetSizeChange(sizeValidation.minSizeMB!)}
                    className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100"
                    disabled={disabled}
                  >
                    {sizeValidation.minSizeMB.toFixed(1)}MB
                  </button>
                </p>
              )}
              {sizeValidation.recommendedSizeMB && (
                <p className="text-yellow-700 dark:text-yellow-300">
                  Recommended: <button
                    type="button"
                    onClick={() => onTargetSizeChange(sizeValidation.recommendedSizeMB!)}
                    className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100"
                    disabled={disabled}
                  >
                    {sizeValidation.recommendedSizeMB.toFixed(1)}MB
                  </button>
                </p>
              )}
            </div>
          )}
          
          {/* Show video info */}
          {videoDuration && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Video duration: {(videoDuration / 60).toFixed(1)} minutes
              {videoResolution && ` • ${videoResolution.width}×${videoResolution.height}`}
            </p>
          )}

          {/* Output Resolution */}
          {videoResolution && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Output Resolution
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Aspect ratio preserved; fits within max dimensions
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOutputResolutionChange('original')}
                  disabled={disabled}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    outputResolution === 'original'
                      ? 'bg-blue-600 dark:bg-blue-500 text-white ring-2 ring-blue-300 dark:ring-blue-600'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Original ({videoResolution.width}×{videoResolution.height})
                </button>
                {(['1080p', '720p', '480p'] as const).map((preset) => {
                  const { width, height, label } = RESOLUTION_PRESETS[preset];
                  const isApplicable = videoResolution.width > width || videoResolution.height > height;
                  const isSelected = outputResolution === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onOutputResolutionChange(preset)}
                      disabled={disabled || !isApplicable}
                      title={!isApplicable ? `Video is already ${label} or smaller` : undefined}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        isSelected
                          ? 'bg-blue-600 dark:bg-blue-500 text-white ring-2 ring-blue-300 dark:ring-blue-600'
                          : isApplicable
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {label} ({width}×{height})
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Show quality estimate */}
          {qualityEstimate && (
            <div className={`mt-3 p-3 rounded-lg border ${
              qualityEstimate.level === 'excellent' || qualityEstimate.level === 'good'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : qualityEstimate.level === 'fair'
                ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Estimated Quality:</span>
                <span className={`text-sm font-bold ${
                  qualityEstimate.level === 'excellent' || qualityEstimate.level === 'good'
                    ? 'text-green-700 dark:text-green-400'
                    : qualityEstimate.level === 'fair'
                    ? 'text-yellow-700 dark:text-yellow-400'
                    : 'text-orange-700 dark:text-orange-400'
                }`}>
                  {qualityEstimate.score}/100
                </span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      qualityEstimate.level === 'excellent' || qualityEstimate.level === 'good'
                        ? 'bg-green-500 dark:bg-green-400'
                        : qualityEstimate.level === 'fair'
                        ? 'bg-yellow-500 dark:bg-yellow-400'
                        : 'bg-orange-500 dark:bg-orange-400'
                    }`}
                    style={{ width: `${qualityEstimate.score}%` }}
                  />
                </div>
                <span className={`text-xs font-medium capitalize ${
                  qualityEstimate.level === 'excellent' || qualityEstimate.level === 'good'
                    ? 'text-green-700 dark:text-green-400'
                    : qualityEstimate.level === 'fair'
                    ? 'text-yellow-700 dark:text-yellow-400'
                    : 'text-orange-700 dark:text-orange-400'
                }`}>
                  {qualityEstimate.level.replace('-', ' ')}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Estimated quality loss: <span className="font-medium">{qualityEstimate.estimatedQualityLoss}%</span>
                {qualityEstimate.estimatedQualityLoss > 30 && (
                  <span className="ml-1 text-orange-600 dark:text-orange-400">⚠️ Significant quality reduction expected</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Quality-based presets */}
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">
            {qualityBasedRecommendations && qualityBasedRecommendations.length > 0
              ? 'Quality Presets:'
              : videoDuration
              ? 'Recommended Presets:'
              : 'Quick Presets:'}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {displayPresets.map((size) => {
              const qualityLabel = getQualityLabel(size);
              const isSelected = Math.abs(targetSizeMB - size) < 0.1;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => onTargetSizeChange(size)}
                  disabled={disabled}
                  className={`
                    px-4 py-2.5 rounded-lg transition-all duration-200 flex flex-col items-center justify-center min-w-[70px]
                    ${
                      isSelected
                        ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-md ring-2 ring-blue-300 dark:ring-blue-600'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                    hover:scale-105 active:scale-95
                  `}
                  title={qualityLabel ? `${qualityLabel} quality` : undefined}
                >
                  <span className="font-semibold text-base leading-tight">{size}MB</span>
                  {qualityLabel && (
                    <span className={`text-xs font-medium mt-1 ${
                      isSelected 
                        ? 'text-blue-100 dark:text-blue-200' 
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {qualityLabel} quality
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Platform presets */}
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">
            Platform Limits:
          </p>
          <div className="flex flex-wrap gap-2.5">
            {platformPresets.map((platform) => {
              // If platform limit is higher than original file size, use original file size instead
              const effectiveSize = originalFileSizeMB && platform.size > originalFileSizeMB 
                ? originalFileSizeMB 
                : platform.size;
              const isSelected = Math.abs(targetSizeMB - effectiveSize) < 0.1;
              const isCapped = originalFileSizeMB && platform.size > originalFileSizeMB;
              
              return (
                <button
                  key={platform.name}
                  type="button"
                  onClick={() => onTargetSizeChange(effectiveSize)}
                  disabled={disabled}
                  className={`
                    px-3 py-2 rounded-lg transition-all duration-200 flex flex-col items-center justify-center min-w-[80px]
                    ${
                      isSelected
                        ? 'bg-purple-600 dark:bg-purple-500 text-white shadow-md ring-2 ring-purple-300 dark:ring-purple-600'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                    hover:scale-105 active:scale-95
                  `}
                  title={
                    isCapped
                      ? `${platform.name}: File is smaller than limit (${originalFileSizeMB?.toFixed(1)}MB < ${platform.size}MB)`
                      : `${platform.name}: ${platform.description}`
                  }
                >
                  <span className="font-semibold text-sm leading-tight">{platform.name}</span>
                  <span className={`text-xs mt-0.5 ${
                    isSelected 
                      ? 'text-purple-100 dark:text-purple-200' 
                      : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {effectiveSize.toFixed(1)}MB
                    {isCapped && (
                      <span className="block text-[10px] opacity-75 mt-0.5">(original)</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Audio Settings */}
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-3">
            Audio Settings:
          </p>
          <div className="space-y-3">
            {/* Remove Audio Toggle */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={removeAudio}
                onChange={(e) => {
                  onRemoveAudioChange(e.target.checked);
                }}
                disabled={disabled}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-offset-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-gray-700 dark:group-hover:text-gray-300">
                  Remove Audio
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Remove audio track completely to maximize video quality
                </p>
              </div>
            </label>

            {/* Optimize Audio Toggle */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={optimizeAudio}
                onChange={(e) => {
                  onOptimizeAudioChange(e.target.checked);
                }}
                disabled={disabled || removeAudio}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-offset-2 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-gray-700 dark:group-hover:text-gray-300">
                  Optimize Audio
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Downsample to 96kbps/Mono - saves space for higher video quality
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
