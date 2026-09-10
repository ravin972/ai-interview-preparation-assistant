import React from 'react';
import type { Requirement, Question } from '../../types/kit.js';
import { Badge } from '../ui/badge.js';
import { Quote, CheckCircle2, ChevronRight, Hash } from 'lucide-react';

export interface RequirementsViewProps {
  requirements: Requirement[];
  questions: Question[];
  onSelectRequirement?: (reqId: string) => void;
  selectedReqId?: string | null;
}

export function RequirementsView({
  requirements,
  questions,
  onSelectRequirement,
  selectedReqId,
}: RequirementsViewProps) {
  // Count how many questions cover each requirement
  const coverageCountMap = new Map<string, number>();
  for (const req of requirements) {
    coverageCountMap.set(req.id, 0);
  }
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      const cur = coverageCountMap.get(rid) ?? 0;
      coverageCountMap.set(rid, cur + 1);
    }
  }

  const mustCount = requirements.filter((r) => r.priority === 'must').length;
  const niceCount = requirements.filter((r) => r.priority === 'nice').length;

  return (
    <div className="space-y-5">
      {/* Summary Stat Bar */}
      <div className="flex items-center justify-between p-3.5 rounded-lg border border-zinc-800 bg-[#121215] text-xs font-mono">
        <div className="flex items-center gap-4">
          <span className="text-zinc-400">
            Total Requirements:{' '}
            <strong className="text-zinc-100">{requirements.length}</strong>
          </span>
          <span className="text-emerald-400">
            Must-have: <strong>{mustCount}</strong>
          </span>
          <span className="text-zinc-400">
            Nice-to-have: <strong>{niceCount}</strong>
          </span>
        </div>
        <span className="text-[11px] text-zinc-500 hidden sm:inline">
          Click a requirement to inspect covering questions
        </span>
      </div>

      {/* Requirement Cards */}
      <div className="space-y-3">
        {requirements.map((req) => {
          const coveringQuestionsCount = coverageCountMap.get(req.id) ?? 0;
          const isSelected = selectedReqId === req.id;

          return (
            <div
              key={req.id}
              onClick={() => onSelectRequirement?.(req.id)}
              className={`p-4 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? 'border-zinc-400 bg-zinc-900/90 ring-1 ring-zinc-400'
                  : 'border-zinc-800 bg-[#121215] hover:border-zinc-700 hover:bg-[#18181b]'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                    {req.id}
                  </span>
                  <Badge priority={req.priority} />
                  <Badge kind={req.kind} />
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 shrink-0">
                  <CheckCircle2
                    className={`h-3.5 w-3.5 ${
                      coveringQuestionsCount > 0 ? 'text-emerald-400' : 'text-zinc-600'
                    }`}
                  />
                  <span>
                    {coveringQuestionsCount}{' '}
                    {coveringQuestionsCount === 1 ? 'question' : 'questions'}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                </div>
              </div>

              <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed font-medium">
                {req.text}
              </p>

              {/* Verbatim JD Evidence Quote (D-012) */}
              {req.evidence_quote && (
                <div className="mt-2.5 p-2 rounded bg-zinc-900/70 border border-zinc-800/80 text-[11px] text-zinc-400 font-mono flex items-start gap-2">
                  <Quote className="h-3.5 w-3.5 text-zinc-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[10px] block">
                      Verbatim JD Evidence Span:
                    </span>
                    <span className="text-zinc-300 italic">
                      &ldquo;{req.evidence_quote}&rdquo;
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
