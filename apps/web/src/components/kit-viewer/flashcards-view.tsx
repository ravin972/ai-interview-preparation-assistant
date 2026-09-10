'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { Flashcard, ItemMeta } from '../../types/kit.js';
import { Button } from '../ui/button.js';
import { Modal } from '../ui/modal.js';
import { Textarea } from '../ui/textarea.js';
import { Play, Pin, Edit2, Trash2 } from 'lucide-react';

export interface FlashcardsViewProps {
  kitId: string;
  flashcards: Flashcard[];
  itemMeta: Record<string, ItemMeta>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onEdit: (id: string, updated: { front: string; back: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function FlashcardsView({
  kitId,
  flashcards,
  itemMeta,
  onPin,
  onEdit,
  onDelete,
}: FlashcardsViewProps) {
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  function openEdit(card: Flashcard) {
    setEditingCard(card);
    setEditFront(card.front);
    setEditBack(card.back);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCard) return;
    try {
      setIsSaving(true);
      await onEdit(editingCard.id, {
        front: editFront.trim(),
        back: editBack.trim(),
      });
      setEditingCard(null);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirm(`Delete flashcard ${id}? This will record a tombstone.`)) {
      await onDelete(id);
    }
  }

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-zinc-800 bg-[#121215]">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-100">
            Flashcards ({flashcards.length})
          </h3>
          <p className="text-xs text-zinc-400">
            Atomic concept cards linked to extracted requirements with EWMA confidence
            tracking.
          </p>
        </div>

        <Link
          href={`/kits/${kitId}/practice`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-semibold text-xs transition-colors shadow-sm shrink-0"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          <span>Start Practice Session</span>
        </Link>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {flashcards.map((card) => {
          const meta = itemMeta[card.id];
          const isPinned = meta?.pinned ?? false;
          const isEdited = meta?.edited ?? false;

          return (
            <div
              key={card.id}
              className={`rounded-lg border bg-[#121215] p-5 space-y-3 transition-all relative ${
                isPinned
                  ? 'border-zinc-500/80 bg-zinc-900/60 shadow-sm'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                    {card.id}
                  </span>
                  {isPinned && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700">
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

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPin(card.id, !isPinned)}
                    title={isPinned ? 'Unpin card' : 'Pin card'}
                    aria-label={isPinned ? 'Unpin card' : 'Pin card'}
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
                    onClick={() => openEdit(card)}
                    title="Edit flashcard"
                    aria-label="Edit flashcard"
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(card.id)}
                    title="Delete flashcard"
                    aria-label="Delete flashcard"
                    className="p-1.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Front Preview */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase text-zinc-500 font-semibold block">
                  Front (Prompt)
                </span>
                <p className="text-xs sm:text-sm font-medium text-zinc-100 leading-snug">
                  {card.front}
                </p>
              </div>

              {/* Back Preview */}
              <div className="space-y-1 pt-2 border-t border-zinc-800/60">
                <span className="text-[10px] font-mono uppercase text-zinc-500 font-semibold block">
                  Back (Key Concept)
                </span>
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {card.back}
                </p>
              </div>

              {/* Linked Requirements */}
              {card.requirement_ids && card.requirement_ids.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-2 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/40">
                  <span>Linked Reqs:</span>
                  {card.requirement_ids.map((rid) => (
                    <span
                      key={rid}
                      className="px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-400"
                    >
                      {rid}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Modal */}
      {editingCard && (
        <Modal
          isOpen={true}
          onClose={() => setEditingCard(null)}
          title={`Edit Flashcard ${editingCard.id}`}
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <Textarea
              label="Front (Prompt / Question)"
              value={editFront}
              onChange={(e) => setEditFront(e.target.value)}
              rows={3}
              required
              disabled={isSaving}
            />

            <Textarea
              label="Back (Explanation / Core Concept)"
              value={editBack}
              onChange={(e) => setEditBack(e.target.value)}
              rows={4}
              required
              disabled={isSaving}
            />

            <div className="flex justify-end gap-2 pt-4 border-t border-zinc-800">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingCard(null)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSaving}>
                Save Flashcard
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
