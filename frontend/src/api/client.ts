// A single small fetch wrapper for the whole app - no data-fetching logic
// lives in page components beyond calling these functions through React
// Query hooks (see api/resources.ts).

// Set at build time. Cloudflare Pages injects VITE_API_BASE_URL from the
// project's environment variables; locally it falls back to the dev backend.
const DEFAULT_BASE_URL = 'http://localhost:4000';

function getBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL;
}

const TOKEN_STORAGE_KEY = 'zarikhata_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable (private window, blocked site data) - the
    // session just won't persist across a reload, which is a degraded
    // experience, not a crash.
  }
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = new URL(path, getBaseUrl() + '/');
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}
