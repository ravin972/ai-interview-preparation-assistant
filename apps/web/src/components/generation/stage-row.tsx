import React from 'react';
import type { StageRecord, StageStatus } from '../../types/kit.js';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  MinusCircle,
} from 'lucide-react';

export interface StageDefinition {
  n: number;
  name: string;
  kind: 'det' | 'llm' | 'net' | 'io';
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  { n: 1, name: 'Normalize + segment JD', kind: 'det' },
  { n: 2, name: 'Extract requirements', kind: 'llm' },
  { n: 3, name: 'Validate company URL', kind: 'det' },
  { n: 4, name: 'Fetch homepage', kind: 'net' },
  { n: 5, name: 'Crawl / discover links', kind: 'net' },
  { n: 6, name: 'Rank links', kind: 'det' },
  { n: 7, name: 'Identify about/hiring pages', kind: 'llm' },
  { n: 8, name: 'Fetch selected pages', kind: 'net' },
  { n: 9, name: 'Search public interview discussion', kind: 'net' },
  { n: 10, name: 'Generate company brief', kind: 'llm' },
  { n: 11, name: 'Generate questions (pass 1)', kind: 'llm' },
  { n: 12, name: 'Generate flashcards', kind: 'llm' },
  { n: 13, name: 'Deterministic coverage check', kind: 'det' },
  { n: 14, name: 'Generate missing questions', kind: 'llm' },
  { n: 15, name: 'Build deterministic schedule', kind: 'det' },
  { n: 16, name: 'Final validation & persist', kind: 'io' },
];

export interface StageRowProps {
  definition: StageDefinition;
  record?: StageRecord | undefined;
  isActive?: boolean | undefined;
}

export function StageRow({ definition, record, isActive }: StageRowProps) {
  const status: StageStatus | 'pending' =
    record?.status ?? (isActive ? 'started' : 'pending');

  const kindBadges = {
    det: 'bg-indigo-950/40 text-indigo-400 border-indigo-800/50',
    llm: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
    net: 'bg-cyan-950/40 text-cyan-400 border-cyan-800/50',
    io: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  };

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-md border text-xs transition-colors font-mono ${
        isActive
          ? 'border-zinc-500 bg-zinc-900/90 shadow-sm'
          : status === 'completed'
            ? 'border-zinc-800/80 bg-zinc-900/40 text-zinc-300'
            : status === 'degraded' || status === 'skipped'
              ? 'border-amber-900/40 bg-amber-950/20 text-amber-200/90'
              : status === 'failed'
                ? 'border-rose-900/60 bg-rose-950/30 text-rose-300'
                : 'border-zinc-900 bg-zinc-950/50 text-zinc-600'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 w-5 flex justify-center">
          {status === 'completed' && (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          {status === 'started' && (
            <Loader2 className="h-4 w-4 text-zinc-200 animate-spin" />
          )}
          {status === 'degraded' && <AlertTriangle className="h-4 w-4 text-amber-400" />}
          {status === 'skipped' && <MinusCircle className="h-4 w-4 text-zinc-500" />}
          {status === 'failed' && <XCircle className="h-4 w-4 text-rose-400" />}
          {status === 'pending' && <div className="h-2 w-2 rounded-full bg-zinc-800" />}
        </div>

        <div className="flex items-center gap-2 truncate">
          <span className="text-zinc-500 font-semibold w-5 shrink-0">
            {String(definition.n).padStart(2, '0')}
          </span>
          <span
            className={`truncate font-medium ${
              isActive
                ? 'text-zinc-100 font-bold'
                : status === 'completed'
                  ? 'text-zinc-200'
                  : 'text-zinc-400'
            }`}
          >
            {definition.name}
          </span>
          {record?.detail && (
            <span className="hidden sm:inline text-[11px] text-zinc-500 truncate max-w-[200px]">
              &middot; {record.detail}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 ml-2">
        {record?.ms !== undefined && record.ms > 0 && (
          <span className="text-[11px] text-zinc-500">
            {record.ms < 1000 ? `${record.ms}ms` : `${(record.ms / 1000).toFixed(1)}s`}
          </span>
        )}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] uppercase border tracking-wider font-semibold ${
            kindBadges[definition.kind]
          }`}
        >
          {definition.kind}
        </span>
      </div>
    </div>
  );
}
