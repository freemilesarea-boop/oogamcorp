import { expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface Persona { email: string; password: string; userId: string; mfaSecret: string }
export const accounts = JSON.parse(readFileSync('.preview/service-accounts.json', 'utf8')) as { ownerUserId: string; creator: Persona; approver: Persona };
export const owner = Object.fromEntries(readFileSync('.preview/owner.env', 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

export function totp(secret: string, offset = 0): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const ch of secret.toUpperCase().replace(/=+$/, '')) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(c).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

/** 가상 경영진(정샘플)으로 로그인 + MFA 검증 (대표 계정은 사용하지 않음) */
export async function loginExecutive(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('이메일').fill(accounts.creator.email);
  await page.getByLabel('비밀번호').fill(accounts.creator.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin\/mfa/);
  // 서버는 ±1 단계만 허용하고 같은 단계 코드 재사용을 거부한다 → 실패 시 다음 30초 구간까지 기다렸다가 재시도
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel('인증 코드').fill(totp(accounts.creator.mfaSecret, 0));
    await page.getByRole('button', { name: '확인' }).click();
    try {
      await expect(page).toHaveURL(/\/admin$/, { timeout: 5000 });
      return;
    } catch {
      await page.waitForTimeout((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000);
    }
  }
  throw new Error('MFA 검증 실패');
}

export async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ({ method, path, body }) => {
    const csrf = decodeURIComponent(document.cookie.match(/oogam_csrf=([^;]+)/)?.[1] ?? '');
    const r = await fetch(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { method, path, body });
}

export const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
