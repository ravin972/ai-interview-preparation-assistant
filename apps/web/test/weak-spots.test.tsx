// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WeakSpotsView } from '../src/components/weak-spots/weak-spots-view.js';
import type { WeakSpotDto } from '../src/types/kit.js';

const mockWeakSpots: WeakSpotDto[] = [
  {
    requirementId: 'req-1',
    text: '5+ years experience building distributed consensus engines (Raft/Paxos)',
    priority: 'must',
    kind: 'technical',
    questionCount: 2,
    flashcardCount: 2,
    averageConfidence: 0.2,
    mustHaveRisk: true,
    readinessScore: 20,
    status: 'unprepared',
  },
  {
    requirementId: 'req-2',
    text: 'TypeScript and Node.js microservices',
    priority: 'nice',
    kind: 'technical',
    questionCount: 3,
    flashcardCount: 3,
    averageConfidence: 0.9,
    mustHaveRisk: false,
    readinessScore: 90,
    status: 'ready',
  },
];

describe('WeakSpotsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders summary statistics correctly', () => {
    render(<WeakSpotsView kitId="kit-test-1" weakSpots={mockWeakSpots} />);

    expect(screen.getByText(/Weak Spots & Readiness Diagnostic/i)).toBeDefined();

    // Must-have risks count = 1
    expect(screen.getByText('Must-Have Risks')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();

    // Fully prepared = 1 / 2
    expect(screen.getByText('1 / 2')).toBeDefined();

    // Average readiness = (20 + 90) / 2 = 55%
    expect(screen.getByText('55%')).toBeDefined();
  });

  it('highlights high-risk must-have requirements', () => {
    render(<WeakSpotsView kitId="kit-test-1" weakSpots={mockWeakSpots} />);

    expect(screen.getByText('MUST-HAVE RISK')).toBeDefined();
    expect(
      screen.getByText(/5\+ years experience building distributed consensus engines/i),
    ).toBeDefined();
    expect(screen.getByText(/TypeScript and Node\.js microservices/i)).toBeDefined();
  });

  it('renders empty state when weakSpots list is empty', () => {
    render(<WeakSpotsView kitId="kit-test-1" weakSpots={[]} />);

    expect(
      screen.getByText(/No requirements or weak spots found for this kit\./i),
    ).toBeDefined();
    expect(screen.getByText(/Back to Kit/i)).toBeDefined();
  });
});
