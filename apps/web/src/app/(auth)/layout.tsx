import React from 'react';
import Link from 'next/link';
import { Cpu } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 bg-[#09090b]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-zinc-100 font-semibold tracking-tight group"
          >
            <div className="h-8 w-8 rounded bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono font-bold text-sm shadow-sm group-hover:bg-zinc-200 transition-colors">
              <Cpu className="h-5 w-5" />
            </div>
            <span className="text-base font-semibold">Interview Kit</span>
          </Link>
          <p className="text-xs text-zinc-400">
            Evidence-backed technical interview preparation
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-[#121215] p-6 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  );
}
