import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = { email: process.env.CMS_E2E_OWNER_EMAIL ?? '', password: process.env.CMS_E2E_OWNER_PASSWORD ?? '' };
const EDITOR = { email: process.env.CMS_E2E_EDITOR_EMAIL ?? '', password: process.env.CMS_E2E_EDITOR_PASSWORD ?? '' };
const SHOTS = process.env.CMS_E2E_SHOTS; // 스크린샷 저장 경로 (선택)

test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/admin/login?next=/admin/cms');
  await page.getByLabel('이메일').fill(who.email);
  await page.getByLabel('비밀번호').fill(who.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/admin/cms'));
}

/** 1×1 이 아닌 실제 이미지 (PNG, 800×500 단색) — 브라우저 캔버스로 생성 */
async function pngFile(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 500;
    const g = c.getContext('2d')!;
    g.fillStyle = '#111'; g.fillRect(0, 0, 800, 500);
    g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText('AI EDU', 60, 270);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

const AREAS = [
  { title: 'AI Education', slug: 'ai-education', subtitle: 'AI 교육', summary: '[E2E] AI 교육 요약' },
  { title: 'AI Music Media', slug: 'ai-music-media', subtitle: 'AI 음악 미디어', summary: '[E2E] AI 음악 미디어 요약' },
  { title: 'AI Technology', slug: 'ai-technology', subtitle: 'AI 기술', summary: '[E2E] AI 기술 요약' },
];

test('비인증 사용자: 관리자·사내 시스템·쓰기 API 차단', async ({ page, request }) => {
  await page.goto('/admin/cms');
  await expect(page).toHaveURL(/\/admin\/login/);
  for (const p of ['/admin/finance', '/admin/employees', '/admin/approvals', '/admin/settings/permissions']) {
    expect((await request.get(p, { maxRedirects: 0 })).status(), p).toBe(404);
  }
  for (const p of ['/api/v1/finance/budgets', '/api/v1/employees', '/api/v1/approvals']) {
    expect((await request.get(p)).status(), p).toBe(404);
  }
  expect((await request.post('/api/v1/cms/business-areas', { data: { title: 'x' } })).status()).toBe(401);
  expect((await request.put('/api/v1/cms/pages/home', { data: { content: {} } })).status()).toBe(401);
  expect((await request.post('/api/v1/cms/pages/home/publish')).status()).toBe(401);
  expect((await request.post('/api/v1/cms/media', { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.alloc(10) } } })).status()).toBe(401);
});

test('대표: 사업 영역 3개 생성·이미지 업로드·게시 → 공개 사이트 반영', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/admin/cms/business-areas');
  for (const [i, a] of AREAS.entries()) {
    await page.getByRole('button', { name: '사업 영역 추가' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('제목 *').fill(a.title);
    await dlg.getByLabel('슬러그').fill(a.slug);
    await dlg.getByLabel('보조 제목').fill(a.subtitle);
    await dlg.getByLabel('요약 (카드·상단 문구)').fill(a.summary);
    await dlg.getByLabel('상세 본문 (마크다운)').fill(`## ${a.title}\n\n[E2E] 상세 본문입니다.\n\n<script>alert(1)</script>`);
    if (i === 0) {
      await dlg.locator('input[type=file]').setInputFiles({ name: 'edu.png', mimeType: 'image/png', buffer: await pngFile(page) });
      await expect(dlg.locator('img[src*="/media/"]')).toBeVisible({ timeout: 20_000 });
    }
    await dlg.getByRole('button', { name: '저장' }).click();
    await expect(dlg).toBeHidden();
  }
  await expect(page.getByText('/business/ai-technology')).toBeVisible();
  await shot(page, '01-admin-business-areas');

  // 게시 전: 공개 상세 404
  expect((await page.request.get('/business/ai-education')).status()).toBe(404);

  for (const a of AREAS) {
    const row = page.locator('li', { hasText: `/business/${a.slug}` });
    await row.getByRole('button', { name: '게시', exact: true }).click();
    await expect(row.getByText('게시됨')).toBeVisible();
  }

  await page.goto('/');
  for (const a of AREAS) await expect(page.locator(`a[href="/business/${a.slug}"]`)).toBeVisible();
  await page.locator('a[href="/business/ai-education"]').click();
  await expect(page.getByRole('heading', { level: 1, name: 'AI Education' })).toBeVisible();
  await expect(page.locator('img[alt="AI Education 대표 이미지"]')).toBeVisible();
  // 본문의 HTML/스크립트는 실행되지 않고 텍스트로 처리
  await expect(page.locator('main script')).toHaveCount(0);
  await shot(page, '02-public-business-detail');
});

test('대표: 홈 페이지 편집 — 초안·미리보기·게시·섹션 숨김·복구', async ({ page, context }) => {
  await login(page, OWNER);
  await page.goto('/admin/cms/pages?key=home');
  await page.getByRole('textbox', { name: '헤드라인' }).fill('[E2E] 초안 헤드라인');
  // 브랜드 섹션 숨기기
  await page.getByRole('button', { name: '브랜드 숨기기' }).click();
  await page.getByRole('button', { name: '초안 저장' }).click();
  await expect(page.getByText('초안을 저장했습니다.')).toBeVisible();
  await shot(page, '03-admin-page-editor');

  // 게시 전 공개 홈에는 초안이 보이지 않음
  const anon = await context.browser()!.newContext();
  const pub = await anon.newPage();
  await pub.goto(new URL('/', page.url()).toString());
  await expect(pub.getByText('[E2E] 초안 헤드라인')).toHaveCount(0);

  // 미리보기 (새 탭) — 초안 표시 + 미리보기 표시줄
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: '미리보기' }).first().click()]);
  await preview.waitForLoadState();
  await expect(preview.getByRole('heading', { level: 1, name: '[E2E] 초안 헤드라인' })).toBeVisible();
  await expect(preview.getByText('미리보기 중')).toBeVisible();
  await expect(preview.getByText('OOGAM과 함께하는 브랜드')).toHaveCount(0);
  await shot(preview, '04-preview-draft');
  await preview.getByRole('link', { name: '미리보기 종료' }).click();
  await preview.close();

  // 게시
  await page.getByRole('button', { name: '게시', exact: true }).click();
  await expect(page.getByText('게시했습니다.')).toBeVisible();
  await pub.reload();
  await expect(pub.getByRole('heading', { level: 1, name: '[E2E] 초안 헤드라인' })).toBeVisible();
  await expect(pub.getByText('OOGAM과 함께하는 브랜드')).toHaveCount(0);

  // 수정 후 이전 버전 복구
  await page.getByRole('textbox', { name: '헤드라인' }).fill('[E2E] 두번째 헤드라인');
  await page.getByRole('button', { name: '초안 저장' }).click();
  await expect(page.getByText('초안을 저장했습니다.')).toBeVisible();
  await page.getByRole('button', { name: '변경 이력' }).click();
  const hist = page.getByRole('dialog');
  page.once('dialog', (d) => void d.accept());
  await hist.locator('li', { hasText: '게시' }).first().getByRole('button', { name: '이 버전으로 복구' }).click();
  await expect(page.getByText('이전 버전으로 복구했습니다.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: '헤드라인' })).toHaveValue('[E2E] 초안 헤드라인');
  await anon.close();
});

test('편집자(게시 권한 없음): 편집은 가능·게시 불가·게시 중 항목 수정 불가', async ({ page }) => {
  await login(page, EDITOR);
  await page.goto('/admin/cms/business-areas');
  const row = page.locator('li', { hasText: '/business/ai-education' });
  await expect(row.getByText('게시 권한자만 변경 가능')).toBeVisible();
  await expect(row.getByRole('button', { name: '게시 중단' })).toHaveCount(0);
  // 사내 업무 메뉴는 표시되지 않음
  await expect(page.getByRole('link', { name: '재무' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '직원' })).toHaveCount(0);
  // 서버 측 강제: 게시 API 직접 호출도 403
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oogam_csrf')?.value ?? '';
  const res = await page.request.post('/api/v1/cms/pages/home/publish', { headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
  expect(res.status()).toBe(403);
  await page.goto('/admin/cms/pages?key=home');
  await expect(page.getByRole('button', { name: '게시', exact: true })).toHaveCount(0);
  await shot(page, '05-editor-no-publish');
});
