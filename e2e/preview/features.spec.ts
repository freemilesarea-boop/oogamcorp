import { expect, test, type Page } from '@playwright/test';
import { accounts, api, loginExecutive } from './helpers';

test.describe.configure({ mode: 'serial' });
let page: Page;
const stamp = Date.now().toString(36).slice(-4).toUpperCase();

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await loginExecutive(page);
});
test.afterAll(async () => { await page.close(); });

test('홈페이지 메뉴 전체 이동', async () => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ideas Become Impact.' })).toBeVisible();
  for (const [label, path] of [['About', '/about'], ['Business', '/business'], ['Brands', '/brands'], ['Portfolio', '/portfolio'], ['News', '/news'], ['Careers', '/careers'], ['Contact', '/contact']]) {
    await page.getByRole('banner').getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await page.goto('/brands');
  await expect(page.getByText('샘플 스튜디오').first()).toBeVisible();
});

test('대시보드', async () => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('정샘플');
  await expect(page.getByText('이번 달 재무')).toBeVisible();
  await expect(page.getByText('[샘플] 브랜드 사이트 리뉴얼').first()).toBeVisible();
});

test('프로젝트 생성 및 수정', async () => {
  await page.goto('/admin/projects');
  await page.getByTestId('new-project').click();
  await page.getByLabel('프로젝트명').fill(`[검수] 신규 프로젝트 ${stamp}`);
  await page.getByLabel('프로젝트 키 (선택)').fill(`QA${stamp}`.slice(0, 10));
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByRole('heading', { name: `[검수] 신규 프로젝트 ${stamp}` })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: '설정' }).click();
  await page.getByRole('dialog').getByLabel('상태', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('dialog').getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('프로젝트를 수정했습니다.')).toBeVisible();
  await page.getByTestId('new-task-title').fill('검수용 업무');
  await page.getByRole('button', { name: '추가' }).first().click();
  await expect(page.getByRole('button', { name: '검수용 업무' })).toBeVisible();
});

test('칸반 업무 이동 (드래그 앤 드롭, 새로고침 후 유지)', async () => {
  const projects = await api(page, 'GET', '/projects?q=%EB%A6%AC%EB%89%B4%EC%96%BC');
  const p = projects.body.items.find((x: { key: string }) => x.key === 'WEB');
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole('tab', { name: '칸반' }).click();
  const card = page.getByTestId('kanban-card').filter({ hasText: '반응형 QA' });
  const target = page.getByRole('region', { name: '검토' });
  const from = await card.boundingBox(); const to = await target.boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 20); await page.mouse.down();
  await page.mouse.move(from!.x + 40, from!.y + 30, { steps: 5 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 60, { steps: 15 }); await page.mouse.up();
  await expect(target.getByText('반응형 QA')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '칸반' }).click();
  await expect(page.getByRole('region', { name: '검토' }).getByText('반응형 QA')).toBeVisible();
});

test('노션형 문서 작성 및 자동 저장', async () => {
  const created = await api(page, 'POST', '/documents', { title: `[검수] 문서 ${stamp}` });
  expect(created.status).toBe(201);
  await page.goto(`/admin/docs/${created.body.id}`);
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await page.keyboard.type('Preview 에서 직접 작성한 본문입니다.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.getByText('체크리스트', { exact: true }).first().click();
  await page.keyboard.type('확인 항목');
  // 실시간 공동 편집 모드(협업 서버 연결)에서는 서버가 저장, 아니면 REST 자동 저장 — 둘 중 하나의 상태 표시
  await expect(page.getByText(/저장됨|실시간 연결됨/).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000); // 협업 서버 저장 디바운스(2초)
  await page.reload();
  await expect(page.locator('.ProseMirror').first()).toContainText('Preview 에서 직접 작성한 본문입니다.');
  await expect(page.locator('.ProseMirror ul[data-type="taskList"]').first()).toContainText('확인 항목');
});

test('데이터베이스 생성 및 수정', async () => {
  const db = await api(page, 'POST', '/databases', { name: `[검수] 데이터베이스 ${stamp}` });
  expect(db.status).toBe(201);
  const full = await api(page, 'GET', `/databases/${db.body.id}`);
  const title = full.body.properties.find((x: { type: string }) => x.type === 'TITLE');
  const prop = await api(page, 'POST', `/databases/${db.body.id}/properties`, { name: '단계', type: 'SELECT', config: { options: [{ id: 'a', name: '진행' }, { id: 'b', name: '완료' }] } });
  expect(prop.status).toBe(201);
  const row = await api(page, 'POST', `/databases/${db.body.id}/rows`, { cells: { [title.id]: '첫 번째 행', [prop.body.id]: 'a' } });
  expect(row.status).toBe(201);
  const bad = await api(page, 'POST', `/databases/${db.body.id}/rows`, { cells: { [prop.body.id]: 'zzz' } });
  expect(bad.status).toBe(400);
  await page.goto(`/admin/databases/${db.body.id}`);
  await expect(page.getByText('첫 번째 행')).toBeVisible();
  await page.goto('/admin/databases');
  await expect(page.getByText('[샘플] 콘텐츠 캘린더')).toBeVisible();
});

test('일정 관리', async () => {
  const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 3600_000);
  const ev = await api(page, 'POST', '/calendar/events', { title: `[검수] 일정 ${stamp}`, startAt: start.toISOString(), endAt: end.toISOString(), attendeeIds: [accounts.ownerUserId] });
  expect(ev.status).toBe(201);
  await page.goto('/admin/calendar');
  await expect(page.getByText(`[검수] 일정 ${stamp}`).first()).toBeVisible();
  await expect(page.getByText('[샘플] 주간 전체 회의').first()).toBeVisible();
});

test('예산·매출·지출 조회', async () => {
  await page.goto('/admin/finance');
  await expect(page.getByText('내부 관리용')).toBeVisible();
  await expect(page.getByText('월별 수입·지출')).toBeVisible();
  await page.goto('/admin/finance/budgets');
  await expect(page.getByText(/\[샘플\] \d{4} 마케팅 예산/).first()).toBeVisible();
  await page.goto('/admin/finance/transactions');
  await expect(page.getByText('[샘플] 브랜드 컨설팅 1차').first()).toBeVisible();
});

test('전자결재: 작성·상신 후 결재 대기 확인', async () => {
  const a = await api(page, 'POST', '/approvals', { type: 'GENERAL', title: `[검수] 결재 ${stamp}`, content: '검수용 결재', approverIds: [accounts.approver.userId], submit: true });
  expect(a.status).toBe(201);
  await page.goto('/admin/approvals');
  await page.getByRole('tab', { name: '내가 올린' }).click();
  await expect(page.getByText(`[검수] 결재 ${stamp}`)).toBeVisible();
  // 대표에게 상신된 결재가 존재 (대표 화면 '결재 대기'에 표시됨)
  const all = await api(page, 'GET', '/approvals?box=mine&pageSize=50');
  expect(all.body.items.some((x: { title: string }) => x.title === '[샘플] 촬영 장비 구매 품의')).toBe(true);
});

test('직원·부서 관리', async () => {
  await page.goto('/admin/employees');
  await expect(page.getByText('이샘플').first()).toBeVisible();
  const d = await api(page, 'POST', '/departments', { name: `검수팀${stamp}` });
  expect(d.status).toBe(201);
  await page.goto('/admin/teams');
  await expect(page.getByText(`검수팀${stamp}`).first()).toBeVisible();
});

test('홈페이지 CMS 수정 및 게시 → 공개 화면 반영', async () => {
  const cur = await api(page, 'GET', '/cms/pages/about');
  const text = `[검수 ${stamp}] CMS 에서 수정한 회사 소개 문구입니다.`;
  expect((await api(page, 'PUT', '/cms/pages/about', { content: { ...cur.body.content, body: text } })).status).toBeLessThan(300);
  await page.goto('/about');
  await expect(page.getByText(text)).toHaveCount(0); // 게시 전에는 공개 화면에 없음
  expect((await api(page, 'POST', '/cms/pages/about/publish')).status).toBeLessThan(300);
  await page.goto('/about');
  await expect(page.getByText(text)).toBeVisible();
  await page.goto('/admin/cms/pages');
  await expect(page.getByRole('heading', { name: '고정 페이지' })).toBeVisible();
});

test('미완성 기능은 화면에 개발 상태로 표시된다', async () => {
  await page.goto('/admin/calendar');
  await expect(page.getByText(/개발 상태/).first()).toBeVisible();
});
