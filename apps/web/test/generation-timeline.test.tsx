// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { GenerationTimeline } from '../src/components/generation/generation-timeline.js';
import * as sseModule from '../src/lib/api/sse.js';
import type { SseEventPayload } from '../src/types/kit.js';

describe('GenerationTimeline', () => {
  let emitEvent: (event: SseEventPayload) => void;
  const mockUnsubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sseModule, 'subscribeJobProgress').mockImplementation((_jobId, options) => {
      emitEvent = options.onEvent;
      return mockUnsubscribe;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all 16 pipeline stages and initial queued state', () => {
    render(<GenerationTimeline jobId="job-1" onComplete={vi.fn()} />);

    expect(screen.getByText(/Generating Interview Kit/i)).toBeDefined();
    expect(screen.getByText(/queued/i)).toBeDefined();
    expect(screen.getByText(/Normalize \+ segment JD/i)).toBeDefined();
    expect(screen.getByText(/Final validation & persist/i)).toBeDefined();
  });

  it('updates stage progress and status as SSE events arrive', () => {
    render(<GenerationTimeline jobId="job-1" onComplete={vi.fn()} />);

    act(() => {
      emitEvent({
        type: 'stage:start',
        stage: 1,
        stageName: 'Normalize + segment JD',
        progress: 6,
      });
    });

    expect(screen.getByText(/Stage 1/i)).toBeDefined();
    expect(screen.getByText(/running/i)).toBeDefined();

    act(() => {
      emitEvent({
        type: 'stage:complete',
        stage: 1,
        stageName: 'Normalize + segment JD',
        progress: 12,
        detail: '142ms elapsed',
      });
    });

    expect(screen.getByText(/142ms elapsed/i)).toBeDefined();
  });

  it('handles job:snapshot and authoritative MongoDB state sync', () => {
    const onComplete = vi.fn();
    render(<GenerationTimeline jobId="job-1" onComplete={onComplete} />);

    act(() => {
      emitEvent({
        type: 'job:snapshot',
        status: 'running',
        progress: 50,
        currentStage: 8,
        stages: [
          { n: 1, name: 'Normalize + segment JD', status: 'completed', ms: 120 },
          {
            n: 2,
            name: 'Extract requirements',
            status: 'degraded',
            ms: 800,
            detail: 'Partial extraction',
          },
        ],
      });
    });

    expect(screen.getByText(/Stage 8/i)).toBeDefined();
    expect(screen.getByText(/120ms/i)).toBeDefined();
    expect(screen.getByText(/Partial extraction/i)).toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('invokes onComplete when pipeline:complete arrives', () => {
    const onComplete = vi.fn();
    render(<GenerationTimeline jobId="job-1" onComplete={onComplete} />);

    act(() => {
      emitEvent({
        type: 'pipeline:complete',
        progress: 100,
      });
    });

    expect(onComplete).toHaveBeenCalled();
    expect(screen.getByText(/100%/i)).toBeDefined();
  });

  it('renders failure alert when pipeline:fail arrives', () => {
    render(<GenerationTimeline jobId="job-1" onComplete={vi.fn()} />);

    act(() => {
      emitEvent({
        type: 'pipeline:fail',
        error: 'LLM Rate Limit Exhausted',
      });
    });

    expect(screen.getByText(/Pipeline Generation Failed/i)).toBeDefined();
    expect(screen.getByText(/LLM Rate Limit Exhausted/i)).toBeDefined();
  });

  it('unsubscribes from SSE when unmounted', () => {
    const { unmount } = render(<GenerationTimeline jobId="job-1" onComplete={vi.fn()} />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
