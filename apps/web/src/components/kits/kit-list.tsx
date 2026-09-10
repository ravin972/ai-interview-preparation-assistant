import React from 'react';
import type { KitSummaryDto } from '../../types/kit.js';
import { KitCard } from './kit-card.js';
import { KitEmptyState } from './kit-empty-state.js';

export interface KitListProps {
  kits: KitSummaryDto[];
}

export function KitList({ kits }: KitListProps) {
  if (kits.length === 0) {
    return <KitEmptyState />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {kits.map((kit) => (
        <KitCard key={kit.id} kit={kit} />
      ))}
    </div>
  );
}
