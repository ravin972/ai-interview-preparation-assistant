import type {
  UserDto,
  KitSummaryDto,
  KitDetailDto,
  JobDto,
  PracticeSessionDto,
  CardStatDto,
  WeakSpotDto,
  CanonicalKit,
  ItemMeta,
  Tombstone,
  PracticeConfidence,
} from '../../types/kit.js';

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    currentVersion?: number;
  };
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // First-party session cookie automatically included
  });

  const requestId = res.headers.get('x-request-id') ?? undefined;

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${res.status}`;
    let currentVersion: number | undefined;

    try {
      const data = (await res.json()) as ApiErrorPayload;
      if (data.error) {
        code = data.error.code || code;
        message = data.error.message || message;
        currentVersion = data.error.currentVersion;
      }
    } catch {
      // Fall back to status text if response is not JSON
      message = res.statusText || message;
    }

    throw new ApiClientError(res.status, code, message, requestId, currentVersion);
  }

  // Handle empty bodies (e.g. 204 or void response)
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as unknown as T;
}

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateKitInput {
  jd: string;
  company_url: string;
  days: number;
}

export type PatchAction =
  'pin' | 'edit_question' | 'edit_flashcard' | 'delete_item' | 'reorder_questions';

export interface PatchKitInput {
  version: number;
  action: PatchAction;
  itemId?: string;
  pinned?: boolean;
  prompt?: string;
  answer_outline?: string;
  difficulty?: 1 | 2 | 3;
  front?: string;
  back?: string;
  itemType?: 'question' | 'flashcard';
  orderedQuestionIds?: string[];
}

export interface PatchKitResponse {
  id: string;
  version: number;
  kit: CanonicalKit;
  itemMeta: Record<string, ItemMeta>;
  tombstones: {
    questions: Tombstone[];
    flashcards: Tombstone[];
  };
}

export const api = {
  auth: {
    register: (body: RegisterInput) =>
      request<{ user: UserDto }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    login: (body: LoginInput) =>
      request<{ user: UserDto }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    logout: () =>
      request<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      }),
    me: () => request<{ user: UserDto }>('/api/auth/me'),
  },

  kits: {
    list: () => request<{ kits: KitSummaryDto[] }>('/api/kits'),
    get: (id: string) => request<KitDetailDto>(`/api/kits/${id}`),
    create: (body: CreateKitInput) =>
      request<{ kitId: string; jobId: string }>('/api/kits', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    patch: (id: string, body: PatchKitInput) =>
      request<PatchKitResponse>(`/api/kits/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    regenerate: (id: string, scope: string) =>
      request<{ jobId: string; scope: string }>(`/api/kits/${id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
      }),
  },

  jobs: {
    get: (id: string) => request<JobDto>(`/api/jobs/${id}`),
  },

  practice: {
    get: (id: string) => request<PracticeSessionDto>(`/api/kits/${id}/practice`),
    submit: (id: string, cardId: string, confidence: PracticeConfidence) =>
      request<{ stat: CardStatDto }>(`/api/kits/${id}/practice`, {
        method: 'POST',
        body: JSON.stringify({ cardId, confidence }),
      }),
    weakSpots: (id: string) =>
      request<{ kitId: string; weakSpots: WeakSpotDto[] }>(`/api/kits/${id}/weak-spots`),
  },
};
