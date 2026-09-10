import React from 'react';
import Link from 'next/link';
import { ArrowLeft, FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="h-12 w-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
        <FileQuestion className="h-6 w-6" />
      </div>

      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-zinc-100">
          Resource Not Found
        </h2>
        <p className="text-xs text-zinc-400 max-w-sm">
          The requested interview kit, job, or page could not be found or you do not have
          permission to view it.
        </p>
      </div>

      <div className="pt-2">
        <Link
          href="/kits"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-zinc-100 text-zinc-950 font-medium text-xs hover:bg-zinc-200 transition-colors shadow-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Return to Dashboard</span>
        </Link>
      </div>
    </div>
  );
}
