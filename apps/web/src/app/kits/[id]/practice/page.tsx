import React from 'react';
import { notFound } from 'next/navigation';
import { serverApi } from '../../../../lib/api/server.js';
import { ApiClientError } from '../../../../lib/api/client.js';
import { PracticeSession } from '../../../../components/practice/practice-session.js';

interface PracticePageProps {
  params: Promise<{ id: string }>;
}

export default async function PracticePage({ params }: PracticePageProps) {
  const { id } = await params;

  let session;
  try {
    session = await serverApi.practice.get(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return <PracticeSession kitId={id} initialSession={session} />;
}
