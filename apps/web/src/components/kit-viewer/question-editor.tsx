'use client';

import React, { useState } from 'react';
import type { Question, QuestionDifficulty } from '../../types/kit.js';
import { Modal } from '../ui/modal.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Textarea } from '../ui/textarea.js';

export interface QuestionEditorProps {
  question: Question;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: {
    prompt: string;
    answer_outline: string;
    difficulty: QuestionDifficulty;
  }) => Promise<void>;
}

export function QuestionEditor({
  question,
  isOpen,
  onClose,
  onSave,
}: QuestionEditorProps) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [answerOutline, setAnswerOutline] = useState(question.answer_outline);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>(question.difficulty);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setIsSaving(true);
      await onSave({
        prompt: prompt.trim(),
        answer_outline: answerOutline.trim(),
        difficulty,
      });
      onClose();
    } catch (err) {
      console.error('Failed to save question:', err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Question ${question.id}`}
      description="Update prompt, technical answer outline, or difficulty."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Textarea
          label="Interview Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          required
          disabled={isSaving}
        />

        <Textarea
          label="Answer Outline & Key Signals"
          value={answerOutline}
          onChange={(e) => setAnswerOutline(e.target.value)}
          rows={5}
          required
          disabled={isSaving}
        />

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-300 uppercase tracking-wider">
            Difficulty Level
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d as QuestionDifficulty)}
                className={`py-2 px-3 rounded border text-xs font-mono transition-colors ${
                  difficulty === d
                    ? 'border-zinc-300 bg-zinc-800 text-zinc-100 font-bold'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                Level {d} {d === 1 ? '(Easy)' : d === 2 ? '(Medium)' : '(Hard)'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-zinc-800">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSaving}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
