/** Output resolution presets for video compression */
export type OutputResolution = 'original' | '1080p' | '720p' | '480p';

export const RESOLUTION_PRESETS: Record<
  Exclude<OutputResolution, 'original'>,
  { width: number; height: number; label: string }
> = {
  '1080p': { width: 1920, height: 1080, label: '1080p' },
  '720p': { width: 1280, height: 720, label: '720p' },
  '480p': { width: 854, height: 480, label: '480p' },
};

/**
 * Get target dimensions for encoding based on selected resolution and input size.
 * Returns undefined for 'original' (keep as-is), or { width, height } for presets.
 */
export function getTargetDimensions(
  outputResolution: OutputResolution,
  inputWidth: number,
  inputHeight: number
): { width: number; height: number } | undefined {
  if (outputResolution === 'original') {
    return undefined;
  }
  const preset = RESOLUTION_PRESETS[outputResolution];
  if (!preset) return undefined;

  // Don't upscale - if input is smaller than preset, keep original
  if (inputWidth <= preset.width && inputHeight <= preset.height) {
    return undefined;
  }

  const aspectRatio = inputWidth / inputHeight;
  // Scale down to fit within preset box, preserve aspect ratio
  let width: number;
  let height: number;
  if (inputWidth >= inputHeight) {
    // Landscape
    width = Math.min(preset.width, inputWidth);
    height = Math.round(width / aspectRatio);
    if (height > preset.height) {
      height = Math.min(preset.height, inputHeight);
      width = Math.round(height * aspectRatio);
    }
  } else {
    // Portrait
    height = Math.min(preset.height, inputHeight);
    width = Math.round(height * aspectRatio);
    if (width > preset.width) {
      width = Math.min(preset.width, inputWidth);
      height = Math.round(width / aspectRatio);
    }
  }
  return { width, height };
}
