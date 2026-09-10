import React from 'react';
import type { CanonicalKit, KitResearch } from '../../types/kit.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card.js';
import { Alert } from '../ui/alert.js';
import {
  Building2,
  Globe,
  ExternalLink,
  Cpu,
  Target,
  Users,
  AlertCircle,
  FileText,
} from 'lucide-react';

export interface CompanyBriefViewProps {
  kit: CanonicalKit;
  research: KitResearch;
}

export function CompanyBriefView({ kit, research }: CompanyBriefViewProps) {
  const brief = kit.company_brief;
  const role = kit.role;
  const source = kit.source;

  return (
    <div className="space-y-6">
      {/* Research Gaps / Notices (Honest reporting per D-017, D-027) */}
      {research.gaps && research.gaps.length > 0 && (
        <Alert variant="gap" title="Research Coverage Transparency">
          <div className="space-y-1 mt-1 text-xs">
            <p>Some external research stages were degraded or unavailable:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-zinc-400">
              {research.gaps.map((gap, i) => (
                <li key={i}>
                  <strong className="text-zinc-300 font-mono">{gap.stage}:</strong>{' '}
                  {gap.reason}
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      {/* Role Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{role.title}</CardTitle>
              <CardDescription className="mt-1 font-mono text-zinc-400">
                Seniority: <strong className="text-zinc-200">{role.seniority}</strong>
              </CardDescription>
            </div>
            <div className="text-xs font-mono text-zinc-500 bg-zinc-900 px-2.5 py-1 rounded border border-zinc-800">
              {source.jd_chars.toLocaleString()} chars JD
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-300 leading-relaxed">{role.overview}</p>

          {role.responsibilities && role.responsibilities.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-zinc-800/60">
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Key Responsibilities
              </h4>
              <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-400 leading-relaxed">
                {role.responsibilities.map((resp, i) => (
                  <li key={i}>{resp}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Brief */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-zinc-400" />
              <CardTitle>{brief.company_name || source.company}</CardTitle>
            </div>
            <a
              href={source.company_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 transition-colors font-mono"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px]">{source.company_url}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <CardDescription className="mt-1">
            Researched at {new Date(source.researched_at).toLocaleString()}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              Company Mission & Summary
            </h4>
            <p className="text-xs text-zinc-300 leading-relaxed">{brief.summary}</p>
            {brief.mission_or_focus && (
              <p className="text-xs text-zinc-400 italic pt-1 border-l-2 border-zinc-700 pl-3">
                &ldquo;{brief.mission_or_focus}&rdquo;
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* Tech Stack Hints */}
            {brief.tech_stack_hints && brief.tech_stack_hints.length > 0 && (
              <div className="rounded border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Tech Stack Hints</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {brief.tech_stack_hints.map((tech, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-mono"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Hiring Signals */}
            {brief.hiring_signals && brief.hiring_signals.length > 0 && (
              <div className="rounded border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  <Target className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Hiring & Team Signals</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-zinc-400">
                  {brief.hiring_signals.map((signal, i) => (
                    <li key={i}>{signal}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Sources Panel */}
          <div className="space-y-2 pt-4 border-t border-zinc-800/60">
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-zinc-400" />
              <span>Research Sources ({source.pages_used.length} pages retrieved)</span>
            </h4>
            <div className="space-y-1.5 font-mono text-xs">
              {source.pages_used.map((url, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-zinc-900/60 border border-zinc-800 text-zinc-300"
                >
                  <span className="truncate max-w-[450px]">{url}</span>
                  <span className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-1.5 py-0.2 rounded shrink-0">
                    HTTP 200
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
