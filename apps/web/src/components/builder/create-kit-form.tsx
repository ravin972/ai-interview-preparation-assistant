'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '../../lib/api/client.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Textarea } from '../ui/textarea.js';
import { Alert } from '../ui/alert.js';
import { Sparkles, Info, HelpCircle } from 'lucide-react';

export function CreateKitForm() {
  const router = useRouter();
  const [jd, setJd] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [days, setDays] = useState<number>(7);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field errors
  const [fieldErrors, setFieldErrors] = useState<{
    jd?: string;
    companyUrl?: string;
    days?: string;
  }>({});

  function clearFieldError(field: 'jd' | 'companyUrl' | 'days') {
    setFieldErrors((prev) => {
      const copy = { ...prev };
      delete copy[field];
      return copy;
    });
  }

  const jdCharCount = jd.length;
  const isThinJd = jdCharCount > 0 && jdCharCount < 400;

  function validate(): boolean {
    const errs: typeof fieldErrors = {};

    if (!jd.trim()) {
      errs.jd = 'Job description is required.';
    }

    if (!companyUrl.trim()) {
      errs.companyUrl = 'Company website URL is required.';
    } else {
      try {
        const parsed = new URL(companyUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errs.companyUrl = 'URL must start with http:// or https://';
        }
      } catch {
        errs.companyUrl = 'Please enter a valid URL (e.g. https://example.com)';
      }
    }

    if (!Number.isInteger(days) || days < 1 || days > 60) {
      errs.days = 'Practice days must be an integer between 1 and 60.';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!validate()) return;

    try {
      setIsLoading(true);
      const res = await api.kits.create({
        jd: jd.trim(),
        company_url: companyUrl.trim(),
        days,
      });

      // Navigate to the kit's canonical lifecycle route with jobId query param
      router.push(`/kits/${res.kitId}?jobId=${res.jobId}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 503 || err.code === 'MONGODB_TRANSACTIONS_REQUIRED') {
          setError(
            'The backend requires a replica-set or Atlas MongoDB cluster with multi-document transactions enabled.',
          );
        } else {
          setError(
            err.message || 'Failed to start generation. Please check your inputs.',
          );
        }
      } else {
        setError('An unexpected network error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {error && (
        <Alert variant="error" title="Generation Error">
          {error}
        </Alert>
      )}

      {/* 1. Job Description */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label
            htmlFor="jd-input"
            className="block text-xs font-semibold text-zinc-200 uppercase tracking-wider"
          >
            1. Job Description
          </label>
          <span
            className={`text-xs font-mono ${
              isThinJd
                ? 'text-amber-400'
                : jdCharCount >= 400
                  ? 'text-emerald-400'
                  : 'text-zinc-500'
            }`}
          >
            {jdCharCount.toLocaleString()} chars
          </span>
        </div>

        <Textarea
          id="jd-input"
          placeholder="Paste the full job description here (responsibilities, requirements, qualifications)..."
          rows={9}
          value={jd}
          onChange={(e) => {
            setJd(e.target.value);
            if (fieldErrors.jd) clearFieldError('jd');
          }}
          error={fieldErrors.jd}
          disabled={isLoading}
          required
        />

        {isThinJd && (
          <p className="text-[11px] text-amber-400/90 flex items-center gap-1 mt-1">
            <Info className="h-3 w-3 shrink-0" />
            <span>
              Note: JDs under 400 chars produce a thin, honest kit with recorded gaps (no
              synthetic requirements are invented).
            </span>
          </p>
        )}
      </div>

      {/* 2. Company URL */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label
            htmlFor="company-url-input"
            className="block text-xs font-semibold text-zinc-200 uppercase tracking-wider"
          >
            2. Company Website URL
          </label>
          <span className="text-[11px] text-zinc-500 font-mono">http:// or https://</span>
        </div>

        <Input
          id="company-url-input"
          type="url"
          placeholder="https://company.com"
          value={companyUrl}
          onChange={(e) => {
            setCompanyUrl(e.target.value);
            if (fieldErrors.companyUrl) clearFieldError('companyUrl');
          }}
          error={fieldErrors.companyUrl}
          disabled={isLoading}
          required
        />

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          The pipeline discovers about, career, and hiring pages to synthesize company
          mission, tech stack hints, and hiring signals.
        </p>
      </div>

      {/* 3. Practice Days */}
      <div className="space-y-3 pt-2">
        <div className="flex justify-between items-center">
          <label
            htmlFor="days-input"
            className="block text-xs font-semibold text-zinc-200 uppercase tracking-wider"
          >
            3. Preparation Time
          </label>
          <span className="text-xs font-mono font-bold text-zinc-100 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
            {days} {days === 1 ? 'day' : 'days'}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <input
            id="days-slider"
            type="range"
            min={1}
            max={60}
            step={1}
            value={days}
            onChange={(e) => {
              setDays(parseInt(e.target.value, 10));
              if (fieldErrors.days) clearFieldError('days');
            }}
            disabled={isLoading}
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-100"
          />
          <Input
            id="days-input"
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val)) setDays(val);
              if (fieldErrors.days) clearFieldError('days');
            }}
            className="w-20 font-mono text-center"
            disabled={isLoading}
          />
        </div>

        {fieldErrors.days && <p className="text-xs text-rose-500">{fieldErrors.days}</p>}

        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-zinc-400">
          <button
            type="button"
            onClick={() => setDays(1)}
            className={`p-2 rounded border text-left transition-colors ${
              days === 1
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
            }`}
          >
            <div className="font-semibold">1 Day</div>
            <div className="text-[10px] text-zinc-500">Intensive crunch</div>
          </button>
          <button
            type="button"
            onClick={() => setDays(7)}
            className={`p-2 rounded border text-left transition-colors ${
              days === 7
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
            }`}
          >
            <div className="font-semibold">7 Days</div>
            <div className="text-[10px] text-zinc-500">Standard prep</div>
          </button>
          <button
            type="button"
            onClick={() => setDays(30)}
            className={`p-2 rounded border text-left transition-colors ${
              days === 30
                ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
            }`}
          >
            <div className="font-semibold">30 Days</div>
            <div className="text-[10px] text-zinc-500">Full mastery</div>
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-zinc-800">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full gap-2 font-semibold"
          isLoading={isLoading}
        >
          <Sparkles className="h-4 w-4" />
          <span>Generate Interview Kit</span>
        </Button>
        <p className="text-[11px] text-zinc-500 text-center mt-2 font-mono">
          Initiates the 16-stage deterministic pipeline with live SSE audit streaming.
        </p>
      </div>
    </form>
  );
}
