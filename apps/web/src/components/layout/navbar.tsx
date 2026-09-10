import React from 'react';
import Link from 'next/link';
import type { UserDto } from '../../types/kit.js';
import { UserMenu } from './user-menu.js';
import { Cpu, Plus } from 'lucide-react';

export interface NavbarProps {
  user?: UserDto | null;
}

export function Navbar({ user }: NavbarProps) {
  return (
    <header className="border-b border-zinc-800 bg-[#09090b]/90 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-zinc-100 font-semibold tracking-tight hover:text-zinc-300 transition-colors"
          >
            <div className="h-7 w-7 rounded bg-zinc-100 text-zinc-950 flex items-center justify-center font-mono font-bold text-xs">
              <Cpu className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Interview Kit</span>
          </Link>

          {user && (
            <nav className="flex items-center gap-4 text-xs font-medium">
              <Link
                href="/kits"
                className="text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Dashboard
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/kits/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 text-xs font-medium transition-colors shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Kit</span>
              </Link>
              <UserMenu user={user} />
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition-colors"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
