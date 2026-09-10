'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  KitDetailDto,
  CanonicalKit,
  ItemMeta,
  QuestionDifficulty,
} from '../../types/kit.js';
import { api, ApiClientError } from '../../lib/api/client.js';
import { Tabs } from '../ui/tabs.js';
import { Button } from '../ui/button.js';
import { Alert } from '../ui/alert.js';
import { CompanyBriefView } from './company-brief-view.js';
import { RequirementsView } from './requirements-view.js';
import { QuestionsView } from './questions-view.js';
import { FlashcardsView } from './flashcards-view.js';
import { ScheduleView } from './schedule-view.js';
import { CoverageView } from './coverage-view.js';
import { ExportModal } from './export-modal.js';
import {
  Building2,
  FileCheck,
  HelpCircle,
  CreditCard,
  Calendar,
  ShieldCheck,
  Play,
  BarChart2,
  Download,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export interface KitViewerProps {
  initialKit: KitDetailDto;
}

export function KitViewer({ initialKit }: KitViewerProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('questions');
  const [kit, setKit] = useState<CanonicalKit>(initialKit.kit!);
  const [version, setVersion] = useState<number>(initialKit.version);
  const [itemMeta, setItemMeta] = useState<Record<string, ItemMeta>>(initialKit.itemMeta);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [selectedReqForFilter, setSelectedReqForFilter] = useState<string | null>(null);

  const tabs = [
    {
      id: 'questions',
      label: 'Questions',
      badge: kit.questions.length,
      icon: <HelpCircle className="h-3.5 w-3.5" />,
    },
    {
      id: 'requirements',
      label: 'Requirements',
      badge: kit.role.requirements.length,
      icon: <FileCheck className="h-3.5 w-3.5" />,
    },
    {
      id: 'schedule',
      label: 'Schedule',
      badge: `${kit.schedule.days_available}d`,
      icon: <Calendar className="h-3.5 w-3.5" />,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      badge: '100%',
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
    },
    {
      id: 'flashcards',
      label: 'Flashcards',
      badge: kit.flashcards.length,
      icon: <CreditCard className="h-3.5 w-3.5" />,
    },
    {
      id: 'brief',
      label: 'Company Brief',
      icon: <Building2 className="h-3.5 w-3.5" />,
    },
  ];

  // Helper for applying and synchronizing mutations
  async function applyMutation(
    actionName: string,
    mutationFn: () => Promise<{
      version: number;
      kit: CanonicalKit;
      itemMeta: Record<string, ItemMeta>;
    }>,
  ) {
    setErrorNotice(null);
    try {
      const res = await mutationFn();
      setVersion(res.version);
      setKit(res.kit);
      setItemMeta(res.itemMeta);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 409 || err.code === 'VERSION_CONFLICT') {
          setErrorNotice(
            `Version conflict (v${version} vs server v${err.currentVersion}). The kit was modified in another session. Please refresh to load latest data.`,
          );
        } else if (err.statusCode === 423 || err.code === 'LOCKED') {
          setErrorNotice(
            'This kit section is currently regenerating. Modifications to locked scopes are disabled until complete.',
          );
        } else {
          setErrorNotice(err.message || `Failed to ${actionName}.`);
        }
      } else {
        setErrorNotice('An unexpected network error occurred.');
      }
    }
  }

  // --- Mutation Handlers ---
  async function handlePinQuestion(id: string, pinned: boolean) {
    await applyMutation('pin question', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'pin',
        itemId: id,
        pinned,
      }),
    );
  }

  async function handleEditQuestion(
    id: string,
    updated: {
      prompt: string;
      answer_outline: string;
      difficulty: QuestionDifficulty;
    },
  ) {
    await applyMutation('edit question', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'edit_question',
        itemId: id,
        ...updated,
      }),
    );
  }

  async function handleDeleteQuestion(id: string) {
    await applyMutation('delete question', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'delete_item',
        itemId: id,
        itemType: 'question',
      }),
    );
  }

  async function handleReorderQuestions(orderedIds: string[]) {
    await applyMutation('reorder questions', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'reorder_questions',
        orderedQuestionIds: orderedIds,
      }),
    );
  }

  async function handlePinFlashcard(id: string, pinned: boolean) {
    await applyMutation('pin flashcard', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'pin',
        itemId: id,
        pinned,
      }),
    );
  }

  async function handleEditFlashcard(
    id: string,
    updated: { front: string; back: string },
  ) {
    await applyMutation('edit flashcard', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'edit_flashcard',
        itemId: id,
        ...updated,
      }),
    );
  }

  async function handleDeleteFlashcard(id: string) {
    await applyMutation('delete flashcard', () =>
      api.kits.patch(initialKit.id, {
        version,
        action: 'delete_item',
        itemId: id,
        itemType: 'flashcard',
      }),
    );
  }

  // Honest regeneration handler per user instruction 4
  async function handleRegenerate(scope: string) {
    try {
      setIsRegenerating(true);
      setErrorNotice(null);
      await api.kits.regenerate(initialKit.id, scope);
      // Reload the page to mount the generation timeline
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.statusCode === 423) {
        setErrorNotice('A regeneration job is already in progress.');
      } else {
        setErrorNotice('Failed to enqueue regeneration job.');
      }
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Kit Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-lg border border-zinc-800 bg-[#121215] shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              {kit.role.title}
            </h1>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
              {kit.role.seniority}
            </span>
            <span className="text-xs font-mono text-zinc-500">
              at{' '}
              {kit.source.company || kit.company_brief?.company_name || 'Target Company'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span>v{version}</span>
            <span>&middot;</span>
            <span>{kit.schedule.days_available} Days Plan</span>
            <span>&middot;</span>
            <span className="text-emerald-400 font-semibold">Ready</span>
          </div>
        </div>

        {/* Global Action CTAs */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/kits/${initialKit.id}/practice`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold transition-colors shadow-sm"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Practice</span>
          </Link>

          <Link
            href={`/kits/${initialKit.id}/weak-spots`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium transition-colors"
          >
            <BarChart2 className="h-3.5 w-3.5 text-indigo-400" />
            <span>Weak Spots</span>
          </Link>

          <Button
            variant="subtle"
            size="sm"
            onClick={() => setIsExportOpen(true)}
            className="gap-1.5 font-mono text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </Button>
        </div>
      </div>

      {/* Error / Conflict Alert */}
      {errorNotice && (
        <Alert variant="warning" title="Mutation Notice">
          <div className="flex items-center justify-between">
            <span>{errorNotice}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.refresh()}
              className="gap-1 ml-3 text-[11px]"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Refresh</span>
            </Button>
          </div>
        </Alert>
      )}

      {/* Main Tabs Navigation */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab Panels */}
      <div className="pt-2">
        {activeTab === 'questions' && (
          <QuestionsView
            questions={kit.questions}
            itemMeta={itemMeta}
            onPin={handlePinQuestion}
            onEdit={handleEditQuestion}
            onDelete={handleDeleteQuestion}
            onReorder={handleReorderQuestions}
            onRegenerate={handleRegenerate}
            isRegenerating={isRegenerating}
            filterRequirementId={selectedReqForFilter}
            onClearRequirementFilter={() => setSelectedReqForFilter(null)}
          />
        )}

        {activeTab === 'requirements' && (
          <RequirementsView
            requirements={kit.role.requirements}
            questions={kit.questions}
            selectedReqId={selectedReqForFilter}
            onSelectRequirement={(reqId) => {
              setSelectedReqForFilter(reqId);
              setActiveTab('questions');
            }}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleView schedule={kit.schedule} questions={kit.questions} />
        )}

        {activeTab === 'coverage' && (
          <CoverageView
            coverage={kit.coverage}
            requirements={kit.role.requirements}
            questions={kit.questions}
          />
        )}

        {activeTab === 'flashcards' && (
          <FlashcardsView
            kitId={initialKit.id}
            flashcards={kit.flashcards}
            itemMeta={itemMeta}
            onPin={handlePinFlashcard}
            onEdit={handleEditFlashcard}
            onDelete={handleDeleteFlashcard}
          />
        )}

        {activeTab === 'brief' && (
          <CompanyBriefView kit={kit} research={initialKit.research} />
        )}
      </div>

      {/* Export Modal */}
      <ExportModal
        kit={kit}
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
}
