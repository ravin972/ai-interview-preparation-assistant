'use client';

import React, { useEffect } from 'react';
import { Button } from '../components/ui/button.js';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application Error Boundary caught error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="h-12 w-12 rounded-full bg-rose-950/40 border border-rose-800/60 flex items-center justify-center text-rose-400">
        <AlertTriangle className="h-6 w-6" />
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">
          Something went wrong
        </h2>
        <p className="text-xs text-zinc-400 max-w-sm">
          {error.message || 'An unexpected error occurred while rendering the page.'}
        </p>
      </div>

      <div className="pt-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => reset()}
          className="gap-1.5 font-mono text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Try again</span>
        </Button>
      </div>
    </div>
  );
}
