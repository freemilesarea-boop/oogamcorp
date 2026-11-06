import { INestApplication } from '@nestjs/common';
import { createApp, createUser, login, prisma, resetDatabase, type Client } from './helpers';

describe('Custom databases', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let employee: Client;
  let guest: Client;
  let employeeId: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const e = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const g = await createUser(orgId, 'GUEST');
    employeeId = e.id;
    employee = await login(app, e.email);
    guest = await login(app, g.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let dbId: string;
  let titleId: string;
  const p: Record<string, string> = {};
  let otherDbId: string;
  let otherRowId: string;

  it('creates a database with TITLE property and default TABLE view', async () => {
    const res = await employee.post('/databases', { name: '콘텐츠 캘린더', icon: '📅' });
    expect(res.status).toBe(201);
    dbId = res.body.id;
    const detail = await employee.get(`/databases/${dbId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.properties).toHaveLength(1);
    expect(detail.body.properties[0]).toMatchObject({ name: '이름', type: 'TITLE' });
    titleId = detail.body.properties[0].id;
    expect(detail.body.views).toHaveLength(1);
    expect(detail.body.views[0].type).toBe('TABLE');
    expect(detail.body.access.canEdit).toBe(true);
    const list = await employee.get('/databases');
    expect(list.body.items.map((d: { id: string }) => d.id)).toContain(dbId);
  });

  it('rejects unknown fields, second TITLE, FORMULA/ROLLUP (후속)', async () => {
    expect((await employee.post('/databases', { name: 'x', hacker: 1 })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/properties`, { name: '제목2', type: 'TITLE' })).status).toBe(400);
    const f = await employee.post(`/databases/${dbId}/properties`, { name: '수식', type: 'FORMULA' });
    expect(f.status).toBe(400);
    expect(f.body.message).toContain('후속 구현');
    expect((await employee.post(`/databases/${dbId}/properties`, { name: '롤업', type: 'ROLLUP' })).status).toBe(400);
  });

  it('creates properties of every type with validated config', async () => {
    const other = await employee.post('/databases', { name: '작가' });
    otherDbId = other.body.id;
    const r = await employee.post(`/databases/${otherDbId}/rows`, { cells: { [(await employee.get(`/databases/${otherDbId}`)).body.properties[0].id]: '김작가' } });
    expect(r.status).toBe(201);
    otherRowId = r.body.id;

    const defs: [string, string, object?][] = [
      ['설명', 'TEXT'],
      ['조회수', 'NUMBER', { format: 'integer' }],
      ['상태', 'SELECT', { options: [{ id: 'todo', name: '예정', color: 'gray' }, { id: 'done', name: '완료', color: 'green' }] }],
      ['태그', 'MULTI_SELECT', { options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }],
      ['게시일', 'DATE'],
      ['검수', 'CHECKBOX'],
      ['담당자', 'PERSON'],
      ['링크', 'URL'],
      ['첨부', 'FILE'],
      ['작가', 'RELATION', { targetDatabaseId: otherDbId }],
    ];
    for (const [name, type, config] of defs) {
      const res = await employee.post(`/databases/${dbId}/properties`, { name, type, ...(config ? { config } : {}) });
      expect(res.status).toBe(201);
      p[type] = res.body.id;
    }
    // 잘못된 설정
    expect((await employee.post(`/databases/${dbId}/properties`, { name: 'n2', type: 'NUMBER', config: { format: 'roman' } })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/properties`, { name: 's2', type: 'SELECT', config: { options: [{ name: '' }] } })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/properties`, { name: 'r2', type: 'RELATION', config: {} })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/properties`, { name: '설명', type: 'TEXT' })).status).toBe(400);
  });

  it('relation target must be in the same organization', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: '타사', slug: `other-${Date.now()}` } });
    const ws = await prisma.workspace.create({ data: { organizationId: otherOrg.id, name: 'W', slug: 'w' } });
    const foreign = await prisma.database.create({ data: { organizationId: otherOrg.id, workspaceId: ws.id, name: '외부', createdById: employeeId } });
    const res = await employee.post(`/databases/${dbId}/properties`, { name: '외부관계', type: 'RELATION', config: { targetDatabaseId: foreign.id } });
    expect(res.status).toBe(400);
    expect(await employee.get(`/databases/${foreign.id}`).then((r) => r.status)).toBe(404);
  });

  let rowId: string;
  it('creates rows with valid cells of every type', async () => {
    const res = await employee.post(`/databases/${dbId}/rows`, {
      cells: {
        [titleId]: '첫 번째 글',
        [p.TEXT]: '본문',
        [p.NUMBER]: 120,
        [p.SELECT]: 'todo',
        [p.MULTI_SELECT]: ['a', 'b'],
        [p.DATE]: { start: '2026-11-10', end: '2026-11-12' },
        [p.CHECKBOX]: true,
        [p.PERSON]: [employeeId],
        [p.URL]: 'https://oogam.example/post',
        [p.RELATION]: [otherRowId],
      },
    });
    expect(res.status).toBe(201);
    rowId = res.body.id;
    expect(res.body.cells[p.NUMBER]).toBe(120);
    expect(res.body.cells[p.DATE]).toEqual({ start: '2026-11-10', end: '2026-11-12' });
    const activity = await prisma.activityLog.findMany({ where: { entityType: 'DATABASE_ROW', entityId: rowId } });
    expect(activity.map((a) => a.action)).toContain('row.created');
  });

  it('rejects invalid cell values for each type with a field message', async () => {
    const randomUuid = '00000000-0000-4000-8000-000000000000';
    const bad: [string, unknown][] = [
      [titleId, 123],
      [p.TEXT, 'x'.repeat(10_001)],
      [p.NUMBER, 'abc'],
      [p.NUMBER, 1.5], // integer format
      [p.SELECT, 'nope'],
      [p.MULTI_SELECT, ['a', 'zzz']],
      [p.MULTI_SELECT, 'a'],
      [p.DATE, '2026-11-10'],
      [p.DATE, { start: 'yesterday' }],
      [p.DATE, { start: '2026-11-10', end: '2026-11-01' }],
      [p.CHECKBOX, 'yes'],
      [p.PERSON, [randomUuid]],
      [p.PERSON, ['not-a-uuid']],
      [p.URL, 'javascript:alert(1)'],
      [p.URL, 'not a url'],
      [p.FILE, [randomUuid]],
      [p.RELATION, [rowId]], // 대상 DB 가 아닌 같은 DB 의 행
      [randomUuid, 'x'], // 존재하지 않는 속성
    ];
    for (const [pid, value] of bad) {
      const res = await employee.patch(`/databases/${dbId}/rows/${rowId}`, { cells: { [pid]: value } });
      if (res.status !== 400) throw new Error(`expected 400 for ${pid}=${JSON.stringify(value).slice(0, 40)} got ${res.status}`);
      expect(typeof res.body.message).toBe('string');
      expect(res.body.field).toBeTruthy();
    }
  });

  it('null clears a cell, update records activity', async () => {
    const res = await employee.patch(`/databases/${dbId}/rows/${rowId}`, { cells: { [p.TEXT]: null, [p.NUMBER]: 300 } });
    expect(res.status).toBe(200);
    expect(res.body.cells[p.TEXT]).toBeUndefined();
    expect(res.body.cells[p.NUMBER]).toBe(300);
    const logs = await employee.get(`/databases/${dbId}/rows/${rowId}/activity`);
    expect(logs.body[0].action).toBe('row.updated');
  });

  it('filters, sorts, paginates and groups rows server-side', async () => {
    const mk = (title: string, n: number, status: string | null, checked: boolean, date: string) =>
      employee.post(`/databases/${dbId}/rows`, { cells: { [titleId]: title, [p.NUMBER]: n, [p.SELECT]: status, [p.CHECKBOX]: checked, [p.DATE]: { start: date } } });
    await mk('두 번째', 50, 'done', false, '2026-10-01');
    await mk('세 번째 글', 500, 'todo', true, '2026-12-01');
    await mk('네 번째', 10, null, false, '2026-11-20');

    const f = (filters: object[], extra = '') => employee.get(`/databases/${dbId}/rows?filters=${encodeURIComponent(JSON.stringify(filters))}${extra}`);
    expect((await f([{ propertyId: p.NUMBER, operator: 'gt', value: 100 }])).body.total).toBe(2);
    expect((await f([{ propertyId: titleId, operator: 'contains', value: '글' }])).body.total).toBe(2);
    expect((await f([{ propertyId: p.SELECT, operator: 'equals', value: 'done' }])).body.total).toBe(1);
    expect((await f([{ propertyId: p.SELECT, operator: 'is_empty' }])).body.total).toBe(1);
    expect((await f([{ propertyId: p.CHECKBOX, operator: 'is_checked' }])).body.total).toBe(2);
    expect((await f([{ propertyId: p.DATE, operator: 'before', value: '2026-11-01' }])).body.total).toBe(1);
    expect((await f([{ propertyId: p.DATE, operator: 'after', value: '2026-11-15' }])).body.total).toBe(2);
    expect((await f([{ propertyId: p.PERSON, operator: 'contains', value: 'me' }])).body.total).toBe(1);
    // 타입에 맞지 않는 연산자
    expect((await f([{ propertyId: p.CHECKBOX, operator: 'gt', value: 1 }])).status).toBe(400);
    expect((await employee.get(`/databases/${dbId}/rows?filters=notjson`)).status).toBe(400);

    const sorted = await employee.get(`/databases/${dbId}/rows?sorts=${encodeURIComponent(JSON.stringify([{ propertyId: p.NUMBER, direction: 'desc' }]))}`);
    expect(sorted.body.items.map((r: { cells: Record<string, number> }) => r.cells[p.NUMBER])).toEqual([500, 300, 50, 10]);
    const paged = await employee.get(`/databases/${dbId}/rows?pageSize=3&page=2`);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.totalPages).toBe(2);

    const grouped = await employee.get(`/databases/${dbId}/rows?groupBy=${p.SELECT}`);
    expect(grouped.body.groups).toEqual([{ key: 'todo', count: 2 }, { key: 'done', count: 1 }, { key: null, count: 1 }]);
    expect((await employee.get(`/databases/${dbId}/rows?groupBy=${p.TEXT}`)).status).toBe(400);
  });

  it('bulk reorders rows', async () => {
    const all = await employee.get(`/databases/${dbId}/rows`);
    const ids = all.body.items.map((r: { id: string }) => r.id).reverse();
    expect((await employee.post(`/databases/${dbId}/rows/reorder`, { orderedIds: ids })).status).toBe(201);
    const after = await employee.get(`/databases/${dbId}/rows`);
    expect(after.body.items.map((r: { id: string }) => r.id)).toEqual(ids);
    expect((await employee.post(`/databases/${dbId}/rows/reorder`, { orderedIds: [otherRowId] })).status).toBe(400);
  });

  it('changing property type converts or clears cells in a transaction', async () => {
    // NUMBER → TEXT: 값 변환
    const res = await employee.patch(`/databases/${dbId}/properties/${p.NUMBER}`, { type: 'TEXT' });
    expect(res.status).toBe(200);
    expect(res.body.converted).toBe(4);
    const row = await employee.get(`/databases/${dbId}/rows/${rowId}`);
    expect(row.body.cells[p.NUMBER]).toBe('300');
    // TEXT → SELECT: 옵션 자동 생성
    const sel = await employee.patch(`/databases/${dbId}/properties/${p.NUMBER}`, { type: 'SELECT' });
    expect(sel.body.config.options.map((o: { name: string }) => o.name).sort()).toEqual(['10', '300', '50', '500']);
    // PERSON → TEXT: 참조형은 지움
    const person = await employee.patch(`/databases/${dbId}/properties/${p.PERSON}`, { type: 'TEXT' });
    expect(person.body.cleared).toBe(1);
    // SELECT 옵션 삭제 시 해당 셀 정리
    const opt = await employee.patch(`/databases/${dbId}/properties/${p.SELECT}`, { config: { options: [{ id: 'todo', name: '예정' }] } });
    expect(opt.body.cleared).toBe(1);
    // TITLE 은 변경/삭제 불가
    expect((await employee.patch(`/databases/${dbId}/properties/${titleId}`, { type: 'TEXT' })).status).toBe(400);
    expect((await employee.del(`/databases/${dbId}/properties/${titleId}`)).status).toBe(400);
  });

  let viewId: string;
  it('manages shared/personal views and per-user preferences', async () => {
    const shared = await employee.post(`/databases/${dbId}/views`, { name: '보드', type: 'BOARD', config: { groupBy: p.SELECT } });
    expect(shared.status).toBe(201);
    viewId = shared.body.id;
    expect((await employee.post(`/databases/${dbId}/views`, { name: '잘못', type: 'BOARD', config: { groupBy: p.TEXT } })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/views`, { name: '잘못', type: 'TABLE', config: { unknown: 1 } })).status).toBe(400);
    expect((await employee.post(`/databases/${dbId}/views`, { name: '잘못', type: 'CALENDAR', config: { datePropertyId: p.TEXT } })).status).toBe(400);

    const personal = await employee.post(`/databases/${dbId}/views`, { name: '내 뷰', type: 'TABLE', personal: true, config: { filters: [{ propertyId: p.CHECKBOX, operator: 'is_checked' }] } });
    expect(personal.status).toBe(201);
    // 다른 사용자에게 개인 뷰는 보이지 않음
    const ownerViews = await owner.get(`/databases/${dbId}/views`);
    expect(ownerViews.body.map((v: { id: string }) => v.id)).not.toContain(personal.body.id);
    expect(ownerViews.body.map((v: { id: string }) => v.id)).toContain(viewId);
    expect((await owner.patch(`/databases/${dbId}/views/${personal.body.id}`, { name: 'x' })).status).toBe(404);
    // 개인 뷰 필터가 행 조회에 적용됨
    expect((await employee.get(`/databases/${dbId}/rows?viewId=${personal.body.id}`)).body.total).toBe(2);

    // 개인 설정(preference) upsert — 공유 뷰 위에 덮어씀
    const pref = await owner.put(`/databases/${dbId}/views/${viewId}/preference`, { config: { sorts: [{ propertyId: 'createdAt', direction: 'desc' }], filters: [{ propertyId: p.CHECKBOX, operator: 'is_not_checked' }] } });
    expect(pref.status).toBe(200);
    expect((await owner.put(`/databases/${dbId}/views/${viewId}/preference`, { config: { sorts: [{ propertyId: 'nope', direction: 'asc' }] } })).status).toBe(400);
    expect((await owner.get(`/databases/${dbId}/rows?viewId=${viewId}`)).body.total).toBe(2);
    expect((await employee.get(`/databases/${dbId}/rows?viewId=${viewId}`)).body.total).toBe(4);
    const ov = await owner.get(`/databases/${dbId}/views`);
    expect(ov.body.find((v: { id: string }) => v.id === viewId).preference.filters).toHaveLength(1);
  });

  it('exports CSV with escaping and formula-injection protection', async () => {
    await employee.post(`/databases/${dbId}/rows`, { cells: { [titleId]: '=HYPERLINK("http://evil")', [p.TEXT]: 'a,b "q"\nline2' } });
    await employee.post(`/databases/${dbId}/rows`, { cells: { [titleId]: '@SUM(A1)', [p.TEXT]: '+1' } });
    const res = await employee.get(`/databases/${dbId}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text: string = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain(`"a,b ""q""\nline2"`);
    expect(text).toContain(`'@SUM(A1)`);
    expect(text).toContain(`'+1`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('imports CSV, reporting per-cell errors', async () => {
    const csv = [
      '이름,조회수,게시일,검수,링크,새열',
      '가져온 글,10,2026-11-01,true,https://a.example,메모1',
      '잘못된 날짜,20,어제,false,https://b.example,메모2',
      '잘못된 체크,30,2026-11-02,아마도,ftp://x,메모3',
      `"쉼표, 포함",40,2026-11-03 ~ 2026-11-04,예,,메모4`,
    ].join('\n');
    const res = await employee.post(`/databases/${dbId}/import`, { csv, createMissing: true });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.failedRows).toBe(2);
    expect(res.body.createdProperties).toEqual(['새열']);
    const cols = res.body.errors.map((e: { row: number; column: string }) => `${e.row}:${e.column}`);
    expect(cols).toEqual(expect.arrayContaining(['3:게시일', '4:검수', '4:링크']));

    // 없는 열은 옵션 없이 무시 + 오류 보고
    const r2 = await employee.post(`/databases/${dbId}/import`, { csv: '이름,없는열\n행,x' });
    expect(r2.body.imported).toBe(1);
    expect(r2.body.errors[0]).toMatchObject({ row: 1, column: '없는열' });

    // multipart 업로드
    const r3 = await employee.agent
      .post(`/api/v1/databases/${dbId}/import`)
      .set('X-CSRF-Token', employee.csrf)
      .attach('file', Buffer.from('﻿이름\n멀티파트 행\n'), 'rows.csv');
    expect(r3.status).toBe(201);
    expect(r3.body.imported).toBe(1);
  });

  it('denies writes to GUEST and hides from users without access', async () => {
    expect((await guest.get('/databases')).status).toBe(403);
    expect((await guest.post('/databases', { name: 'x' })).status).toBe(403);
    expect((await guest.post(`/databases/${dbId}/rows`, { cells: {} })).status).toBe(403);
    expect((await guest.patch(`/databases/${dbId}/rows/${rowId}`, { cells: {} })).status).toBe(403);
    expect((await guest.del(`/databases/${dbId}`)).status).toBe(403);
  });

  it('soft deletes rows and databases', async () => {
    expect((await employee.del(`/databases/${dbId}/rows/${rowId}`)).status).toBe(200);
    expect((await employee.get(`/databases/${dbId}/rows/${rowId}`)).status).toBe(404);
    expect(await prisma.databaseRow.count({ where: { id: rowId } })).toBe(1);
    expect((await employee.del(`/databases/${otherDbId}`)).status).toBe(200);
    expect((await employee.get(`/databases/${otherDbId}`)).status).toBe(404);
  });
});
