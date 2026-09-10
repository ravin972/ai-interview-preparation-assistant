'use client';

import React, { useState } from 'react';
import type { Question, ItemMeta, QuestionDifficulty } from '../../types/kit.js';
import { Badge } from '../ui/badge.js';
import { QuestionEditor } from './question-editor.js';
import {
  Pin,
  Edit2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export interface QuestionCardProps {
  question: Question;
  meta?: ItemMeta | undefined;
  canMoveUp?: boolean | undefined;
  canMoveDown?: boolean | undefined;
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
  onMoveUp?: ((id: string) => void) | undefined;
  onMoveDown?: ((id: string) => void) | undefined;
}

export function QuestionCard({
  question,
  meta,
  canMoveUp = false,
  canMoveDown = false,
  onPin,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: QuestionCardProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isOutlineExpanded, setIsOutlineExpanded] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);

  const isPinned = meta?.pinned ?? false;
  const isEdited = meta?.edited ?? false;

  async function handleTogglePin() {
    try {
      setIsActionPending(true);
      await onPin(question.id, !isPinned);
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleDelete() {
    if (confirm(`Delete question ${question.id}? This will record a tombstone.`)) {
      try {
        setIsActionPending(true);
        await onDelete(question.id);
      } finally {
        setIsActionPending(false);
      }
    }
  }

  return (
    <div
      className={`rounded-lg border bg-[#121215] p-5 space-y-3 transition-all relative ${
        isPinned
          ? 'border-zinc-500/80 bg-zinc-900/60 shadow-sm'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      {/* Top Metadata Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
            {question.id}
          </span>
          <Badge category={question.category} />
          <Badge difficulty={question.difficulty} />

          {isPinned && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-100 border border-zinc-700">
              <Pin className="h-2.5 w-2.5 fill-current" />
              <span>PINNED</span>
            </span>
          )}

          {isEdited && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
              EDITED
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleTogglePin}
            disabled={isActionPending}
            title={isPinned ? 'Unpin question' : 'Pin question (survives regeneration)'}
            aria-label={isPinned ? 'Unpin question' : 'Pin question'}
            className={`p-1.5 rounded transition-colors ${
              isPinned
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80'
            }`}
          >
            <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsEditorOpen(true)}
            disabled={isActionPending}
            title="Edit question"
            aria-label="Edit question"
            className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>

          {canMoveUp && onMoveUp && (
            <button
              type="button"
              onClick={() => onMoveUp(question.id)}
              disabled={isActionPending}
              title="Move up"
              aria-label="Move question up"
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}

          {canMoveDown && onMoveDown && (
            <button
              type="button"
              onClick={() => onMoveDown(question.id)}
              disabled={isActionPending}
              title="Move down"
              aria-label="Move question down"
              className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={handleDelete}
            disabled={isActionPending}
            title="Delete question"
            aria-label="Delete question"
            className="p-1.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors ml-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Prompt */}
      <h4 className="text-sm font-medium text-zinc-100 leading-snug">
        {question.prompt}
      </h4>

      {/* Answer Outline Accordion */}
      <div className="pt-2 border-t border-zinc-800/80">
        <button
          type="button"
          onClick={() => setIsOutlineExpanded(!isOutlineExpanded)}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors font-mono"
        >
          {isOutlineExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          <span>{isOutlineExpanded ? 'Hide answer outline' : 'View answer outline'}</span>
        </button>

        {isOutlineExpanded && (
          <div className="mt-2.5 p-3 rounded bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">
            {question.answer_outline}
          </div>
        )}
      </div>

      {/* Linked Requirements */}
      {question.requirement_ids && question.requirement_ids.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-2 text-[11px] font-mono text-zinc-500">
          <span className="text-[10px] uppercase font-semibold">Covers:</span>
          {question.requirement_ids.map((rid) => (
            <span
              key={rid}
              className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400"
            >
              {rid}
            </span>
          ))}
        </div>
      )}

      {/* Inline Editor Dialog */}
      <QuestionEditor
        question={question}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={async (updated) => {
          await onEdit(question.id, updated);
        }}
      />
    </div>
  );
}
