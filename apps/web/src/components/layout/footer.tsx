import React from 'react';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-[#09090b] py-6 text-xs text-zinc-500">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-zinc-400">
            AI Interview Preparation Assistant
          </span>
          <span>&middot;</span>
          <span>Trao Engineering Assessment</span>
        </div>
        <div className="flex items-center gap-4 text-zinc-500 font-mono text-[11px]">
          <span>16-Stage Pipeline</span>
          <span>&middot;</span>
          <span>Deterministic Schedule</span>
          <span>&middot;</span>
          <span>EWMA Practice</span>
        </div>
      </div>
    </footer>
  );
}
