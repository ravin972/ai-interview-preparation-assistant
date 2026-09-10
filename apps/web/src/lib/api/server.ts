import { cookies } from 'next/headers';
import type {
  UserDto,
  KitSummaryDto,
  KitDetailDto,
  JobDto,
  PracticeSessionDto,
  WeakSpotDto,
} from '../../types/kit.js';
import { ApiClientError } from './client.js';

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    currentVersion?: number;
  };
}

async function serverRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiBase = process.env.API_PROXY_TARGET || 'http://localhost:4000';
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('kit_session');

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Explicitly forward the session cookie to the backend
  if (sessionCookie) {
    headers.set('Cookie', `kit_session=${sessionCookie.value}`);
  }

  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    cache: 'no-store', // Cache safety: authenticated user data is strictly non-cached
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
      message = res.statusText || message;
    }

    throw new ApiClientError(res.status, code, message, requestId, currentVersion);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as unknown as T;
}

export const serverApi = {
  auth: {
    me: async (): Promise<UserDto | null> => {
      try {
        const res = await serverRequest<{ user: UserDto }>('/api/auth/me');
        return res.user;
      } catch (err) {
        if (err instanceof ApiClientError && err.statusCode === 401) {
          return null;
        }
        throw err;
      }
    },
  },

  kits: {
    list: async (): Promise<KitSummaryDto[]> => {
      const res = await serverRequest<{ kits: KitSummaryDto[] }>('/api/kits');
      return res.kits;
    },
    get: async (id: string): Promise<KitDetailDto> => {
      return serverRequest<KitDetailDto>(`/api/kits/${id}`);
    },
  },

  jobs: {
    get: async (id: string): Promise<JobDto> => {
      return serverRequest<JobDto>(`/api/jobs/${id}`);
    },
  },

  practice: {
    get: async (id: string): Promise<PracticeSessionDto> => {
      return serverRequest<PracticeSessionDto>(`/api/kits/${id}/practice`);
    },
    weakSpots: async (id: string): Promise<WeakSpotDto[]> => {
      const res = await serverRequest<{ kitId: string; weakSpots: WeakSpotDto[] }>(
        `/api/kits/${id}/weak-spots`,
      );
      return res.weakSpots;
    },
  },
};
