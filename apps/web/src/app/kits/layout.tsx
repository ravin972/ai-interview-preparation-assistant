import React from 'react';
import { redirect } from 'next/navigation';
import { serverApi } from '../../lib/api/server.js';
import { Navbar } from '../../components/layout/navbar.js';
import { Footer } from '../../components/layout/footer.js';

export default async function KitsLayout({ children }: { children: React.ReactNode }) {
  const user = await serverApi.auth.me();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b]">
      <Navbar user={user} />
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">{children}</div>
      <Footer />
    </div>
  );
}
