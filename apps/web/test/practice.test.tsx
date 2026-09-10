// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PracticeSession } from '../src/components/practice/practice-session.js';
import { api } from '../src/lib/api/client.js';
import type { PracticeSessionDto } from '../src/types/kit.js';

const mockSession: PracticeSessionDto = {
  kitId: 'kit-test-1',
  cards: [
    {
      id: 'fc-1',
      front: 'What is the Raft leader election timeout range?',
      back: 'Typically 150ms to 300ms randomized to avoid split votes.',
      requirement_ids: ['req-1'],
    },
    {
      id: 'fc-2',
      front: 'Explain idempotency key semantics.',
      back: 'Ensures deduplicated execution by caching the initial response.',
      requirement_ids: ['req-2'],
    },
  ],
  stats: {},
};

describe('PracticeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders empty state when no flashcards exist', () => {
    render(
      <PracticeSession
        kitId="kit-test-1"
        initialSession={{ kitId: 'kit-test-1', cards: [], stats: {} }}
      />,
    );

    expect(screen.getByText(/No Flashcards Available/i)).toBeDefined();
    expect(screen.getByText(/Return to Kit/i)).toBeDefined();
  });

  it('renders first card front prompt and flip button', () => {
    render(<PracticeSession kitId="kit-test-1" initialSession={mockSession} />);

    expect(
      screen.getByText(/What is the Raft leader election timeout range\?/i),
    ).toBeDefined();
    expect(screen.getByText('fc-1')).toBeDefined();
    expect(screen.getByRole('button', { name: /reveal answer/i })).toBeDefined();
  });

  it('flips card to reveal answer and rating buttons', () => {
    render(<PracticeSession kitId="kit-test-1" initialSession={mockSession} />);

    const revealBtn = screen.getByRole('button', { name: /reveal answer/i });
    fireEvent.click(revealBtn);

    expect(screen.getByText(/Typically 150ms to 300ms randomized/i)).toBeDefined();
    expect(screen.getByText(/Hard \(1\)/i)).toBeDefined();
    expect(screen.getByText(/Good \(2\)/i)).toBeDefined();
    expect(screen.getByText(/Easy \(3\)/i)).toBeDefined();
  });

  it('submits rating, updates stat, and advances to next card', async () => {
    vi.spyOn(api.practice, 'submit').mockResolvedValueOnce({
      stat: {
        cardId: 'fc-1',
        attempts: 1,
        lastConfidence: 'high',
        confidenceScore: 1.0,
        lastPracticedAt: '2026-09-10T12:00:00Z',
      },
    });

    render(<PracticeSession kitId="kit-test-1" initialSession={mockSession} />);

    // Reveal card
    fireEvent.click(screen.getByRole('button', { name: /reveal answer/i }));

    // Click Easy (3)
    const easyBtn = screen.getByText(/Easy \(3\)/i);
    fireEvent.click(easyBtn);

    await waitFor(() => {
      expect(api.practice.submit).toHaveBeenCalledWith('kit-test-1', 'fc-1', 'high');
      expect(screen.getByText(/Explain idempotency key semantics\./i)).toBeDefined();
    });
  });

  it('completes session after last card and displays summary', async () => {
    vi.spyOn(api.practice, 'submit')
      .mockResolvedValueOnce({
        stat: {
          cardId: 'fc-1',
          attempts: 1,
          lastConfidence: 'medium',
          confidenceScore: 0.6,
          lastPracticedAt: '2026-09-10T12:00:00Z',
        },
      })
      .mockResolvedValueOnce({
        stat: {
          cardId: 'fc-2',
          attempts: 1,
          lastConfidence: 'low',
          confidenceScore: 0.2,
          lastPracticedAt: '2026-09-10T12:01:00Z',
        },
      });

    render(<PracticeSession kitId="kit-test-1" initialSession={mockSession} />);

    // Card 1: Reveal & Rate
    fireEvent.click(screen.getByRole('button', { name: /reveal answer/i }));
    fireEvent.click(screen.getByText(/Good \(2\)/i));

    await screen.findByText(/Explain idempotency key semantics\./i);

    // Card 2: Reveal & Rate
    fireEvent.click(screen.getByRole('button', { name: /reveal answer/i }));
    fireEvent.click(screen.getByText(/Hard \(1\)/i));

    // Summary screen should appear
    expect(await screen.findByText(/Practice Session Complete!/i)).toBeDefined();
    expect(screen.getByText(/Reviewed 2 cards\./i)).toBeDefined();
    expect(screen.getByText(/View Weak Spots/i)).toBeDefined();
  });
});
