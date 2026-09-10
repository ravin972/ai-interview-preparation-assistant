import React from 'react';
import Link from 'next/link';
import { serverApi } from '../../lib/api/server.js';
import { KitList } from '../../components/kits/kit-list.js';
import { Plus } from 'lucide-react';

export default async function KitsDashboardPage() {
  const kits = await serverApi.kits.list();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-zinc-100">
            Interview Kits
          </h1>
          <p className="text-xs text-zinc-400">
            Your generated preparation kits, active generation jobs, and study schedules.
          </p>
        </div>

        {kits.length > 0 && (
          <Link
            href="/kits/new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 text-xs font-medium transition-colors shadow-sm self-start sm:self-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create New Kit</span>
          </Link>
        )}
      </div>

      <KitList kits={kits} />
    </div>
  );
}
