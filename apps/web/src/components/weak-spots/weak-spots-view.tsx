import React from 'react';
import Link from 'next/link';
import type { WeakSpotDto } from '../../types/kit.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Play,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';

export interface WeakSpotsViewProps {
  kitId: string;
  weakSpots: WeakSpotDto[];
}

export function WeakSpotsView({ kitId, weakSpots }: WeakSpotsViewProps) {
  const highRiskCount = weakSpots.filter((w) => w.mustHaveRisk).length;
  const readyCount = weakSpots.filter((w) => w.status === 'ready').length;

  const averageReadiness =
    weakSpots.length > 0
      ? Math.round(
          weakSpots.reduce((sum, w) => sum + w.readinessScore, 0) / weakSpots.length,
        )
      : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div>
          <Link
            href={`/kits/${kitId}`}
            className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-100 transition-colors mb-2"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Back to Kit</span>
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Weak Spots & Readiness Diagnostic
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Joined analysis of requirement priorities, question coverage, and flashcard
            practice stats.
          </p>
        </div>

        <Link
          href={`/kits/${kitId}/practice`}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs transition-colors shadow-sm self-start sm:self-auto shrink-0"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>Practice Flashcards</span>
        </Link>
      </div>

      {/* Summary Stat Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className={highRiskCount > 0 ? 'border-rose-800/60 bg-rose-950/10' : ''}>
          <CardContent className="pt-5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
                Must-Have Risks
              </span>
              <ShieldAlert
                className={`h-4 w-4 ${highRiskCount > 0 ? 'text-rose-400' : 'text-zinc-500'}`}
              />
            </div>
            <div className="text-2xl font-bold font-mono text-zinc-100">
              {highRiskCount}
            </div>
            <p className="text-[11px] text-zinc-500">
              High-priority requirements needing practice
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
                Readiness Index
              </span>
              <BarChart3 className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-zinc-100">
              {averageReadiness}%
            </div>
            <p className="text-[11px] text-zinc-500">
              Combined coverage and practice score
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
                Fully Prepared
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-zinc-100">
              {readyCount} / {weakSpots.length}
            </div>
            <p className="text-[11px] text-zinc-500">
              Requirements with high practice confidence
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Weak Spots Breakdown Table */}
      <div className="rounded-lg border border-zinc-800 bg-[#121215] shadow-xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
            Prioritized Requirement Audit (Highest Risk First)
          </h3>
          <span className="text-[11px] font-mono text-zinc-500">
            {weakSpots.length} total requirements
          </span>
        </div>

        <div className="divide-y divide-zinc-800/80">
          {weakSpots.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 font-mono">
              No requirements or weak spots found for this kit.
            </div>
          ) : (
            weakSpots.map((item) => (
              <div
                key={item.requirementId}
                className={`p-4 space-y-2.5 transition-colors ${
                  item.mustHaveRisk
                    ? 'bg-rose-950/10 hover:bg-rose-950/20'
                    : 'hover:bg-zinc-900/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                        {item.requirementId}
                      </span>
                      <Badge priority={item.priority} />
                      <Badge kind={item.kind} />

                      {item.mustHaveRisk && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          <span>MUST-HAVE RISK</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm font-medium text-zinc-100 leading-snug">
                      {item.text}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`font-mono font-bold text-sm ${
                        item.status === 'ready'
                          ? 'text-emerald-400'
                          : item.status === 'needs_practice'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {item.readinessScore}%
                    </span>
                    <span className="block text-[10px] font-mono text-zinc-500 uppercase">
                      {item.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {/* Diagnostic Metrics Row */}
                <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-400 pt-1 border-t border-zinc-800/50">
                  <span>
                    Questions:{' '}
                    <strong className="text-zinc-200">{item.questionCount}</strong>
                  </span>
                  <span>&middot;</span>
                  <span>
                    Flashcards:{' '}
                    <strong className="text-zinc-200">{item.flashcardCount}</strong>
                  </span>
                  <span>&middot;</span>
                  <span>
                    Practiced:{' '}
                    <strong className="text-zinc-200">{item.practicedCardCount}</strong>
                  </span>
                  <span>&middot;</span>
                  <span>
                    Avg Confidence:{' '}
                    <strong className="text-zinc-200">
                      {Math.round(item.confidenceScore * 100)}%
                    </strong>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
