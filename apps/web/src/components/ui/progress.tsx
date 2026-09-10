import React from 'react';
import { cn } from '../../lib/utils/cn.js';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
  indicatorColor?: string;
  showPercentage?: boolean;
  label?: string;
}

export function Progress({
  value,
  indicatorColor = 'bg-emerald-500',
  showPercentage = false,
  label,
  className,
  ...props
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={cn('w-full space-y-1.5', className)} {...props}>
      {(label || showPercentage) && (
        <div className="flex justify-between items-center text-xs text-zinc-400">
          {label && <span className="font-medium">{label}</span>}
          {showPercentage && (
            <span className="font-mono font-semibold text-zinc-200">{clamped}%</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-900 border border-zinc-800"
      >
        <div
          className={cn(
            'h-full transition-all duration-300 ease-out rounded-full',
            indicatorColor,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
