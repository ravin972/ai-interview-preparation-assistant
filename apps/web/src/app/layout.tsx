import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Interview Preparation Assistant',
  description:
    'Evidence-backed, deterministic interview kits, live generation audit trail, and confidence practice.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#09090b] text-[#f4f4f5] antialiased flex flex-col font-sans selection:bg-zinc-800 selection:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
