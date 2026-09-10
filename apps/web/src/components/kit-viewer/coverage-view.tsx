'use client';

import React, { useState, useMemo } from 'react';
import type { Coverage, Requirement, Question } from '../../types/kit.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card.js';
import { Progress } from '../ui/progress.js';
import { Badge } from '../ui/badge.js';
import { CheckCircle2, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';

export interface CoverageViewProps {
  coverage: Coverage;
  requirements: Requirement[];
  questions: Question[];
}

export function CoverageView({ coverage, requirements, questions }: CoverageViewProps) {
  const [selectedReqId, setSelectedReqId] = useState<string | null>(
    requirements[0]?.id ?? null,
  );

  const mustReqs = useMemo(
    () => requirements.filter((r) => r.priority === 'must'),
    [requirements],
  );
  const niceReqs = useMemo(
    () => requirements.filter((r) => r.priority === 'nice'),
    [requirements],
  );

  const uncoveredSet = useMemo(
    () => new Set(coverage.uncovered_requirement_ids),
    [coverage.uncovered_requirement_ids],
  );

  const mustCoveredCount = mustReqs.filter((r) => !uncoveredSet.has(r.id)).length;
  const niceCoveredCount = niceReqs.filter((r) => !uncoveredSet.has(r.id)).length;

  const mustPercent =
    mustReqs.length > 0 ? Math.round((mustCoveredCount / mustReqs.length) * 100) : 100;
  const nicePercent =
    niceReqs.length > 0 ? Math.round((niceCoveredCount / niceReqs.length) * 100) : 100;

  // Selected requirement details
  const selectedReq = requirements.find((r) => r.id === selectedReqId);
  const coveringQuestions = useMemo(() => {
    if (!selectedReqId) return [];
    return questions.filter((q) => q.requirement_ids.includes(selectedReqId));
  }, [selectedReqId, questions]);

  return (
    <div className="space-y-6">
      {/* Coverage Meters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Must-have Coverage */}
        <Card className="border-emerald-800/40 bg-emerald-950/10">
          <CardContent className="pt-5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-400 font-mono">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>Must-Have Coverage</span>
              </div>
              <span className="font-mono text-base font-bold text-emerald-300">
                {mustPercent}%
              </span>
            </div>
            <Progress value={mustPercent} indicatorColor="bg-emerald-500" />
            <div className="text-[11px] text-zinc-400 font-mono flex justify-between">
              <span>
                {mustCoveredCount} of {mustReqs.length} covered
              </span>
              <span className="text-emerald-400 font-semibold">100% Target Met</span>
            </div>
          </CardContent>
        </Card>

        {/* Nice-to-have Coverage */}
        <Card className="border-zinc-800">
          <CardContent className="pt-5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-zinc-300 font-mono">
                <span>Nice-to-Have Coverage</span>
              </div>
              <span className="font-mono text-base font-bold text-zinc-200">
                {nicePercent}%
              </span>
            </div>
            <Progress value={nicePercent} indicatorColor="bg-zinc-400" />
            <div className="text-[11px] text-zinc-500 font-mono flex justify-between">
              <span>
                {niceCoveredCount} of {niceReqs.length} covered
              </span>
              <span>Passes executed: {coverage.passes}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Requirement <-> Question Link Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
        {/* Requirement Selection List */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono block mb-1">
            Requirements Breakdown
          </span>
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
            {requirements.map((req) => {
              const isCovered = !uncoveredSet.has(req.id);
              const isSelected = selectedReqId === req.id;

              return (
                <button
                  key={req.id}
                  onClick={() => setSelectedReqId(req.id)}
                  className={`w-full flex items-start justify-between p-3 rounded-lg border text-left text-xs transition-all ${
                    isSelected
                      ? 'border-zinc-300 bg-zinc-800/90 text-zinc-100'
                      : 'border-zinc-800 bg-[#121215] text-zinc-400 hover:border-zinc-700 hover:bg-[#18181b]'
                  }`}
                >
                  <div className="space-y-1 pr-2 truncate">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1 py-0.2 rounded">
                        {req.id}
                      </span>
                      <Badge priority={req.priority} />
                    </div>
                    <p className="truncate text-xs font-medium text-zinc-200">
                      {req.text}
                    </p>
                  </div>

                  <div className="shrink-0 pt-0.5">
                    {isCovered ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-400" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Linked Questions Panel */}
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-sm font-mono flex items-center justify-between">
                <span>Targeted Questions for {selectedReq?.id}</span>
                {selectedReq && <Badge priority={selectedReq.priority} />}
              </CardTitle>
              {selectedReq && (
                <p className="text-xs text-zinc-300 italic pt-1 leading-relaxed">
                  &ldquo;{selectedReq.text}&rdquo;
                </p>
              )}
            </CardHeader>

            <CardContent className="space-y-3">
              {coveringQuestions.length === 0 ? (
                <div className="text-center py-10 text-xs text-zinc-500 font-mono">
                  No questions currently cover this requirement.
                </div>
              ) : (
                <div className="space-y-2.5">
                  <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
                    Covering Questions ({coveringQuestions.length})
                  </span>
                  {coveringQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/60 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                            {q.id}
                          </span>
                          <Badge category={q.category} />
                          <Badge difficulty={q.difficulty} />
                        </div>
                      </div>
                      <p className="text-xs font-medium text-zinc-200">{q.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
