import { INestApplication } from '@nestjs/common';
import { createApp, createUser, login, prisma, resetDatabase, type Client } from './helpers';

describe('Electronic approvals', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let exec: Client;
  let requester: Client;
  let approver1: Client;
  let approver2: Client;
  let outsider: Client;
  let ownerId: string;
  let execId: string;
  let requesterId: string;
  let a1Id: string;
  let a2Id: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    ownerId = (await prisma.user.findFirstOrThrow({ where: { email: 'owner@test.oogam' } })).id;
    const ex = await createUser(orgId, 'EXECUTIVE', { departmentName: '경영지원' });
    const r = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const a1 = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    const a2 = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    const o = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    execId = ex.id;
    requesterId = r.id;
    a1Id = a1.id;
    a2Id = a2.id;
    exec = await login(app, ex.email);
    requester = await login(app, r.email);
    approver1 = await login(app, a1.email);
    approver2 = await login(app, a2.email);
    outsider = await login(app, o.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const base = () => ({ type: 'GENERAL', title: '장비 구매 품의', content: '노트북 2대 구매를 요청합니다.', approverIds: [a1Id, a2Id] });

  it('validates the approval line', async () => {
    expect((await requester.post('/approvals', { ...base(), approverIds: [] })).status).toBe(400);
    expect((await requester.post('/approvals', { ...base(), approverIds: [a1Id, a1Id] })).status).toBe(400);
    expect((await requester.post('/approvals', { ...base(), approverIds: [requesterId] })).status).toBe(400);
    expect((await requester.post('/approvals', { ...base(), approverIds: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await requester.post('/approvals', { ...base(), approverIds: eleven })).status).toBe(400);
    expect((await requester.post('/approvals', { ...base(), hacker: 1 })).status).toBe(400);
    // 재무 권한 없는 사용자는 예산/거래 연결 불가
    const b = await owner.post('/finance/budgets', { name: 'b', fiscalYear: 2026, lines: [{ category: 'a', plannedAmount: '1' }] });
    expect((await requester.post('/approvals', { ...base(), budgetId: b.body.id })).status).toBe(403);
  });

  let id: string;

  it('creates a draft with an auto number; draft is invisible to approvers', async () => {
    const res = await requester.post('/approvals', { ...base(), amount: '2400000' });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(res.body.number).toMatch(/^APR-\d{4}-\d{4}$/);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.steps).toHaveLength(2);
    expect((await approver1.get(`/approvals/${id}`)).status).toBe(404);
  });

  it('submits and notifies the first approver', async () => {
    const res = await requester.post(`/approvals/${id}/submit`, {});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.steps.map((s: { status: string }) => s.status)).toEqual(['PENDING', 'WAITING']);
    const n = await prisma.notification.findMany({ where: { userId: a1Id, type: 'APPROVAL_REQUESTED', entityId: id } });
    expect(n).toHaveLength(1);
    expect(n[0].link).toBe(`/admin/approvals?id=${id}`);
    const todo = await approver1.get('/approvals?box=todo');
    expect(todo.body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('outsider cannot view or act; wrong approver gets 403', async () => {
    expect((await outsider.get(`/approvals/${id}`)).status).toBe(404);
    expect((await outsider.post(`/approvals/${id}/approve`, {})).status).toBe(404);
    const list = await outsider.get('/approvals');
    expect(list.body.items.find((i: { id: string }) => i.id === id)).toBeUndefined();
    expect((await outsider.get('/approvals?box=all')).status).toBe(403);
    // 2단계 결재자는 아직 차례가 아님
    expect((await approver2.post(`/approvals/${id}/approve`, {})).status).toBe(403);
    // 기안자도 결재 불가
    expect((await requester.post(`/approvals/${id}/approve`, {})).status).toBe(403);
    // approvals.read_all 보유자는 열람 가능 (금액은 finance.read 보유로 노출)
    const asExec = await exec.get(`/approvals/${id}`);
    expect(asExec.status).toBe(200);
    expect((await exec.get('/approvals?box=all')).body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('concurrent double approve → exactly one succeeds', async () => {
    const results = await Promise.all([
      approver1.post(`/approvals/${id}/approve`, { comment: '승인' }),
      approver1.post(`/approvals/${id}/approve`, { comment: '승인' }),
      approver1.post(`/approvals/${id}/approve`, { comment: '승인' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    const steps = await prisma.approvalStep.findMany({ where: { requestId: id }, orderBy: { order: 'asc' } });
    expect(steps.map((s) => s.status)).toEqual(['APPROVED', 'PENDING']);
    expect(await prisma.approvalAction.count({ where: { requestId: id, action: 'APPROVE' } })).toBe(1);
    // 이후 재승인도 409
    expect((await approver1.post(`/approvals/${id}/approve`, {})).status).toBe(409);
    expect(await prisma.notification.count({ where: { userId: a2Id, type: 'APPROVAL_REQUESTED', entityId: id } })).toBe(1);
  });

  it('stale version is rejected (optimistic locking)', async () => {
    const cur = await approver2.get(`/approvals/${id}`);
    expect((await approver2.post(`/approvals/${id}/approve`, { version: cur.body.version - 1 })).status).toBe(409);
  });

  it('request changes (comment required) → requester edits and resubmits (steps reset)', async () => {
    expect((await approver2.post(`/approvals/${id}/request-changes`, {})).status).toBe(400);
    expect((await approver2.post(`/approvals/${id}/request-changes`, { comment: '   ' })).status).toBe(400);
    const res = await approver2.post(`/approvals/${id}/request-changes`, { comment: '견적서를 첨부하세요.' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CHANGES_REQUESTED');
    expect(await prisma.notification.count({ where: { userId: requesterId, type: 'APPROVAL_CHANGES_REQUESTED', entityId: id } })).toBe(1);
    expect((await approver1.patch(`/approvals/${id}`, { title: 'x' })).status).toBe(403);
    const edit = await requester.patch(`/approvals/${id}`, { title: '장비 구매 품의 (견적 첨부)' });
    expect(edit.status).toBe(200);
    const re = await requester.post(`/approvals/${id}/submit`, { version: edit.body.version });
    expect(re.status).toBe(201);
    expect(re.body.status).toBe('PENDING');
    expect(re.body.steps.map((s: { status: string }) => s.status)).toEqual(['PENDING', 'WAITING']);
    expect(re.body.actions.map((a: { action: string }) => a.action)).toEqual(['SUBMIT', 'APPROVE', 'REQUEST_CHANGES', 'RESUBMIT']);
  });

  it('multi-step approval completes and notifies the requester', async () => {
    expect((await approver1.post(`/approvals/${id}/approve`, {})).status).toBe(201);
    const fin = await approver2.post(`/approvals/${id}/approve`, { comment: '최종 승인' });
    expect(fin.status).toBe(201);
    expect(fin.body.status).toBe('APPROVED');
    expect(fin.body.completedAt).toBeTruthy();
    expect(await prisma.notification.count({ where: { userId: requesterId, type: 'APPROVAL_COMPLETED', entityId: id } })).toBe(1);
    expect((await requester.post(`/approvals/${id}/cancel`, {})).status).toBe(409);
    const done = await approver1.get('/approvals?box=done');
    expect(done.body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('reject requires comment and skips remaining steps', async () => {
    const r = await requester.post('/approvals', { ...base(), submit: true });
    expect(r.body.status).toBe('PENDING');
    expect((await approver1.post(`/approvals/${r.body.id}/reject`, {})).status).toBe(400);
    const res = await approver1.post(`/approvals/${r.body.id}/reject`, { comment: '예산 부족' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.steps.map((s: { status: string }) => s.status)).toEqual(['REJECTED', 'SKIPPED']);
    expect(await prisma.auditLog.count({ where: { action: 'approval.rejected', entityId: r.body.id } })).toBe(1);
  });

  it('requester can cancel while pending; others cannot', async () => {
    const r = await requester.post('/approvals', { ...base(), submit: true });
    expect((await approver1.post(`/approvals/${r.body.id}/cancel`, {})).status).toBe(403);
    const c = await requester.post(`/approvals/${r.body.id}/cancel`, { comment: '중복 기안' });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('CANCELLED');
    expect((await approver1.post(`/approvals/${r.body.id}/approve`, {})).status).toBe(409);
    expect((await requester.del(`/approvals/${r.body.id}`)).status).toBe(200);
    expect((await requester.get(`/approvals/${r.body.id}`)).status).toBe(404);
  });

  it('generates unique numbers under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => requester.post('/approvals', { ...base(), title: `동시 ${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.number);
    expect(new Set(numbers).size).toBe(8);
  });

  it('EXPENSE approval approves the linked transaction on completion (separation of duties)', async () => {
    const t = await owner.post('/finance/transactions', { txDate: '2026-06-01', type: 'EXPENSE', description: '출장비', supplyAmount: '300000', autoVat: true });
    expect(t.status).toBe(201);
    // 거래 등록자(owner)를 최종 결재자로 지정할 수 없음
    expect((await exec.post('/approvals', { type: 'EXPENSE', title: 'x', content: 'x', approverIds: [ownerId], transactionId: t.body.id })).status).toBe(400);
    const a = await owner.post('/approvals', { type: 'EXPENSE', title: '출장비 지출 결의', content: '6월 출장', approverIds: [a1Id, execId], transactionId: t.body.id, submit: true });
    expect(a.status).toBe(201);
    expect(a.body.amount).toBe('330000.00');
    expect((await prisma.financialTransaction.findUniqueOrThrow({ where: { id: t.body.id } })).status).toBe('PENDING');
    // 결재자(재무 권한 없음)도 결재 대상 금액은 볼 수 있다. 외부인은 문서 자체 열람 불가
    const asA1 = await approver1.get(`/approvals/${a.body.id}`);
    expect(asA1.body.amount).toBe('330000.00');
    expect(asA1.body.transaction.totalAmount).toBe('330000.00');
    expect((await approver1.post(`/approvals/${a.body.id}/approve`, {})).status).toBe(201);
    expect((await exec.post(`/approvals/${a.body.id}/approve`, {})).status).toBe(201);
    const tx = await prisma.financialTransaction.findUniqueOrThrow({ where: { id: t.body.id } });
    expect(tx.status).toBe('APPROVED');
    expect(tx.approvedById).toBe(execId);
    expect(tx.approvalRequestId).toBe(a.body.id);
  });

  it('BUDGET approval approves the linked budget with approved = planned', async () => {
    const b = await owner.post('/finance/budgets', { name: '결재 예산', fiscalYear: 2026, lines: [{ category: 'a', plannedAmount: '100.10' }, { category: 'b', plannedAmount: '0.20' }] });
    const a = await owner.post('/approvals', { type: 'BUDGET', title: '예산 승인 요청', content: '-', approverIds: [execId], budgetId: b.body.id, submit: true });
    expect(a.status).toBe(201);
    expect(a.body.amount).toBe('100.30');
    expect((await owner.get(`/finance/budgets/${b.body.id}`)).body.status).toBe('PENDING_APPROVAL');
    expect((await exec.post(`/approvals/${a.body.id}/approve`, {})).status).toBe(201);
    const after = await owner.get(`/finance/budgets/${b.body.id}`);
    expect(after.body.status).toBe('APPROVED');
    expect(after.body.approvedAmount).toBe('100.30');
    expect(after.body.lines.map((l: { approvedAmount: string }) => l.approvedAmount)).toEqual(['100.10', '0.20']);
  });

  it('summary counts and box filters', async () => {
    const s = await approver1.get('/approvals/summary');
    expect(s.status).toBe(200);
    expect(typeof s.body.todo).toBe('number');
    const mine = await requester.get('/approvals?box=mine&pageSize=100');
    expect(mine.body.items.every((i: { requester: { id: string } }) => i.requester.id === requesterId)).toBe(true);
    const filtered = await requester.get('/approvals?box=mine&status=APPROVED');
    expect(filtered.body.items).toHaveLength(1);
  });
});
