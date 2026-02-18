interface ProgressProps {
  value: number;
  className?: string;
}

export function Progress({ value, className = '' }: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, value * 100));

  return (
    <div className={`w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden shadow-inner ${className}`}>
      <div
        className="bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-500 dark:to-blue-400 h-3 rounded-full transition-all duration-300 ease-out shadow-sm"
        style={{ width: `${percentage}%` }}
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="sr-only">{percentage.toFixed(1)}% complete</span>
      </div>
    </div>
  );
}
