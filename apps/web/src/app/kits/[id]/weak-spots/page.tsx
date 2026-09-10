import React from 'react';
import { notFound } from 'next/navigation';
import { serverApi } from '../../../../lib/api/server.js';
import { ApiClientError } from '../../../../lib/api/client.js';
import { WeakSpotsView } from '../../../../components/weak-spots/weak-spots-view.js';

interface WeakSpotsPageProps {
  params: Promise<{ id: string }>;
}

export default async function WeakSpotsPage({ params }: WeakSpotsPageProps) {
  const { id } = await params;

  let weakSpots;
  try {
    weakSpots = await serverApi.practice.weakSpots(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return <WeakSpotsView kitId={id} weakSpots={weakSpots} />;
}
