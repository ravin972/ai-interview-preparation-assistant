import React from 'react';
import Link from 'next/link';
import type { KitSummaryDto } from '../../types/kit.js';
import { Badge } from '../ui/badge.js';
import { Briefcase, Calendar, ChevronRight, Building } from 'lucide-react';

export interface KitCardProps {
  kit: KitSummaryDto;
}

export function KitCard({ kit }: KitCardProps) {
  const title = kit.role?.title || 'Engineering Role';
  const seniority = kit.role?.seniority;
  const company = kit.company || 'Company Research';
  const formattedDate = new Date(kit.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Link
      href={`/kits/${kit.id}`}
      className="group block rounded-lg border border-zinc-800 bg-[#121215] p-5 hover:border-zinc-700 hover:bg-[#18181b] transition-all shadow-sm relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
              {title}
            </h3>
            {seniority && (
              <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                {seniority}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Building className="h-3.5 w-3.5 text-zinc-500" />
            <span className="truncate max-w-[240px]">{company}</span>
          </div>
        </div>

        <Badge status={kit.status} />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500 pt-3 border-t border-zinc-800/80 font-mono">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Calendar className="h-3.5 w-3.5 text-zinc-500" />
          <span>{kit.days} days plan</span>
        </div>

        <div className="flex items-center gap-1 text-zinc-400 group-hover:text-zinc-200 transition-colors">
          <span>{formattedDate}</span>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
