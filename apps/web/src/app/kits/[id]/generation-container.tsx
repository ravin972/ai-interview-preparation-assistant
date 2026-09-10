'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { GenerationTimeline } from '../../../components/generation/generation-timeline.js';
import { api } from '../../../lib/api/client.js';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../../../components/ui/button.js';

interface ContainerProps {
  kitId: string;
}

function GenerationContent({ kitId }: ContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams?.get('jobId');

  // Fallback polling if jobId wasn't passed in search params
  useEffect(() => {
    if (jobId) return;

    const interval = setInterval(async () => {
      try {
        const kit = await api.kits.get(kitId);
        if (kit.status === 'ready' || kit.status === 'failed') {
          clearInterval(interval);
          router.refresh();
        }
      } catch (err) {
        console.warn('[GenerationContainer] Polling check failed:', err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [jobId, kitId, router]);

  if (jobId) {
    return (
      <GenerationTimeline
        jobId={jobId}
        onComplete={() => {
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto my-16 p-8 rounded-lg border border-zinc-800 bg-[#121215] text-center space-y-4 shadow-xl">
      <div className="h-10 w-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-300">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-zinc-100">
          Generating Interview Kit...
        </h3>
        <p className="text-xs text-zinc-400">
          The 16-stage pipeline is running in the background. Polling for completion.
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => router.refresh()}
        className="gap-1.5 font-mono text-xs"
      >
        <RefreshCw className="h-3 w-3" />
        <span>Check Status</span>
      </Button>
    </div>
  );
}

export function GenerationTimelineContainer({ kitId }: ContainerProps) {
  return (
    <Suspense
      fallback={
        <div className="text-center py-12 text-xs font-mono text-zinc-500">
          Initializing generation stream...
        </div>
      }
    >
      <GenerationContent kitId={kitId} />
    </Suspense>
  );
}
