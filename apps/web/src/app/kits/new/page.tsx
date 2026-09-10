import React from 'react';
import Link from 'next/link';
import { CreateKitForm } from '../../../components/builder/create-kit-form.js';
import { ChevronLeft } from 'lucide-react';

export default function NewKitPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/kits"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 transition-colors mb-3 font-mono"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Back to kits dashboard</span>
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-zinc-100">
          Create New Interview Kit
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Provide the job description, company URL, and your target study duration.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#121215] p-6 sm:p-8 shadow-xl">
        <CreateKitForm />
      </div>
    </div>
  );
}
