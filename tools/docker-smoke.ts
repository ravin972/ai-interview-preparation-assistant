// Docker stack end-to-end smoke test
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function run() {
  console.log(`[Smoke] Testing Docker stack at ${BASE_URL}...`);

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/health/ready`);
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status}`);
  }
  const healthData = await healthRes.json();
  console.log('[Smoke] Health check passed:', healthData);

  // 2. Register user
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'Password123!';
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!regRes.ok) {
    const err = await regRes.text();
    throw new Error(`Register failed: ${regRes.status} ${err}`);
  }
  const regData = await regRes.json();
  console.log('[Smoke] User registered:', regData.user.id);

  // 3. Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status}`);
  }
  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('No set-cookie returned on login');
  }
  const sessionCookie = setCookie.split(';')[0];
  console.log('[Smoke] User logged in, cookie acquired');

  // 4. Create Kit
  const createRes = await fetch(`${BASE_URL}/api/kits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      jd: 'Senior Backend Distributed Systems Engineer. Build high-availability ledger systems, idempotent payment processing, and event-driven architectures with MongoDB and Node.js.',
      company_url: 'https://stripe.com',
      days: 3,
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Create kit failed: ${createRes.status} ${err}`);
  }
  const { kitId, jobId } = await createRes.json();
  console.log(`[Smoke] Kit created: ${kitId}, Job created: ${jobId}`);

  // 5. Connect to SSE stream and observe generation progress
  console.log(`[Smoke] Listening to SSE stream for job ${jobId}...`);
  const sseRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/events`, {
    headers: {
      Accept: 'text/event-stream',
      Cookie: sessionCookie,
    },
  });
  if (!sseRes.ok) {
    throw new Error(`SSE stream failed: ${sseRes.status}`);
  }

  const reader = sseRes.body?.getReader();
  if (!reader) throw new Error('Cannot get reader for SSE stream');

  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const stagesSeen: string[] = [];

  const timeoutAt = Date.now() + 180000; // 3 min timeout

  while (!completed && Date.now() < timeoutAt) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const chunk of lines) {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          try {
            const data = JSON.parse(trimmed.slice(5).trim());
            if (data.stage !== undefined || data.stageName) {
              process.stdout.write(
                `\r[Smoke] Progress ${data.progress ?? 0}% - Stage: ${data.stageName || data.stage}               `,
              );
            }
            if (data.type === 'pipeline:complete' || data.status === 'completed') {
              console.log(
                '\n[Smoke] Received pipeline:complete / completed event from SSE stream!',
              );
              completed = true;
              break;
            }
          } catch {}
        }
      }
      if (completed) break;
    }
  }

  // Double check terminal job status
  const jobCheckRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`, {
    headers: { Cookie: sessionCookie },
  });
  const jobState = await jobCheckRes.json();
  console.log(
    `\n[Smoke] Job status in database: ${jobState.status}, Progress: ${jobState.progress}%`,
  );
  if (jobState.status !== 'completed') {
    throw new Error(`Job ended with status ${jobState.status}: ${jobState.error}`);
  }

  if (!completed) {
    throw new Error('Timeout waiting for job completion via SSE');
  }

  // 6. Fetch Ready Kit
  const getKitRes = await fetch(`${BASE_URL}/api/kits/${kitId}`, {
    headers: { Cookie: sessionCookie },
  });
  if (!getKitRes.ok) {
    throw new Error(`Get kit failed: ${getKitRes.status}`);
  }
  const fetchedKit = await getKitRes.json();
  console.log(`[Smoke] Kit status: ${fetchedKit.status}, Version: ${fetchedKit.version}`);
  console.log(`[Smoke] Questions generated: ${fetchedKit.kit?.questions?.length || 0}`);
  console.log(`[Smoke] Flashcards generated: ${fetchedKit.kit?.flashcards?.length || 0}`);
  console.log(`[Smoke] Schedule days: ${fetchedKit.kit?.schedule?.days?.length || 0}`);
  if (!fetchedKit.kit?.questions || fetchedKit.kit.questions.length === 0) {
    throw new Error('Kit contains no questions');
  }

  // 7. Mutate question
  const targetQuestion = fetchedKit.kit.questions[0];
  const oldPrompt = targetQuestion.prompt;
  const newPrompt = oldPrompt + ' [VERIFIED MUTATION]';

  const patchRes = await fetch(`${BASE_URL}/api/kits/${kitId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      version: fetchedKit.version,
      action: 'edit_question',
      itemId: targetQuestion.id,
      prompt: newPrompt,
    }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(`Mutation failed: ${patchRes.status} ${err}`);
  }
  const mutatedKit = await patchRes.json();
  console.log(`[Smoke] Mutated question. New version: ${mutatedKit.version}`);
  if (mutatedKit.version !== fetchedKit.version + 1) {
    throw new Error(
      `Version should increment from ${fetchedKit.version} to ${fetchedKit.version + 1}`,
    );
  }

  // 8. Test Optimistic Concurrency Conflict (TOCTOU guard)
  console.log('[Smoke] Testing optimistic concurrency conflict...');
  const stalePatchRes = await fetch(`${BASE_URL}/api/kits/${kitId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      version: fetchedKit.version, // stale version!
      action: 'edit_question',
      itemId: targetQuestion.id,
      prompt: 'Stale update attempt',
    }),
  });
  if (stalePatchRes.status !== 409) {
    throw new Error(
      `Expected 409 Conflict on stale version, got ${stalePatchRes.status}`,
    );
  }
  console.log(
    '[Smoke] Optimistic concurrency conflict correctly returned 409 VERSION_CONFLICT',
  );

  // 9. Practice Session & Weak Spot Recording
  const targetCard = fetchedKit.kit.flashcards[0];
  console.log(
    `[Smoke] Submitting practice attempt for card ${targetCard.id} with low confidence...`,
  );
  const practiceRes = await fetch(`${BASE_URL}/api/kits/${kitId}/practice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      cardId: targetCard.id,
      confidence: 'low',
    }),
  });
  if (!practiceRes.ok) {
    const err = await practiceRes.text();
    throw new Error(`Practice submission failed: ${practiceRes.status} ${err}`);
  }
  const practiceData = await practiceRes.json();
  console.log(
    '[Smoke] Practice recorded for card:',
    practiceData.cardId || targetCard.id,
  );

  // 10. Fetch Weak Spots
  const weakSpotsRes = await fetch(`${BASE_URL}/api/kits/${kitId}/weak-spots`, {
    headers: { Cookie: sessionCookie },
  });
  if (!weakSpotsRes.ok) {
    throw new Error(`Get weak spots failed: ${weakSpotsRes.status}`);
  }
  const weakSpotsData = await weakSpotsRes.json();
  console.log(`[Smoke] Weak spots retrieved: ${weakSpotsData.weakSpots?.length || 0}`);
  if (!weakSpotsData.weakSpots || weakSpotsData.weakSpots.length === 0) {
    throw new Error('Weak spot was not recorded');
  }

  // 11. Canonical Export Verification
  console.log('[Smoke] Validating canonical Appendix A kit structure...');
  const cKit = fetchedKit.kit;
  if (
    !cKit.role?.title ||
    !cKit.source?.company ||
    !cKit.role?.requirements ||
    !cKit.questions ||
    !cKit.flashcards ||
    !cKit.schedule?.days ||
    !cKit.coverage ||
    !cKit.company_brief
  ) {
    throw new Error('Canonical kit missing required Appendix A fields');
  }
  console.log(`[Smoke] Canonical export structure validated.`);
  console.log(`[Smoke]   Role: ${cKit.role.title}`);
  console.log(`[Smoke]   Company: ${cKit.source.company}`);
  console.log(`[Smoke]   Requirements count: ${cKit.role.requirements.length}`);
  console.log(`[Smoke]   Questions count: ${cKit.questions.length}`);
  console.log(`[Smoke]   Flashcards count: ${cKit.flashcards.length}`);
  console.log(`[Smoke]   Schedule days count: ${cKit.schedule.days.length}`);

  // 12. Logout & Authorization Verification
  console.log('[Smoke] Logging out...');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
  });
  if (!logoutRes.ok) {
    throw new Error(`Logout failed: ${logoutRes.status}`);
  }

  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Cookie: sessionCookie },
  });
  if (meRes.status !== 401) {
    throw new Error(`Expected 401 after logout, got ${meRes.status}`);
  }
  console.log('[Smoke] Logged out successfully. Access revoked with 401.');

  console.log('\n==================================================');
  console.log('ALL DOCKER STACK CLEAN-CLONE SMOKE TESTS PASSED!');
  console.log('==================================================');
}

run().catch((err) => {
  console.error('\n[Smoke FAILED]', err);
  process.exit(1);
});
