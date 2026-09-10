import React from 'react';
import { cn } from '../../lib/utils/cn.js';
import { AlertCircle, AlertTriangle, CheckCircle, Info } from 'lucide-react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'warning' | 'error' | 'success' | 'gap';
  title?: string;
}

export function Alert({
  className,
  variant = 'info',
  title,
  children,
  ...props
}: AlertProps) {
  const styles = {
    info: 'bg-zinc-900 border-zinc-700 text-zinc-300',
    warning: 'bg-amber-950/40 border-amber-800/80 text-amber-300',
    error: 'bg-rose-950/40 border-rose-800/80 text-rose-300',
    success: 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300',
    gap: 'bg-zinc-900/90 border-zinc-700/80 text-zinc-300',
  };

  const icons = {
    info: <Info className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />,
    error: <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />,
    success: <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />,
    gap: <Info className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />,
  };

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 p-3.5 rounded-lg border text-xs leading-relaxed',
        styles[variant],
        className,
      )}
      {...props}
    >
      {icons[variant]}
      <div className="flex-1 space-y-1">
        {title && <h5 className="font-medium tracking-tight text-zinc-200">{title}</h5>}
        <div className="text-zinc-300/90 leading-normal">{children}</div>
      </div>
    </div>
  );
}
