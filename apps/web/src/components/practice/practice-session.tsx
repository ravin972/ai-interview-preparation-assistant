'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type {
  PracticeSessionDto,
  Flashcard,
  PracticeConfidence,
  CardStatDto,
} from '../../types/kit.js';
import { api } from '../../lib/api/client.js';
import { Button } from '../ui/button.js';
import { Progress } from '../ui/progress.js';
import {
  RotateCcw,
  CheckCircle2,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowRight,
} from 'lucide-react';

export interface PracticeSessionProps {
  kitId: string;
  initialSession: PracticeSessionDto;
}

export function PracticeSession({ kitId, initialSession }: PracticeSessionProps) {
  const [cards, setCards] = useState<Flashcard[]>(initialSession.cards);
  const [stats, setStats] = useState<Record<string, CardStatDto>>(initialSession.stats);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [sessionCompleted, setSessionCompleted] = useState<boolean>(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState<number>(0);

  const currentCard = cards[currentIndex];
  const progressPercent =
    cards.length > 0 ? Math.round((currentIndex / cards.length) * 100) : 0;

  const currentStat = currentCard ? stats[currentCard.id] : undefined;

  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  const handleRate = useCallback(
    async (confidence: PracticeConfidence) => {
      if (!currentCard || isSubmitting) return;

      try {
        setIsSubmitting(true);
        const res = await api.practice.submit(kitId, currentCard.id, confidence);

        // Update local stats map
        setStats((prev) => ({
          ...prev,
          [currentCard.id]: res.stat,
        }));
        setSessionReviewedCount((prev) => prev + 1);

        // Advance to next card or complete
        if (currentIndex < cards.length - 1) {
          setIsFlipped(false);
          setCurrentIndex((prev) => prev + 1);
        } else {
          setSessionCompleted(true);
        }
      } catch (err) {
        console.error('Failed to submit confidence rating:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [kitId, currentCard, isSubmitting, currentIndex, cards.length],
  );

  // Keyboard navigation & shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Avoid firing if user is in an input/textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (sessionCompleted) return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        handleFlip();
      } else if (isFlipped) {
        if (e.key === '1') {
          e.preventDefault();
          handleRate('low');
        } else if (e.key === '2') {
          e.preventDefault();
          handleRate('medium');
        } else if (e.key === '3') {
          e.preventDefault();
          handleRate('high');
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFlip, handleRate, isFlipped, sessionCompleted]);

  // If no cards exist in kit
  if (cards.length === 0) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-4 p-8 rounded-lg border border-zinc-800 bg-[#121215]">
        <Layers className="h-8 w-8 text-zinc-500 mx-auto" />
        <h3 className="text-base font-semibold text-zinc-100">No Flashcards Available</h3>
        <p className="text-xs text-zinc-400">
          This kit does not have any flashcards generated yet.
        </p>
        <Link
          href={`/kits/${kitId}`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-zinc-100 text-zinc-950 font-medium text-xs hover:bg-zinc-200 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Return to Kit</span>
        </Link>
      </div>
    );
  }

  // Session Summary Screen
  if (sessionCompleted) {
    const totalCovered = Object.values(stats).filter((s) => s.attempts > 0).length;

    return (
      <div className="max-w-lg mx-auto my-12 p-8 rounded-lg border border-zinc-800 bg-[#121215] shadow-2xl text-center space-y-6 animate-in zoom-in-95 duration-200">
        <div className="h-14 w-14 rounded-full bg-emerald-950/60 border border-emerald-800 flex items-center justify-center mx-auto text-emerald-400">
          <CheckCircle2 className="h-8 w-8" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-bold tracking-tight text-zinc-100">
            Practice Session Complete!
          </h2>
          <p className="text-xs text-zinc-400">
            Reviewed {sessionReviewedCount} cards. EWMA confidence scores updated.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 p-4 rounded-lg bg-zinc-900/80 border border-zinc-800 font-mono text-xs">
          <div className="space-y-1">
            <div className="text-[10px] text-zinc-500 uppercase">Reviewed</div>
            <div className="text-lg font-bold text-zinc-100">{sessionReviewedCount}</div>
          </div>
          <div className="space-y-1 border-x border-zinc-800">
            <div className="text-[10px] text-zinc-500 uppercase">Total Cards</div>
            <div className="text-lg font-bold text-zinc-100">{cards.length}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-zinc-500 uppercase">Total Practiced</div>
            <div className="text-lg font-bold text-emerald-400">{totalCovered}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => {
              setCurrentIndex(0);
              setIsFlipped(false);
              setSessionCompleted(false);
              setSessionReviewedCount(0);
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Practice Again</span>
          </button>

          <Link
            href={`/kits/${kitId}/weak-spots`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold transition-colors shadow-sm"
          >
            <BarChart2 className="h-3.5 w-3.5 text-zinc-950" />
            <span>View Weak Spots</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Practice Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <Link
          href={`/kits/${kitId}`}
          className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Back to Kit</span>
        </Link>

        <div className="text-xs font-mono text-zinc-400">
          Card <strong className="text-zinc-100">{currentIndex + 1}</strong> of{' '}
          <strong className="text-zinc-100">{cards.length}</strong>
        </div>
      </div>

      {/* Session Progress Bar */}
      <Progress value={progressPercent} indicatorColor="bg-emerald-500" />

      {/* 3D Flip Flashcard */}
      <div
        onClick={handleFlip}
        role="button"
        tabIndex={0}
        aria-label={`Flashcard: ${isFlipped ? 'Answer revealed' : 'Question prompt'}. Press space or enter to flip.`}
        className="cursor-pointer min-h-[280px] sm:min-h-[320px] rounded-xl border border-zinc-700 bg-[#121215] hover:border-zinc-500 transition-all p-6 sm:p-8 flex flex-col justify-between shadow-2xl relative select-none"
      >
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
              {currentCard?.id}
            </span>
            <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
              {isFlipped ? 'Answer / Concept' : 'Question Prompt'}
            </span>
          </div>

          {currentStat && currentStat.attempts > 0 && (
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
              Confidence: {Math.round(currentStat.confidenceScore * 100)}%
            </span>
          )}
        </div>

        {/* Card Body */}
        <div className="my-auto py-6">
          {!isFlipped ? (
            <p className="text-base sm:text-lg font-medium text-zinc-100 leading-relaxed text-center">
              {currentCard?.front}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-wider text-center">
                Answer & Key Signals:
              </p>
              <p className="text-sm sm:text-base text-zinc-200 leading-relaxed text-center whitespace-pre-wrap">
                {currentCard?.back}
              </p>
            </div>
          )}
        </div>

        {/* Card Footer Hint */}
        <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-500">
          <span>Click card or press [Space] to flip</span>
          {isFlipped && (
            <span className="text-zinc-400">Keys: [1] Hard [2] Good [3] Easy</span>
          )}
        </div>
      </div>

      {/* Controls Bar */}
      <div className="pt-2">
        {!isFlipped ? (
          <Button
            variant="secondary"
            size="lg"
            onClick={handleFlip}
            className="w-full font-mono text-xs uppercase tracking-wider"
          >
            Reveal Answer (Space)
          </Button>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleRate('low')}
              disabled={isSubmitting}
              className="p-3 rounded-lg border border-rose-900/60 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 font-mono text-xs transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <div className="font-bold text-sm">Hard (1)</div>
              <div className="text-[10px] text-rose-400/80 mt-0.5">Low confidence</div>
            </button>

            <button
              onClick={() => handleRate('medium')}
              disabled={isSubmitting}
              className="p-3 rounded-lg border border-amber-900/60 bg-amber-950/20 hover:bg-amber-950/40 text-amber-300 font-mono text-xs transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <div className="font-bold text-sm">Good (2)</div>
              <div className="text-[10px] text-amber-400/80 mt-0.5">Moderate</div>
            </button>

            <button
              onClick={() => handleRate('high')}
              disabled={isSubmitting}
              className="p-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 hover:bg-emerald-950/40 text-emerald-300 font-mono text-xs transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div className="font-bold text-sm">Easy (3)</div>
              <div className="text-[10px] text-emerald-400/80 mt-0.5">Mastered</div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
