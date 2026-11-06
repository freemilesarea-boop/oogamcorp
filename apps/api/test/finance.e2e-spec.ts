import { INestApplication } from '@nestjs/common';
import { createApp, createUser, grantModule, login, prisma, resetDatabase, type Client } from './helpers';

describe('Finance (budgets, transactions, dashboard)', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let exec: Client;
  let manager: Client;
  let employee: Client;
  let reader: Client;
  let unitId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const ex = await createUser(orgId, 'EXECUTIVE', { departmentName: '경영지원' });
    const m = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    const e = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const r = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    await grantModule(orgId, r.id, 'finance.read');
    exec = await login(app, ex.email);
    manager = await login(app, m.email);
    employee = await login(app, e.email);
    reader = await login(app, r.email);
    const p = await manager.post('/projects', { name: '재무 테스트 프로젝트', key: 'FIN' });
    projectId = p.body.id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const READ_ENDPOINTS = ['/finance/dashboard', '/finance/budgets', '/finance/transactions', '/finance/business-units', '/finance/budget-lines', '/finance/transactions/export'];

  it('EMPLOYEE / MANAGER get 403 on all finance endpoints', async () => {
    for (const c of [employee, manager]) {
      for (const url of READ_ENDPOINTS) expect((await c.get(url)).status).toBe(403);
      expect((await c.post('/finance/budgets', { name: 'x', fiscalYear: 2026, lines: [] })).status).toBe(403);
      expect((await c.post('/finance/transactions', { txDate: '2026-01-01', type: 'EXPENSE', description: 'x', supplyAmount: '1' })).status).toBe(403);
      expect((await c.post('/finance/business-units', { name: 'x', code: 'XX' })).status).toBe(403);
    }
  });

  it('explicit finance.read grant allows read but not write/approve', async () => {
    for (const url of READ_ENDPOINTS) expect((await reader.get(url)).status).toBe(200);
    expect((await reader.post('/finance/budgets', { name: 'x', fiscalYear: 2026, lines: [] })).status).toBe(403);
    expect((await reader.post('/finance/transactions', { txDate: '2026-01-01', type: 'EXPENSE', description: 'x', supplyAmount: '1' })).status).toBe(403);
  });

  it('business units CRUD with unique code', async () => {
    const list = await owner.get('/finance/business-units');
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(4); // 시드 사업 구분
    const res = await owner.post('/finance/business-units', { name: '신규 사업', code: 'NEWBIZ' });
    expect(res.status).toBe(201);
    unitId = res.body.id;
    expect((await owner.post('/finance/business-units', { name: '중복', code: 'NEWBIZ' })).status).toBe(409);
    expect((await owner.post('/finance/business-units', { name: 'bad', code: 'bad code' })).status).toBe(400);
    const tmp = await owner.post('/finance/business-units', { name: '임시', code: 'TMP' });
    expect((await owner.del(`/finance/business-units/${tmp.body.id}`)).body).toEqual({ ok: true, deactivated: false });
  });

  let budgetId: string;
  let lineA: string;
  let lineB: string;

  it('validates budgets (quarter, amount strings, whitelist)', async () => {
    expect((await owner.post('/finance/budgets', { name: 'q', fiscalYear: 2026, period: 'QUARTERLY', lines: [] })).status).toBe(400);
    expect((await owner.post('/finance/budgets', { name: 'n', fiscalYear: 2026, lines: [{ category: 'a', plannedAmount: 100.5 }] })).status).toBe(400);
    expect((await owner.post('/finance/budgets', { name: 'n', fiscalYear: 2026, lines: [{ category: 'a', plannedAmount: '1.234' }] })).status).toBe(400);
    expect((await owner.post('/finance/budgets', { name: 'n', fiscalYear: 2026, lines: [], plannedAmount: '999' })).status).toBe(400);
  });

  it('creates a budget; plannedAmount is computed server-side with exact decimals', async () => {
    const res = await owner.post('/finance/budgets', {
      name: '2026 테크 예산', fiscalYear: 2026, period: 'QUARTERLY', quarter: 1, businessUnitId: unitId, projectId,
      lines: [
        { category: '인건비', plannedAmount: '1000000.10' },
        { category: '장비', plannedAmount: '500000.20' },
        { category: '소액', plannedAmount: '0.1' },
        { category: '소액2', plannedAmount: '0.2' },
      ],
    });
    expect(res.status).toBe(201);
    budgetId = res.body.id;
    expect(res.body.plannedAmount).toBe('1500000.60');
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.approvedAmount).toBe('0.00');
    [lineA, lineB] = res.body.lines.map((l: { id: string }) => l.id);
    // 0.1 + 0.2 정확히 0.30
    const upd = await owner.patch(`/finance/budgets/${budgetId}`, { lines: [{ category: '인건비', plannedAmount: '1000000' }, { category: '장비', plannedAmount: '500000' }, { category: '소액', plannedAmount: '0.1' }, { category: '소액2', plannedAmount: '0.2' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.plannedAmount).toBe('1500000.30');
    [lineA, lineB] = upd.body.lines.map((l: { id: string }) => l.id);
  });

  it('cannot allocate to a non-approved budget', async () => {
    const res = await owner.post('/finance/transactions', {
      txDate: '2026-02-01', type: 'EXPENSE', description: 'x', supplyAmount: '1000', allocations: [{ budgetLineId: lineA, amount: '100' }],
    });
    expect(res.status).toBe(400);
  });

  it('budget approval requires finance.approve and records approved amounts separately', async () => {
    expect((await owner.post(`/finance/budgets/${budgetId}/submit`)).status).toBe(201);
    expect((await owner.patch(`/finance/budgets/${budgetId}`, { name: 'edit' })).status).toBe(409);
    expect((await reader.post(`/finance/budgets/${budgetId}/approve`, {})).status).toBe(403);
    const res = await exec.post(`/finance/budgets/${budgetId}/approve`, { lines: [{ lineId: lineA, approvedAmount: '800000' }] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.plannedAmount).toBe('1500000.30');
    expect(res.body.approvedAmount).toBe('1300000.30');
    expect(res.body.lines[0].approvedAmount).toBe('800000.00');
    expect(res.body.lines[1].approvedAmount).toBe('500000.00');
    expect(res.body.executedAmount).toBe('0.00');
    // 중복 승인은 409
    expect((await exec.post(`/finance/budgets/${budgetId}/approve`, {})).status).toBe(409);
  });

  let txId: string;

  it('creates transactions with auto VAT and server-computed totals', async () => {
    const auto = await owner.post('/finance/transactions', {
      txDate: '2026-03-15', type: 'EXPENSE', description: '노트북 구매', counterparty: '전자상사', supplyAmount: '1000000', autoVat: true,
      businessUnitId: unitId, projectId,
    });
    expect(auto.status).toBe(201);
    expect(auto.body.vatAmount).toBe('100000.00');
    expect(auto.body.totalAmount).toBe('1100000.00');
    txId = auto.body.id;
    // 원 단위 절사: 999 * 10% = 99.9 → 99
    const trunc = await owner.post('/finance/transactions', { txDate: '2026-03-16', type: 'EXPENSE', description: '절사', supplyAmount: '999', autoVat: true });
    expect(trunc.body.vatAmount).toBe('99.00');
    expect(trunc.body.totalAmount).toBe('1098.00');
    // 0.1 + 0.2 = 0.30 (부동소수점 오차 없음)
    const tiny = await owner.post('/finance/transactions', { txDate: '2026-03-17', type: 'EXPENSE', description: '소수', supplyAmount: '0.1', vatAmount: '0.2' });
    expect(tiny.body.totalAmount).toBe('0.30');
    // 숫자 타입/잘못된 형식 거절
    expect((await owner.post('/finance/transactions', { txDate: '2026-03-17', type: 'EXPENSE', description: 'n', supplyAmount: 0.1 })).status).toBe(400);
    expect((await owner.post('/finance/transactions', { txDate: '2026-03-17', type: 'EXPENSE', description: 'n', supplyAmount: '1e5' })).status).toBe(400);
    expect((await owner.post('/finance/transactions', { txDate: '2026-03-17', type: 'EXPENSE', description: 'n', supplyAmount: '1', totalAmount: '999' })).status).toBe(400);
  });

  it('rejects allocation overflow and accepts valid allocations', async () => {
    const over = await owner.put(`/finance/transactions/${txId}/allocations`, {
      allocations: [{ budgetLineId: lineA, amount: '1000000' }, { budgetLineId: lineB, amount: '100000.01' }],
    });
    expect(over.status).toBe(400);
    const dup = await owner.put(`/finance/transactions/${txId}/allocations`, { allocations: [{ budgetLineId: lineA, amount: '1' }, { budgetLineId: lineA, amount: '1' }] });
    expect(dup.status).toBe(400);
    const ok = await owner.put(`/finance/transactions/${txId}/allocations`, {
      allocations: [{ budgetLineId: lineA, amount: '1000000' }, { budgetLineId: lineB, amount: '100000' }],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.allocatedAmount).toBe('1100000.00');
    expect(ok.body.unallocatedAmount).toBe('0.00');
    // 거래 금액을 배분 합계 아래로 줄이면 거절
    expect((await owner.patch(`/finance/transactions/${txId}`, { supplyAmount: '500000', autoVat: true })).status).toBe(400);
    // 수입 거래에는 배분 불가
    const rev = await owner.post('/finance/transactions', { txDate: '2026-03-01', type: 'REVENUE', description: 'r', supplyAmount: '10', allocations: [{ budgetLineId: lineA, amount: '1' }] });
    expect(rev.status).toBe(400);
  });

  it('execution is counted only after approval; creator cannot approve own transaction', async () => {
    let b = await owner.get(`/finance/budgets/${budgetId}`);
    expect(b.body.executedAmount).toBe('0.00');
    expect((await owner.post(`/finance/transactions/${txId}/submit`)).status).toBe(201);
    expect((await owner.post(`/finance/transactions/${txId}/approve`)).status).toBe(403); // 직무 분리
    expect((await reader.post(`/finance/transactions/${txId}/approve`)).status).toBe(403); // 권한 없음
    const ok = await exec.post(`/finance/transactions/${txId}/approve`);
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('APPROVED');
    expect((await exec.post(`/finance/transactions/${txId}/approve`)).status).toBe(409);
    expect((await owner.put(`/finance/transactions/${txId}/allocations`, { allocations: [] })).status).toBe(409);

    b = await owner.get(`/finance/budgets/${budgetId}`);
    expect(b.body.approvedAmount).toBe('1300000.30');
    expect(b.body.executedAmount).toBe('1100000.00');
    expect(b.body.remainingAmount).toBe('200000.30');
    expect(b.body.executionRate).toBe(84.6);
    const la = b.body.lines.find((l: { id: string }) => l.id === lineA);
    expect(la.executedAmount).toBe('1000000.00');
    expect(la.remainingAmount).toBe('-200000.00');
    const lb = b.body.lines.find((l: { id: string }) => l.id === lineB);
    expect(lb.remainingAmount).toBe('400000.00');

    const audit = await prisma.auditLog.count({ where: { action: 'finance.transaction.approved', entityId: txId } });
    expect(audit).toBe(1);
  });

  it('reject requires a reason and is audit-logged', async () => {
    const t = await owner.post('/finance/transactions', { txDate: '2026-04-01', type: 'EXPENSE', description: '반려 대상', supplyAmount: '5000', submit: true });
    expect(t.body.status).toBe('PENDING');
    expect((await exec.post(`/finance/transactions/${t.body.id}/reject`, {})).status).toBe(400);
    const r = await exec.post(`/finance/transactions/${t.body.id}/reject`, { reason: '증빙 누락' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('REJECTED');
    expect(await prisma.auditLog.count({ where: { action: 'finance.transaction.rejected', entityId: t.body.id } })).toBe(1);
    // 반려 후 수정 → DRAFT
    const e = await owner.patch(`/finance/transactions/${t.body.id}`, { description: '보완' });
    expect(e.body.status).toBe('DRAFT');
    expect((await owner.del(`/finance/transactions/${t.body.id}`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'finance.transaction.deleted', entityId: t.body.id } })).toBe(1);
    expect((await owner.get(`/finance/transactions/${t.body.id}`)).status).toBe(404);
  });

  it('dashboard aggregates approved data by month, unit and project', async () => {
    // 수입 2건 승인 (다른 월)
    for (const [d, amt] of [['2026-01-10', '3000000'], ['2026-03-20', '2000000.50']] as const) {
      const r = await owner.post('/finance/transactions', { txDate: d, type: 'REVENUE', description: '매출', supplyAmount: amt, businessUnitId: unitId, submit: true });
      expect((await exec.post(`/finance/transactions/${r.body.id}/approve`)).status).toBe(201);
    }
    // 승인 대기 지출 1건
    await owner.post('/finance/transactions', { txDate: '2026-05-01', type: 'EXPENSE', description: '대기', supplyAmount: '7000', autoVat: true, submit: true });
    // 다른 연도 (집계 제외)
    const old = await owner.post('/finance/transactions', { txDate: '2025-12-31', type: 'REVENUE', description: '전년', supplyAmount: '1', submit: true });
    await exec.post(`/finance/transactions/${old.body.id}/approve`);

    const res = await reader.get('/finance/dashboard?year=2026');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.totals.revenue).toBe('5000000.50');
    expect(d.totals.expense).toBe('1100000.00');
    expect(d.totals.profit).toBe('3900000.50');
    expect(d.totals.pendingExpenseCount).toBe(1);
    expect(d.totals.pendingExpenseAmount).toBe('7700.00');
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly[0]).toEqual({ month: 1, revenue: '3000000.00', expense: '0.00' });
    expect(d.monthly[2]).toEqual({ month: 3, revenue: '2000000.50', expense: '1100000.00' });
    expect(d.budget.approved).toBe('1300000.30');
    expect(d.budget.executed).toBe('1100000.00');
    expect(d.budget.executionRate).toBe(84.6);
    const unit = d.byBusinessUnit.find((u: { id: string }) => u.id === unitId);
    expect(unit).toMatchObject({ revenue: '5000000.50', expense: '1100000.00', profit: '3900000.50' });
    expect(d.byProject[0]).toMatchObject({ id: projectId, cost: '1100000.00', budgetApproved: '1300000.30', budgetExecuted: '1100000.00' });
    expect(d.pendingExpenses).toHaveLength(1);
    expect(d.pendingExpenses[0].totalAmount).toBe('7700.00');
  });

  it('lists transactions with filters and exports CSV', async () => {
    const list = await reader.get('/finance/transactions?type=REVENUE&from=2026-01-01&to=2026-12-31&status=APPROVED');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.summary.revenue).toBe('5000000.50');
    const byUnit = await reader.get(`/finance/transactions?businessUnitId=${unitId}&pageSize=100`);
    expect(byUnit.body.items.every((t: { businessUnitId: string }) => t.businessUnitId === unitId)).toBe(true);
    const csv = await reader.get('/finance/transactions/export?type=REVENUE');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('거래일');
  });

  it('project detail hides budget for users without finance.read', async () => {
    await owner.patch(`/projects/${projectId}`, { budgetId });
    const asManager = await manager.get(`/projects/${projectId}`);
    expect(asManager.body.budget).toBeNull();
    expect(asManager.body.budgetId).toBeNull();
  });

  it('cannot delete a budget with execution; organization isolation on ids', async () => {
    expect((await owner.del(`/finance/budgets/${budgetId}`)).status).toBe(409);
    expect((await owner.get('/finance/budgets/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await exec.post(`/finance/budgets/${budgetId}/close`)).status).toBe(201);
  });
});
