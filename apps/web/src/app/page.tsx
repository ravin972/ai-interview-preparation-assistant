import React from 'react';
import Link from 'next/link';
import { serverApi } from '../lib/api/server.js';
import { Navbar } from '../components/layout/navbar.js';
import { Footer } from '../components/layout/footer.js';
import {
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Layers,
  Terminal,
  Clock,
  Sparkles,
  BarChart3,
  Cpu,
} from 'lucide-react';

export default async function LandingPage() {
  const user = await serverApi.auth.me();

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b]">
      <Navbar user={user} />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 border-b border-zinc-800/80 overflow-hidden">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/80 text-xs text-zinc-300 font-mono">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>Phase 6 &middot; Production Ready UI</span>
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-zinc-100 max-w-3xl mx-auto leading-tight">
              Deterministic, Evidence-Backed{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 via-zinc-300 to-zinc-500">
                Interview Preparation
              </span>
            </h1>

            <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Transform any Job Description and Company URL into an auditable interview
              kit: atomic requirements, company research, categorized questions,
              flashcards, and a day-by-day study schedule.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              {user ? (
                <Link
                  href="/kits"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-zinc-100 text-zinc-950 font-medium text-sm hover:bg-zinc-200 transition-colors shadow-sm"
                >
                  <span>Go to Kits Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-zinc-100 text-zinc-950 font-medium text-sm hover:bg-zinc-200 transition-colors shadow-sm"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/login"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 font-medium text-sm hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>

            {/* Architecture Preview Box */}
            <div className="pt-10 max-w-3xl mx-auto">
              <div className="rounded-lg border border-zinc-800 bg-[#121215] p-4 text-left shadow-2xl overflow-hidden font-mono text-xs">
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-3 text-zinc-500">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                    <span className="text-[11px] text-zinc-400 ml-1">
                      16-stage-pipeline.log
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-semibold uppercase">
                    Deterministic Engine
                  </span>
                </div>
                <div className="space-y-1.5 text-zinc-300">
                  <div className="text-zinc-500"># Real-time SSE stage execution</div>
                  <div className="text-emerald-400">
                    ✓ [Stage 01] Normalized & segmented JD (2,410 chars)
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 02] Extracted 8 atomic requirements with verbatim quotes
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 03] Validated SSRF policy (strict private IP isolation)
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 06] Deterministic link ranking & crawl budget
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 10] Company brief synthesized from fetcher logs
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 13] Deterministic coverage: 100% must-haves covered
                  </div>
                  <div className="text-emerald-400">
                    ✓ [Stage 15] Schedule generated: clamped minutes [30..180]
                  </div>
                  <div className="text-zinc-400 animate-pulse">
                    → [Stage 16] Persisted canonical kit & sidecar metadata
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="py-16 md:py-24 max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center space-y-2 mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
              Visible Engineering, Zero Fluff
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-xl mx-auto">
              Built on the Trao assessment rubric with hard mathematical guarantees and
              strict boundaries.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-lg border border-zinc-800 bg-[#121215] p-5 space-y-3">
              <div className="h-8 w-8 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-200">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Verbatim Evidence Guards
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Requirements are anchored to exact spans of the job description.
                Paraphrases below 60% token overlap are dropped. Priority overrides are
                decided in deterministic code.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#121215] p-5 space-y-3">
              <div className="h-8 w-8 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-200">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Deterministic Study Schedule
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Allocates study days from 1 to 60 days. Front-loads high-impact must-haves
                on day 1. Minutes are clamped between 30 and 180 min so study plans remain
                realistic.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-[#121215] p-5 space-y-3">
              <div className="h-8 w-8 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-200">
                <BarChart3 className="h-4 w-4 text-indigo-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">
                EWMA Confidence & Weak Spots
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Flashcard practice records exponentially weighted moving average (EWMA)
                scores. The Weak Spots report joins requirements to practice stats to
                highlight must-have risks.
              </p>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
