import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from './helpers';
import { totp } from './totp';

test.describe.configure({ mode: 'serial' });

const USER = { email: 'mfa-user@e2e.oogam', password: 'MfaUserPassw0rd!' };

test('MFA: 등록 → 로그아웃 → 재로그인 시 2단계 검증 요구 → 코드 입력 후 접근', async ({ page, browser }) => {
  // 테스트 전용 직원 계정 생성 (초대 → 수락)
  await loginAs(page);
  const roles = await apiAs(page, 'GET', '/settings/roles');
  const role = (roles.body as { id: string; key: string }[]).find((r) => r.key === 'MANAGER')!;
  const inv = await apiAs(page, 'POST', '/employees/invitations', { email: USER.email, name: 'MFA 사용자', roleId: role.id });
  expect(inv.status).toBe(201);
  const token = new URL(inv.body.inviteUrl, 'http://x').searchParams.get('token')!;

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/admin/accept-invite?token=${token}`);
  await p.getByLabel('비밀번호', { exact: true }).fill(USER.password);
  await p.getByLabel('비밀번호 확인').fill(USER.password);
  await p.getByRole('button', { name: '계정 활성화' }).click();
  await expect(p).toHaveURL(/\/admin\/login/);
  await loginAs(p, USER.email, USER.password);

  // 계정 설정에서 MFA 등록
  await p.goto('/admin/settings');
  await p.getByRole('link', { name: '2단계 인증 설정' }).click();
  await p.getByLabel('현재 비밀번호').fill(USER.password);
  await p.getByRole('button', { name: '다음' }).click();
  await expect(p.getByAltText('인증 앱 등록용 QR 코드')).toBeVisible();
  await p.getByText('QR 코드를 스캔할 수 없나요?').click();
  const secret = (await p.getByTestId('mfa-secret').textContent())!.trim();
  await p.getByLabel('인증 코드').fill(totp(secret));
  await p.getByRole('button', { name: '등록 완료' }).click();
  await expect(p.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await p.getByRole('button', { name: /보관했습니다/ }).click();
  await expect(p).toHaveURL(/\/admin\/settings/);

  // 로그아웃 후 재로그인 → MFA 화면으로 이동, API 는 차단
  await p.getByTestId('profile-menu').click();
  await p.getByTestId('logout').click();
  await p.getByLabel('이메일').fill(USER.email);
  await p.getByLabel('비밀번호').fill(USER.password);
  await p.getByRole('button', { name: '로그인' }).click();
  await expect(p).toHaveURL(/\/admin\/mfa/);
  const blocked = await apiAs(p, 'GET', '/projects');
  expect(blocked.status).toBe(401);
  expect(blocked.body.code).toBe('MFA_REQUIRED');

  // 관리자 화면 직접 접근도 MFA 화면으로 되돌림
  await p.goto('/admin/projects');
  await expect(p).toHaveURL(/\/admin\/mfa/);

  await p.getByLabel('인증 코드').fill('000000');
  await p.getByRole('button', { name: '확인' }).click();
  await expect(p.getByRole('alert')).toContainText('올바르지 않습니다');
  await p.getByLabel('인증 코드').fill(totp(secret, 1));
  await p.getByRole('button', { name: '확인' }).click();
  await expect(p).toHaveURL(/\/admin\/projects/);
  expect((await apiAs(p, 'GET', '/projects')).status).toBe(200);
  await ctx.close();
});

test('보안 헤더: 공개/관리자 페이지 CSP nonce, API 엄격 CSP', async ({ request }) => {
  const home = await request.get('/');
  const csp = home.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  const html = await home.text();
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  expect(html).toContain(`nonce="${nonce}"`);
  const admin = await request.get('/admin/login');
  expect(admin.headers()['content-security-policy']).toContain("'strict-dynamic'");
  const api = await request.get('/api/v1/health/live');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");
});

test('CSP 위반 없이 주요 화면이 동작한다', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()); });
  await page.goto('/');
  await loginAs(page);
  await page.goto('/admin/projects');
  await expect(page.getByRole('heading', { name: '프로젝트' })).toBeVisible();
  const created = await apiAs(page, 'POST', '/documents', { title: 'CSP 점검' });
  await page.goto(`/admin/docs/${created.body.id}`);
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  expect(violations.filter((v) => !/cdn\.jsdelivr\.net/.test(v))).toEqual([]);
});
