import React from 'react';
import { cn } from '../../lib/utils/cn.js';
import type {
  RequirementPriority,
  RequirementKind,
  QuestionDifficulty,
  KitStatus,
  QuestionCategory,
} from '../../types/kit.js';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'must' | 'nice' | 'status' | 'difficulty' | 'kind' | 'category';
  priority?: RequirementPriority;
  status?: KitStatus;
  difficulty?: QuestionDifficulty;
  kind?: RequirementKind;
  category?: QuestionCategory;
}

export function Badge({
  className,
  variant = 'default',
  priority,
  status,
  difficulty,
  kind,
  category,
  children,
  ...props
}: BadgeProps) {
  let style = 'bg-zinc-800 text-zinc-300 border-zinc-700';

  if (priority === 'must') {
    style = 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80 font-semibold';
  } else if (priority === 'nice') {
    style = 'bg-zinc-900 text-zinc-400 border-zinc-800 font-normal';
  } else if (status === 'ready') {
    style = 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60';
  } else if (status === 'generating') {
    style = 'bg-amber-950/60 text-amber-400 border-amber-800/60 animate-pulse';
  } else if (status === 'failed') {
    style = 'bg-rose-950/60 text-rose-400 border-rose-800/60';
  } else if (difficulty === 1) {
    style = 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40';
  } else if (difficulty === 2) {
    style = 'bg-amber-950/40 text-amber-400 border-amber-800/40';
  } else if (difficulty === 3) {
    style = 'bg-rose-950/40 text-rose-400 border-rose-800/40';
  } else if (kind) {
    style = 'bg-zinc-900 text-zinc-300 border-zinc-800';
  } else if (category) {
    style = 'bg-zinc-900 text-zinc-200 border-zinc-700';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono border uppercase tracking-wider select-none',
        style,
        className,
      )}
      {...props}
    >
      {children ||
        (priority && `${priority}`) ||
        (status && `${status}`) ||
        (difficulty && `Diff ${difficulty}`) ||
        (kind && `${kind}`) ||
        (category && `${category}`)}
    </span>
  );
}
