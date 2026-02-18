import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Video } from 'lucide-react';
import { cn } from '../lib/utils';

interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  acceptedFile?: File | null;
  disabled?: boolean;
}

export function FileDropzone({
  onFileSelect,
  acceptedFile,
  disabled = false,
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0 && !disabled) {
        onFileSelect(acceptedFiles[0]);
      }
    },
    [onFileSelect, disabled]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'],
    },
    multiple: false,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200',
        isDragActive
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 scale-[1.02]'
          : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 hover:border-gray-400 dark:hover:border-gray-500',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-4">
        {acceptedFile ? (
          <>
            <Video className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {acceptedFile.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {(acceptedFile.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
            {!disabled && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Click or drag to replace
              </p>
            )}
          </>
        ) : (
          <>
            <Upload
              className={cn(
                'w-12 h-12 transition-colors',
                isDragActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
              )}
            />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {isDragActive
                  ? 'Drop the video file here'
                  : 'Drag & drop a video file here'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                or click to browse
              </p>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Supports MP4, MOV, AVI, MKV, WebM, and more
            </p>
          </>
        )}
      </div>
    </div>
  );
}
