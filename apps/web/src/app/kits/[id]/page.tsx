import React from 'react';
import { notFound } from 'next/navigation';
import { serverApi } from '../../../lib/api/server.js';
import { ApiClientError } from '../../../lib/api/client.js';
import { KitViewer } from '../../../components/kit-viewer/kit-viewer.js';
import { GenerationTimelineContainer } from './generation-container.js';
import { Alert } from '../../../components/ui/alert.js';

interface KitPageProps {
  params: Promise<{ id: string }>;
}

export default async function KitPage({ params }: KitPageProps) {
  const { id } = await params;

  let kit;
  try {
    kit = await serverApi.kits.get(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  // 1. Generating state -> Live SSE audit trail
  if (kit.status === 'generating') {
    return (
      <div className="space-y-6">
        <GenerationTimelineContainer kitId={kit.id} />
      </div>
    );
  }

  // 2. Failed state -> Actionable error notice
  if (kit.status === 'failed' || !kit.kit) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 pt-8">
        <Alert variant="error" title="Kit Generation Failed">
          <div className="space-y-2">
            <p>
              {kit.error ||
                'The pipeline encountered an unrecoverable failure during generation.'}
            </p>
            <p className="text-[11px] text-zinc-400 font-mono">
              Kit ID: {kit.id} &middot; Created {new Date(kit.createdAt).toLocaleString()}
            </p>
          </div>
        </Alert>
      </div>
    );
  }

  // 3. Ready state -> Full interactive Kit Viewer
  return <KitViewer initialKit={kit} />;
}
