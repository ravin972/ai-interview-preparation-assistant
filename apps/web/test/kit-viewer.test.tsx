// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { KitViewer } from '../src/components/kit-viewer/kit-viewer.js';
import { api, ApiClientError } from '../src/lib/api/client.js';
import type { KitDetailDto } from '../src/types/kit.js';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
  }),
}));

const mockKitDetail: KitDetailDto = {
  id: 'kit-test-1',
  status: 'ready',
  version: 3,
  input: {
    jd: 'Senior Distributed Systems Engineer',
    company_url: 'https://example.com',
    days: 7,
  },
  kit: {
    source: {
      jd_chars: 1200,
      company_url: 'https://example.com',
      company: 'Example Corp',
      role: 'Senior Distributed Systems Engineer',
      researched_at: '2026-09-10T12:00:00Z',
      pages_used: ['https://example.com/careers'],
    },
    company_brief: {
      company_name: 'Example Corp',
      summary: 'Building reliable distributed primitives at scale.',
      mission_or_focus: 'High availability data infrastructure',
      tech_stack_hints: ['Go', 'TypeScript', 'Kubernetes', 'MongoDB'],
      hiring_signals: ['Fast growth', 'Platform team expansion'],
      culture_notes: ['Async first', 'Engineering-led'],
      sources: ['https://example.com/careers'],
    },
    role: {
      title: 'Senior Distributed Systems Engineer',
      seniority: 'senior',
      overview: 'Lead resilient database orchestration across multi-region clusters.',
      responsibilities: [
        'Architect Raft consensus',
        'Build zero-downtime deployment pipelines',
      ],
      requirements: [
        {
          id: 'req-1',
          text: '5+ years distributed systems experience',
          kind: 'technical',
          priority: 'must',
          evidence_quote:
            'Must have at least 5 years building distributed storage or consensus engines.',
        },
        {
          id: 'req-2',
          text: 'Proficiency with Go or TypeScript',
          kind: 'technical',
          priority: 'nice',
          evidence_quote: 'Experience with modern typed backend stacks.',
        },
      ],
    },
    questions: [
      {
        id: 'q-1',
        prompt: 'How would you mitigate split-brain in a Raft partition?',
        category: 'technical',
        difficulty: 3,
        requirement_ids: ['req-1'],
        answer_outline: 'Explain quorum intersections and leader term increments.',
      },
      {
        id: 'q-2',
        prompt: 'Describe a project where you debugged distributed lock contention.',
        category: 'behavioural',
        difficulty: 2,
        requirement_ids: ['req-1'],
        answer_outline:
          'Use STAR method focusing on observability and deadlock resolution.',
      },
    ],
    flashcards: [
      {
        id: 'fc-1',
        front: 'What guarantees does Raft provide under network partition?',
        back: 'Safety: only a leader with majority quorum can commit log entries.',
        requirement_ids: ['req-1'],
      },
    ],
    schedule: {
      days_available: 7,
      days: [
        {
          day: 1,
          focus: 'Distributed Consensus & Raft',
          minutes: 45,
          question_ids: ['q-1'],
        },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 2,
    },
  },
  itemMeta: {
    'q-1': {
      origin: 'generated',
      edited: false,
      pinned: false,
      fingerprint: 'fp-q1',
      editedAt: null,
    },
    'q-2': {
      origin: 'generated',
      edited: false,
      pinned: false,
      fingerprint: 'fp-q2',
      editedAt: null,
    },
    'fc-1': {
      origin: 'generated',
      edited: false,
      pinned: false,
      fingerprint: 'fp-fc1',
      editedAt: null,
    },
  },
  tombstones: {
    questions: [],
    flashcards: [],
  },
  research: {
    pagesUsed: [
      { url: 'https://example.com/careers', title: 'Careers', status: 200, chars: 1400 },
    ],
    gaps: [],
    robotsBlocked: [],
    injectionFlags: [],
  },
  error: null,
  createdAt: '2026-09-10T12:00:00Z',
  updatedAt: '2026-09-10T12:05:00Z',
};

describe('KitViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders kit header, metadata, and default questions view', () => {
    render(<KitViewer initialKit={mockKitDetail} />);

    expect(screen.getByText('Senior Distributed Systems Engineer')).toBeDefined();
    expect(screen.getByText(/Example Corp/i)).toBeDefined();
    expect(screen.getByText('v3')).toBeDefined();
    expect(
      screen.getByText(/How would you mitigate split-brain in a Raft partition\?/i),
    ).toBeDefined();
  });

  it('switches tabs to Requirements, Schedule, and Company Brief', () => {
    render(<KitViewer initialKit={mockKitDetail} />);

    // Switch to Requirements tab
    const reqTab = screen.getByRole('tab', { name: /requirements/i });
    fireEvent.click(reqTab);
    expect(screen.getByText(/5\+ years distributed systems experience/i)).toBeDefined();
    expect(screen.getByText(/Must have at least 5 years building/i)).toBeDefined();

    // Switch to Company Brief tab
    const briefTab = screen.getByRole('tab', { name: /company brief/i });
    fireEvent.click(briefTab);
    expect(
      screen.getByText(/Building reliable distributed primitives at scale/i),
    ).toBeDefined();
  });

  it('pins a question with optimistic update and api.kits.patch call', async () => {
    vi.spyOn(api.kits, 'patch').mockResolvedValueOnce({
      id: 'kit-test-1',
      version: 4,
      kit: mockKitDetail.kit!,
      itemMeta: {
        ...mockKitDetail.itemMeta,
        'q-1': {
          ...mockKitDetail.itemMeta['q-1']!,
          pinned: true,
        },
      },
      tombstones: mockKitDetail.tombstones,
    });

    render(<KitViewer initialKit={mockKitDetail} />);

    const pinButtons = screen.getAllByTitle(/pin question/i);
    fireEvent.click(pinButtons[0]!);

    await waitFor(() => {
      expect(api.kits.patch).toHaveBeenCalledWith('kit-test-1', {
        version: 3,
        action: 'pin',
        itemId: 'q-1',
        pinned: true,
      });
      expect(screen.getByText('v4')).toBeDefined();
    });
  });

  it('handles 409 VERSION_CONFLICT gracefully with alert message', async () => {
    vi.spyOn(api.kits, 'patch').mockRejectedValueOnce(
      new ApiClientError(409, 'VERSION_CONFLICT', 'Conflict', undefined, 5),
    );

    render(<KitViewer initialKit={mockKitDetail} />);

    const pinButtons = screen.getAllByTitle(/pin question/i);
    fireEvent.click(pinButtons[0]!);

    expect(
      await screen.findByText(/Version conflict \(v3 vs server v5\)/i),
    ).toBeDefined();
  });

  it('handles 423 LOCKED gracefully with alert message', async () => {
    vi.spyOn(api.kits, 'patch').mockRejectedValueOnce(
      new ApiClientError(423, 'LOCKED', 'Kit locked'),
    );

    render(<KitViewer initialKit={mockKitDetail} />);

    const pinButtons = screen.getAllByTitle(/pin question/i);
    fireEvent.click(pinButtons[0]!);

    expect(await screen.findByText(/currently regenerating/i)).toBeDefined();
  });

  it('opens and closes canonical Appendix A export modal', () => {
    render(<KitViewer initialKit={mockKitDetail} />);

    const exportBtn = screen.getByRole('button', { name: /^export$/i });
    fireEvent.click(exportBtn);

    expect(screen.getByText(/Export Canonical Kit/i)).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    fireEvent.click(closeBtn);

    expect(screen.queryByText(/Export Canonical Kit/i)).toBeNull();
  });
});
