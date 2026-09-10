import React from 'react';
import Link from 'next/link';
import { Layers, Plus } from 'lucide-react';

export function KitEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-[#121215]/50 p-12 text-center max-w-lg mx-auto space-y-4">
      <div className="h-12 w-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
        <Layers className="h-6 w-6 text-zinc-400" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-semibold text-zinc-100">No interview kits yet</h3>
        <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
          Create your first interview kit by submitting a job description and company
          website to extract atomic requirements and a deterministic schedule.
        </p>
      </div>

      <div className="pt-2">
        <Link
          href="/kits/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium text-xs hover:bg-zinc-200 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>Create your first interview kit</span>
        </Link>
      </div>
    </div>
  );
}
