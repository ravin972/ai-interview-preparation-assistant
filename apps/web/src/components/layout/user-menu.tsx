'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api/client.js';
import type { UserDto } from '../../types/kit.js';
import { LogOut, User as UserIcon } from 'lucide-react';

export interface UserMenuProps {
  user: UserDto;
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    try {
      setIsLoggingOut(true);
      await api.auth.logout();
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error('Logout error:', err);
      // Even if network fails, redirect to clear local navigation state
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-zinc-800 bg-zinc-900/60 text-xs text-zinc-300 font-mono">
        <UserIcon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="truncate max-w-[160px] sm:max-w-[200px]">{user.email}</span>
      </div>

      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        title="Log out"
        aria-label="Log out"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-xs text-zinc-400 hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5 text-zinc-400" />
        <span className="hidden sm:inline">
          {isLoggingOut ? 'Leaving...' : 'Log out'}
        </span>
      </button>
    </div>
  );
}
