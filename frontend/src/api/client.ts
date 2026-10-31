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

/**
 * Broadcast when the server rejects our token.
 *
 * A session can die mid-shift - it expires after 12 hours, or the owner
 * deactivates the user from another machine. Without this, every screen just
 * says "could not load" and every save fails, and the only way out is for the
 * shopkeeper to guess that reloading might help. AuthContext listens and
 * drops straight to the login screen instead.
 */
export const SESSION_EXPIRED_EVENT = 'zarikhata:session-expired';

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

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // fetch only rejects for network-level failures - no internet, DNS, CORS.
    throw new ApiError(0, 'No connection to the server. Check the internet and try again.');
  }

  const text = await res.text();

  // Not every response is ours. A gateway timeout, a cold start or a proxy
  // error comes back as an HTML page, and parsing that blind used to put
  // `Unexpected token '<'` in front of the shopkeeper mid-sale.
  let data: any;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError(res.status, 'The server sent back something unreadable. Please try again.');
      data = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/login')) {
      setToken(null);
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, data?.error ?? messageForStatus(res.status), data?.details);
  }
  return data as T;
}

/** Plain language for the errors that arrive with no JSON body of their own. */
function messageForStatus(status: number): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'That record no longer exists.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'Cannot reach the server right now. Check the internet connection and try again.';
  }
  if (status >= 500) return 'The server hit a problem. Nothing was saved - please try again.';
  return `Request failed (${status})`;
}
