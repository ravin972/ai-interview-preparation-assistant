// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ScheduleView } from '../src/components/kit-viewer/schedule-view.js';
import { CoverageView } from '../src/components/kit-viewer/coverage-view.js';
import type { Schedule, Coverage, Requirement, Question } from '../src/types/kit.js';

const mockRequirements: Requirement[] = [
  {
    id: 'req-1',
    text: 'Proficiency with distributed consensus protocols',
    kind: 'technical',
    priority: 'must',
    evidence_quote: 'Must have Raft or Paxos experience.',
  },
  {
    id: 'req-2',
    text: 'Experience with Kubernetes operations',
    kind: 'technical',
    priority: 'nice',
    evidence_quote: 'Kubernetes cluster deployment experience.',
  },
];

const mockQuestions: Question[] = [
  {
    id: 'q-1',
    prompt: 'How does Raft handle uncommitted leader log entries?',
    category: 'technical',
    difficulty: 3,
    requirement_ids: ['req-1'],
    answer_outline: 'Explain uncommitted log overwrites during term transitions.',
  },
  {
    id: 'q-2',
    prompt: 'Walk through a pod eviction debug scenario.',
    category: 'technical',
    difficulty: 2,
    requirement_ids: ['req-2'],
    answer_outline: 'Check resource limits, OOM scores, node pressure.',
  },
];

const mockSchedule: Schedule = {
  days_available: 14,
  days: [
    {
      day: 1,
      focus: 'Distributed Consensus & Raft',
      minutes: 45,
      question_ids: ['q-1'],
    },
    {
      day: 2,
      focus: 'Kubernetes Operations',
      minutes: 60,
      question_ids: ['q-2'],
    },
  ],
};

const mockCoverage: Coverage = {
  uncovered_requirement_ids: [],
  passes: 2,
};

describe('Schedule & Coverage Views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('ScheduleView', () => {
    it('renders schedule header, total duration, and day selector', () => {
      render(<ScheduleView schedule={mockSchedule} questions={mockQuestions} />);

      expect(screen.getByText(/14-Day Deterministic Study Plan/i)).toBeDefined();
      expect(
        screen.getAllByText(/Distributed Consensus & Raft/i).length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Clamped to 30–180 min per day/i)).toBeDefined();
    });

    it('switches active day and shows assigned questions', () => {
      render(<ScheduleView schedule={mockSchedule} questions={mockQuestions} />);

      // Day 1 question should be visible initially
      expect(
        screen.getByText(/How does Raft handle uncommitted leader log entries\?/i),
      ).toBeDefined();

      // Click Day 2
      const day2Btn = screen.getByRole('button', { name: /day 2/i });
      fireEvent.click(day2Btn);

      // Day 2 question should now be visible
      expect(
        screen.getByText(/Walk through a pod eviction debug scenario\./i),
      ).toBeDefined();
    });
  });

  describe('CoverageView', () => {
    it('calculates and renders 100% must-have and nice-to-have meters', () => {
      render(
        <CoverageView
          coverage={mockCoverage}
          requirements={mockRequirements}
          questions={mockQuestions}
        />,
      );

      expect(screen.getByText(/Must-Have Coverage/i)).toBeDefined();
      expect(screen.getByText(/Nice-To-Have Coverage/i)).toBeDefined();
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(2);
    });

    it('inspects questions mapped to selected requirement', () => {
      render(
        <CoverageView
          coverage={mockCoverage}
          requirements={mockRequirements}
          questions={mockQuestions}
        />,
      );

      // req-1 is selected by default, q-1 should be in covering questions list
      expect(
        screen.getByText(/How does Raft handle uncommitted leader log entries\?/i),
      ).toBeDefined();

      // Select req-2
      const req2Btn = screen.getByText(/Experience with Kubernetes operations/i);
      fireEvent.click(req2Btn);

      // q-2 should now be listed
      expect(
        screen.getByText(/Walk through a pod eviction debug scenario\./i),
      ).toBeDefined();
    });
  });
});
