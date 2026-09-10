'use client';

import React, { useState, useMemo } from 'react';
import type {
  Question,
  ItemMeta,
  QuestionDifficulty,
  QuestionCategory,
} from '../../types/kit.js';
import { QuestionCard } from './question-card.js';
import { Button } from '../ui/button.js';
import { RefreshCw, Filter, AlertCircle } from 'lucide-react';

export interface QuestionsViewProps {
  questions: Question[];
  itemMeta: Record<string, ItemMeta>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onEdit: (
    id: string,
    updated: {
      prompt: string;
      answer_outline: string;
      difficulty: QuestionDifficulty;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onRegenerate: (scope: string) => Promise<void>;
  isRegenerating?: boolean;
  filterRequirementId?: string | null;
  onClearRequirementFilter?: () => void;
}

export function QuestionsView({
  questions,
  itemMeta,
  onPin,
  onEdit,
  onDelete,
  onReorder,
  onRegenerate,
  isRegenerating = false,
  filterRequirementId,
  onClearRequirementFilter,
}: QuestionsViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');

  const categories: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All Categories' },
    { id: 'technical', label: 'Technical' },
    { id: 'behavioural', label: 'Behavioural' },
    { id: 'system-design', label: 'System Design' },
    { id: 'company-fit', label: 'Company Fit' },
  ];

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (selectedCategory !== 'all' && q.category !== selectedCategory) {
        return false;
      }
      if (
        selectedDifficulty !== 'all' &&
        q.difficulty.toString() !== selectedDifficulty
      ) {
        return false;
      }
      if (filterRequirementId && !q.requirement_ids.includes(filterRequirementId)) {
        return false;
      }
      return true;
    });
  }, [questions, selectedCategory, selectedDifficulty, filterRequirementId]);

  function handleMove(id: string, direction: 'up' | 'down') {
    const index = questions.findIndex((q) => q.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === questions.length - 1) return;

    const newOrder = [...questions.map((q) => q.id)];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = newOrder[index]!;
    newOrder[index] = newOrder[targetIndex]!;
    newOrder[targetIndex] = temp;

    onReorder(newOrder);
  }

  return (
    <div className="space-y-5">
      {/* Top Filter & Regeneration Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-zinc-800 bg-[#121215]">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-zinc-500" />

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-zinc-100 text-zinc-950 font-bold'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Difficulty Dropdown */}
          <select
            value={selectedDifficulty}
            onChange={(e) => setSelectedDifficulty(e.target.value)}
            className="px-2.5 py-1 rounded text-xs font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
          >
            <option value="all">All Difficulties</option>
            <option value="1">Difficulty 1 (Easy)</option>
            <option value="2">Difficulty 2 (Medium)</option>
            <option value="3">Difficulty 3 (Hard)</option>
          </select>
        </div>

        {/* Honest Regeneration Button (Per User Guidance 4) */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRegenerate('questions')}
          disabled={isRegenerating}
          className="gap-2 shrink-0 font-mono text-xs"
          title="Runs a background generation job for this kit."
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
          <span>{isRegenerating ? 'Regenerating...' : 'Regenerate'}</span>
        </Button>
      </div>

      {/* Filter Requirement Breadcrumb */}
      {filterRequirementId && (
        <div className="flex items-center justify-between p-3 rounded bg-zinc-900/90 border border-zinc-700 text-xs font-mono text-zinc-300">
          <span>
            Filtering questions covering requirement:{' '}
            <strong className="text-emerald-400">{filterRequirementId}</strong>
          </span>
          <button
            onClick={onClearRequirementFilter}
            className="text-zinc-400 hover:text-white underline underline-offset-2"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Questions Stack */}
      {filteredQuestions.length === 0 ? (
        <div className="text-center py-12 rounded-lg border border-dashed border-zinc-800 bg-[#121215]/50 text-xs text-zinc-500 font-mono">
          No questions match the active filter criteria.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredQuestions.map((q, index) => (
            <QuestionCard
              key={q.id}
              question={q}
              meta={itemMeta[q.id]}
              canMoveUp={selectedCategory === 'all' && index > 0}
              canMoveDown={selectedCategory === 'all' && index < questions.length - 1}
              onPin={onPin}
              onEdit={onEdit}
              onDelete={onDelete}
              onMoveUp={(id) => handleMove(id, 'up')}
              onMoveDown={(id) => handleMove(id, 'down')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
