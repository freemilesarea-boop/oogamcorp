'use client';

/**
 * 브라우저용 API 클라이언트. 동일 출처 /api/v1 로 호출하며,
 * 상태 변경 요청에는 세션에 바인딩된 CSRF 토큰(X-CSRF-Token)을 첨부한다.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export function csrfToken(): string | undefined {
  return readCookie('oogam_csrf');
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, init: RequestInit & { query?: Query; json?: unknown } = {}): Promise<T> {
  const { query, json, headers, ...rest } = init;
  const method = (rest.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase();
  const h = new Headers(headers);
  if (json !== undefined) h.set('Content-Type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') {
    const t = csrfToken();
    if (t) h.set('X-CSRF-Token', t);
  }
  const res = await fetch(`/api/v1${path}${qs(query)}`, {
    ...rest,
    method,
    headers: h,
    credentials: 'same-origin',
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    if (!window.location.pathname.startsWith('/admin/login')) window.location.href = `/admin/login?next=${next}`;
  }
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('\n') : msg ?? `요청 실패 (${res.status})`, body);
  }
  return body as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export const apiGet = <T,>(path: string, query?: Query) => api<T>(path, { query });
export const apiPost = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const apiPatch = <T,>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const apiPut = <T,>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
