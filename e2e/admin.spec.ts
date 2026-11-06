import { expect, test } from '@playwright/test';
import { apiAs, loginAs, OWNER } from './helpers';

test.describe.configure({ mode: 'serial' });

test('미인증 사용자는 관리자 화면에서 로그인으로 리다이렉트된다', async ({ page }) => {
  await page.goto('/admin/projects');
  await expect(page).toHaveURL(/\/admin\/login\?next=/);
});

test('잘못된 비밀번호는 거부된다', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('이메일').fill(OWNER.email);
  await page.getByLabel('비밀번호').fill('wrong-password-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('alert')).toContainText('올바르지 않습니다');
});

test('관리자 로그인 → 프로젝트 생성 → 업무 생성 → 칸반 확인', async ({ page }) => {
  await loginAs(page);
  await page.getByRole('link', { name: '프로젝트' }).first().click();
  await expect(page.getByRole('heading', { name: '프로젝트' })).toBeVisible();
  await page.getByTestId('new-project').click();
  await page.getByLabel('프로젝트명').fill('E2E 홈페이지 리뉴얼');
  await page.getByLabel('프로젝트 키 (선택)').fill('E2E');
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 홈페이지 리뉴얼' })).toBeVisible();

  await page.getByTestId('new-task-title').fill('메인 Hero 섹션 구현');
  await page.getByRole('button', { name: '추가' }).first().click();
  await expect(page.getByRole('button', { name: '메인 Hero 섹션 구현' })).toBeVisible();

  // 업무 상세 패널에서 상태 변경
  await page.getByRole('button', { name: '메인 Hero 섹션 구현' }).click();
  await page.getByLabel('상태', { exact: true }).selectOption('IN_PROGRESS');
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('tab', { name: '칸반' }).click();
  await expect(page.getByRole('region', { name: '진행 중' }).getByText('메인 Hero 섹션 구현')).toBeVisible();
});

test('문서 생성 및 저장', async ({ page }) => {
  await loginAs(page);
  const created = await apiAs(page, 'POST', '/documents', { title: 'E2E 회의록' });
  expect(created.status).toBe(201);
  await page.goto(`/admin/docs/${created.body.id}`);
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('E2E로 작성한 본문입니다.');
  await expect(page.getByText(/저장됨/)).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('.ProseMirror').first()).toContainText('E2E로 작성한 본문입니다.');
});

test('권한 없는 접근 차단: 직원은 재무 API·화면에 접근할 수 없다', async ({ page, browser }) => {
  await loginAs(page);
  const roles = await apiAs(page, 'GET', '/settings/roles');
  const employeeRole = (roles.body as { id: string; key: string }[]).find((r) => r.key === 'EMPLOYEE')!;
  const inv = await apiAs(page, 'POST', '/employees/invitations', { email: 'staff@e2e.oogam', name: '직원', roleId: employeeRole.id });
  expect(inv.status).toBe(201);
  const token = new URL(inv.body.inviteUrl, 'http://x').searchParams.get('token')!;

  const ctx = await browser.newContext();
  const staff = await ctx.newPage();
  await staff.goto(`/admin/accept-invite?token=${token}`);
  await staff.getByLabel('비밀번호', { exact: true }).fill('StaffPassw0rd!');
  await staff.getByLabel('비밀번호 확인').fill('StaffPassw0rd!');
  await staff.getByRole('button', { name: '계정 활성화' }).click();
  await expect(staff).toHaveURL(/\/admin\/login/);
  await loginAs(staff, 'staff@e2e.oogam', 'StaffPassw0rd!');

  // 메뉴에 재무가 보이지 않고, 직접 URL 접근 및 API 호출 모두 403
  await expect(staff.getByRole('link', { name: '재무' })).toHaveCount(0);
  const api = await apiAs(staff, 'GET', '/finance/dashboard');
  expect(api.status).toBe(403);
  await staff.goto('/admin/finance');
  await expect(staff.getByText('접근 권한 없음').first()).toBeVisible();
  await ctx.close();
});

test('홈페이지 CMS 게시: 게시 전에는 비공개, 게시 후 공개 사이트에 노출', async ({ page }) => {
  await loginAs(page);
  const brands = await apiAs(page, 'POST', '/cms/brands', { name: 'E2E Brand', slug: 'e2e-brand', tagline: 'E2E 테스트 브랜드' });
  expect(brands.status).toBe(201);
  const id = brands.body.id;
  const before = await page.request.get(`/brands/e2e-brand`);
  expect(before.status()).toBe(404);
  const pub = await apiAs(page, 'POST', `/cms/brands/${id}/status`, { status: 'PUBLISHED' });
  expect(pub.status).toBeLessThan(300);
  await expect(async () => {
    const res = await page.request.get('/api/v1/public/brands/e2e-brand');
    expect(res.status()).toBe(200);
  }).toPass({ timeout: 10_000 });
  await page.goto('/brands/e2e-brand');
  await expect(page.getByRole('heading', { name: 'E2E Brand' })).toBeVisible();
});

test('로그아웃 후 보호된 API 접근 불가', async ({ page }) => {
  await loginAs(page);
  await page.getByTestId('profile-menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  const res = await page.request.get('/api/v1/auth/me');
  expect(res.status()).toBe(401);
});
