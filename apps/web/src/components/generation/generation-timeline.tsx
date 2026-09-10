'use client';

import React, { useEffect, useState, useMemo } from 'react';
import type { JobDto, StageRecord, SseEventPayload, JobStatus } from '../../types/kit.js';
import { subscribeJobProgress } from '../../lib/api/sse.js';
import { STAGE_DEFINITIONS, StageRow } from './stage-row.js';
import { Progress } from '../ui/progress.js';
import { Alert } from '../ui/alert.js';
import { Activity, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

export interface GenerationTimelineProps {
  jobId: string;
  initialJob?: JobDto | null;
  onComplete: () => void;
}

export function GenerationTimeline({
  jobId,
  initialJob,
  onComplete,
}: GenerationTimelineProps) {
  const [status, setStatus] = useState<JobStatus>(initialJob?.status ?? 'queued');
  const [currentStage, setCurrentStage] = useState<number>(initialJob?.currentStage ?? 0);
  const [progress, setProgress] = useState<number>(initialJob?.progress ?? 0);
  const [stages, setStages] = useState<StageRecord[]>(initialJob?.stages ?? []);
  const [error, setError] = useState<string | null>(initialJob?.error ?? null);
  const [isConnected, setIsConnected] = useState<boolean>(true);

  // Map stage records by stage number for O(1) lookup
  const recordsMap = useMemo(() => {
    const map = new Map<number, StageRecord>();
    for (const st of stages) {
      map.set(st.n, st);
    }
    return map;
  }, [stages]);

  useEffect(() => {
    // Connect to resilient fetch-based SSE stream
    const unsubscribe = subscribeJobProgress(jobId, {
      onEvent: (event: SseEventPayload) => {
        setIsConnected(true);

        if (event.type === 'job:snapshot') {
          // Authoritative MongoDB snapshot synchronization
          if (event.status) setStatus(event.status);
          if (event.progress !== undefined) setProgress(event.progress);
          if (event.currentStage !== undefined) setCurrentStage(event.currentStage);
          if (event.stages) setStages(event.stages);
          if (event.error) setError(event.error);

          if (event.status === 'completed') {
            onComplete();
          }
          return;
        }

        if (event.type === 'stage:start' && event.stage !== undefined) {
          setCurrentStage(event.stage);
          if (event.progress !== undefined) setProgress(event.progress);
          setStatus('running');
        } else if (
          event.type === 'stage:complete' ||
          event.type === 'stage:degraded' ||
          event.type === 'stage:skip'
        ) {
          if (event.stage !== undefined) {
            setCurrentStage(event.stage);
            const newRecord: StageRecord = {
              n: event.stage,
              name: event.stageName ?? `Stage ${event.stage}`,
              status:
                event.type === 'stage:complete'
                  ? 'completed'
                  : event.type === 'stage:degraded'
                    ? 'degraded'
                    : 'skipped',
              ms: 0,
              detail: event.detail,
            };
            setStages((prev) => {
              const filtered = prev.filter((s) => s.n !== event.stage);
              return [...filtered, newRecord];
            });
          }
          if (event.progress !== undefined) setProgress(event.progress);
        } else if (event.type === 'stage:fail') {
          if (event.stage !== undefined) {
            const failRecord: StageRecord = {
              n: event.stage,
              name: event.stageName ?? `Stage ${event.stage}`,
              status: 'failed',
              ms: 0,
              detail: event.error,
            };
            setStages((prev) => {
              const filtered = prev.filter((s) => s.n !== event.stage);
              return [...filtered, failRecord];
            });
          }
          if (event.error) setError(event.error);
        } else if (event.type === 'pipeline:complete') {
          setProgress(100);
          setStatus('completed');
          onComplete();
        } else if (event.type === 'pipeline:fail') {
          setStatus('failed');
          setError(event.error || 'Generation pipeline failed.');
        }
      },
      onError: (err) => {
        console.warn('[SSE] Connection issue, retrying...', err);
        setIsConnected(false);
      },
      onComplete: () => {
        setProgress(100);
        setStatus('completed');
        onComplete();
      },
    });

    return () => {
      unsubscribe();
    };
  }, [jobId, onComplete]);

  const activeStageDef = STAGE_DEFINITIONS.find((s) => s.n === currentStage);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-zinc-100">
              Generating Interview Kit
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${
                isConnected
                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-400 border border-amber-800/60 animate-pulse'
              }`}
            >
              <Activity className="h-3 w-3" />
              <span>{isConnected ? 'Live SSE Stream' : 'Reconnecting...'}</span>
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Job ID: <span className="font-mono text-zinc-300">{jobId}</span> &middot;
            Durable MongoDB state with automatic lease recovery.
          </p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold font-mono text-zinc-100">{progress}%</div>
          <span className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">
            {status}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <Progress value={progress} indicatorColor="bg-emerald-500" />
        <div className="flex justify-between text-[11px] text-zinc-500 font-mono">
          <span>
            Current:{' '}
            <strong className="text-zinc-300">
              {activeStageDef
                ? `Stage ${activeStageDef.n} (${activeStageDef.name})`
                : 'Initializing...'}
            </strong>
          </span>
          <span>16 stages total</span>
        </div>
      </div>

      {/* Error Notice if Failed */}
      {status === 'failed' && (
        <Alert variant="error" title="Pipeline Generation Failed">
          {error ||
            'An error occurred during pipeline execution. Check the stage logs below.'}
        </Alert>
      )}

      {/* Audit Trail List */}
      <div className="rounded-lg border border-zinc-800 bg-[#121215] p-4 shadow-xl space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800 text-[11px] text-zinc-500 font-mono">
          <span>Stage Sequence & Audit Trail</span>
          <span>Execution Type</span>
        </div>

        <div className="space-y-1.5 pt-1">
          {STAGE_DEFINITIONS.map((def) => (
            <StageRow
              key={def.n}
              definition={def}
              record={recordsMap.get(def.n)}
              isActive={status === 'running' && currentStage === def.n}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
