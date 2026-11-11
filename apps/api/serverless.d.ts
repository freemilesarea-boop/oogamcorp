/**
 * @oogam/api/serverless 공개 타입 (웹 앱이 빌드 산출물 없이도 타입 검사할 수 있도록 손으로 유지).
 * 구현: src/serverless/index.ts — 시그니처를 바꾸면 이 파일도 함께 수정한다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ReadOpts {
  preview?: boolean;
}

export interface ServerlessAuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  roleKey: string;
  permissions: Set<string>;
  mfa: { enabled: boolean; verified: boolean; required: boolean };
}

export interface ServerlessPublicSite {
  site(opts?: ReadOpts): Promise<unknown>;
  home(opts?: ReadOpts): Promise<unknown>;
  page(key: string, opts?: ReadOpts): Promise<unknown>;
  businessAreas(opts?: ReadOpts): Promise<unknown>;
  businessArea(slug: string, opts?: ReadOpts): Promise<unknown>;
  brands(opts?: ReadOpts): Promise<unknown>;
  brand(slug: string, opts?: ReadOpts): Promise<unknown>;
  portfolio(q: { brand?: string; featured?: 'true' | 'false' }, opts?: ReadOpts): Promise<unknown>;
  posts(q: { type?: 'NEWS' | 'INSIGHT' | 'CAREER'; page?: number; pageSize?: number }, opts?: ReadOpts): Promise<unknown>;
  post(type: 'NEWS' | 'INSIGHT' | 'CAREER', slug: string, opts?: ReadOpts): Promise<unknown>;
  sitemap(): Promise<unknown>;
}

export function handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
export function internalPort(): Promise<number>;
export function publicSite(): Promise<ServerlessPublicSite>;
export function resolveSession(token: string | undefined): Promise<ServerlessAuthContext | null>;
export function sessionCookieName(): string;
