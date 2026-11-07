import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { owner } from './helpers';

/** 인증서를 고정(pinning)한 원시 HTTPS 요청 — 테스트 설정의 인증정보를 상속하지 않는다 */
function rawGet(baseURL: string, path: string, auth?: string): Promise<number> {
  const ca = readFileSync('.preview/tls/preview.crt');
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(path, baseURL), { method: 'GET', ca, headers: auth ? { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {} }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
}

test('접근 인증 없이는 어떤 경로도 열리지 않는다 (401)', async ({ baseURL }) => {
  for (const path of ['/', '/admin/login', '/api/v1/health', '/api/v1/public/home', '/brands', '/collab', '/_next/static/x.js']) {
    expect(await rawGet(baseURL!, path), path).toBe(401);
  }
  // robots.txt 만 의도적으로 공개: 크롤러가 인증 없이 "전체 차단" 지시를 읽을 수 있어야 함 (다른 정보 없음)
  expect(await rawGet(baseURL!, '/robots.txt')).toBe(200);
  expect(await rawGet(baseURL!, '/', 'oogam-ceo:wrong-password')).toBe(401);
});

test('검색엔진 색인 차단: robots.txt · X-Robots-Tag · meta robots', async ({ request: req, page }) => {
  const robots = await req.get('/robots.txt');
  expect(await robots.text()).toContain('Disallow: /');
  for (const path of ['/', '/brands', '/admin/login', '/api/v1/public/home']) {
    const r = await req.get(path);
    expect(r.headers()['x-robots-tag'], path).toContain('noindex');
  }
  await page.goto('/');
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
  await expect(page.getByTestId('preview-badge')).toContainText('가상');
});

test('보안 헤더 적용 (중복 없이)', async ({ request: req }) => {
  const r = await req.get('/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
});

test('대표 계정은 MFA 등록 전 관리자 API 가 차단되고 등록 화면으로 이동한다', async ({ page }) => {
  // 대표 계정은 로그인만 확인하고 MFA 를 등록하지 않는다 (대표 본인이 최초 로그인 시 등록)
  await page.goto('/admin/login');
  await page.getByLabel('이메일').fill(owner.OWNER_EMAIL);
  await page.getByLabel('비밀번호').fill(owner.OWNER_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin\/mfa\/setup/);
  const r = await page.evaluate(() => fetch('/api/v1/projects').then(async (x) => ({ s: x.status, b: await x.json() })));
  expect(r.s).toBe(403);
  expect(r.b.code).toBe('MFA_ENROLLMENT_REQUIRED');
  await page.goto('/admin/finance');
  await expect(page).toHaveURL(/\/admin\/mfa\/setup/);
  await page.getByRole('button', { name: '다른 계정으로 로그인' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('잘못된 비밀번호·잘못된 MFA 코드는 거부된다', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('이메일').fill(owner.OWNER_EMAIL);
  await page.getByLabel('비밀번호').fill('not-the-password-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeVisible();
});
