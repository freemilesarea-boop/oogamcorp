import { INestApplication } from '@nestjs/common';
import { createApp, createUser, login, prisma, resetDatabase, type Client } from './helpers';

describe('Calendar & search', () => {
  let app: INestApplication;
  let orgId: string;
  let workspaceId: string;
  let alice: Client;
  let bob: Client;
  let carol: Client;
  let guest: Client;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    ({ organizationId: orgId, workspaceId } = await resetDatabase());
    app = await createApp();
    const a = await createUser(orgId, 'MANAGER', { departmentName: '테크', name: '앨리스' });
    const b = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크', name: '밥' });
    const c = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠', name: '캐럴' });
    const g = await createUser(orgId, 'GUEST');
    aliceId = a.id;
    bobId = b.id;
    alice = await login(app, a.email);
    bob = await login(app, b.email);
    carol = await login(app, c.email);
    guest = await login(app, g.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────── Calendar ─────────────
  let privateId: string;
  let publicId: string;

  it('creates events with attendees and notifies them', async () => {
    const res = await alice.post('/calendar/events', {
      title: '비공개 1:1 면담', startAt: '2026-11-10T01:00:00.000Z', endAt: '2026-11-10T02:00:00.000Z', isPrivate: true, attendeeIds: [bobId],
    });
    expect(res.status).toBe(201);
    privateId = res.body.id;
    expect(res.body.attendees).toHaveLength(1);
    const notes = await prisma.notification.findMany({ where: { userId: bobId, type: 'SYSTEM' } });
    expect(notes[0].link).toBe(`/admin/calendar?event=${privateId}`);

    const pub = await alice.post('/calendar/events', { title: '전사 타운홀', startAt: '2026-11-20', endAt: '2026-11-20', allDay: true, recurrence: 'FREQ=MONTHLY;BYMONTHDAY=20' });
    expect(pub.status).toBe(201);
    publicId = pub.body.id;
    expect(pub.body.startAt).toBe('2026-11-20T00:00:00.000Z');
    expect(pub.body.endAt).toBe('2026-11-20T23:59:59.999Z');
  });

  it('validates events', async () => {
    expect((await alice.post('/calendar/events', { title: 'x', startAt: '2026-11-10T05:00:00Z', endAt: '2026-11-10T04:00:00Z' })).status).toBe(400);
    expect((await alice.post('/calendar/events', { title: 'x', startAt: 'bad', endAt: '2026-11-10T04:00:00Z' })).status).toBe(400);
    expect((await alice.post('/calendar/events', { title: 'x', startAt: '2026-11-10T03:00:00Z', endAt: '2026-11-10T04:00:00Z', recurrence: 'every day' })).status).toBe(400);
    expect((await alice.post('/calendar/events', { title: 'x', startAt: '2026-11-10T03:00:00Z', endAt: '2026-11-10T04:00:00Z', attendeeIds: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
    expect((await guest.post('/calendar/events', { title: 'x', startAt: '2026-11-10T03:00:00Z', endAt: '2026-11-10T04:00:00Z' })).status).toBe(403);
  });

  it('private event hidden from non-attendee; range query', async () => {
    const range = '/calendar/events?from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z';
    const forBob = await bob.get(range);
    expect(forBob.status).toBe(200);
    expect(forBob.body.events.map((e: { id: string }) => e.id).sort()).toEqual([privateId, publicId].sort());
    const forCarol = await carol.get(range);
    expect(forCarol.body.events.map((e: { id: string }) => e.id)).toEqual([publicId]);
    expect((await carol.get(`/calendar/events/${privateId}`)).status).toBe(404);
    expect((await carol.post(`/calendar/events/${privateId}/respond`, { response: 'ACCEPTED' })).status).toBe(404);
    // 범위 밖
    const dec = await bob.get('/calendar/events?from=2026-12-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z');
    expect(dec.body.events).toHaveLength(0);
    expect((await bob.get('/calendar/events?from=2026-12-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z')).status).toBe(400);
  });

  it('attendee responds; only creator edits/deletes', async () => {
    const r = await bob.post(`/calendar/events/${privateId}/respond`, { response: 'ACCEPTED' });
    expect(r.status).toBe(201);
    expect(r.body.myResponse).toBe('ACCEPTED');
    expect((await bob.post(`/calendar/events/${privateId}/respond`, { response: 'PENDING' })).status).toBe(400);
    expect((await carol.post(`/calendar/events/${publicId}/respond`, { response: 'ACCEPTED' })).status).toBe(403);
    expect((await bob.patch(`/calendar/events/${privateId}`, { title: 'hack' })).status).toBe(403);
    const upd = await alice.patch(`/calendar/events/${privateId}`, { startAt: '2026-11-10T03:00:00.000Z', endAt: '2026-11-10T04:00:00.000Z' });
    expect(upd.status).toBe(200);
    expect((await alice.patch(`/calendar/events/${privateId}`, { endAt: '2026-11-09T00:00:00.000Z' })).status).toBe(400);
  });

  it('includes my task due dates when include=tasks', async () => {
    await prisma.task.create({ data: { organizationId: orgId, title: '보고서 마감', dueDate: new Date('2026-11-15'), createdById: bobId } });
    const res = await bob.get('/calendar/events?from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z&include=tasks');
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['보고서 마감']);
    const carolRes = await carol.get('/calendar/events?from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z&include=tasks');
    expect(carolRes.body.tasks).toHaveLength(0);
  });

  it('soft deletes events', async () => {
    expect((await alice.del(`/calendar/events/${publicId}`)).status).toBe(200);
    expect((await bob.get(`/calendar/events/${publicId}`)).status).toBe(404);
    expect(await prisma.calendarEvent.count({ where: { id: publicId } })).toBe(1);
  });

  // ───────────── Search ─────────────
  it('search does not leak private/restricted pages or invisible projects', async () => {
    const mkPage = (title: string, createdById: string, visibility: 'WORKSPACE' | 'PRIVATE' | 'RESTRICTED', parentId?: string) =>
      prisma.page.create({ data: { organizationId: orgId, workspaceId, title, contentText: `${title} 본문 기밀코드`, createdById, visibility, parentId } });
    const pub = await mkPage('공개 회의록', aliceId, 'WORKSPACE');
    const priv = await mkPage('앨리스 비공개 메모', aliceId, 'PRIVATE');
    const restricted = await mkPage('제한 문서', aliceId, 'RESTRICTED');
    const child = await mkPage('비공개 하위 문서', aliceId, 'WORKSPACE', priv.id);

    // 프로젝트: 테크 부서 → 캐럴(콘텐츠) 은 볼 수 없음
    const proj = await alice.post('/projects', { name: '기밀코드 프로젝트', key: 'SEC' });
    expect(proj.status).toBe(201);
    await alice.post('/tasks', { title: '기밀코드 업무', projectId: proj.body.id });

    const ids = (body: { groups: { type: string; items: { id: string }[] }[] }, type: string) =>
      body.groups.find((g) => g.type === type)?.items.map((i) => i.id) ?? [];

    const aRes = await alice.get('/search?q=기밀코드');
    expect(aRes.status).toBe(200);
    expect(ids(aRes.body, 'pages').sort()).toEqual([pub.id, priv.id, restricted.id, child.id].sort());
    expect(ids(aRes.body, 'projects')).toEqual([proj.body.id]);

    const cRes = await carol.get('/search?q=기밀코드');
    expect(ids(cRes.body, 'pages')).toEqual([pub.id]);
    expect(ids(cRes.body, 'projects')).toEqual([]);
    expect(ids(cRes.body, 'tasks')).toEqual([]);

    // 명시 부여 시 제한 문서 노출
    await prisma.resourceGrant.create({ data: { organizationId: orgId, resourceType: 'PAGE', resourceId: restricted.id, userId: (await prisma.user.findFirstOrThrow({ where: { name: '캐럴' } })).id, access: 'VIEW' } });
    const cRes2 = await carol.get('/search?q=기밀코드&types=pages');
    expect(ids(cRes2.body, 'pages').sort()).toEqual([pub.id, restricted.id].sort());
    expect(cRes2.body.groups.every((g: { type: string }) => g.type === 'pages')).toBe(true);
  });

  it('searches database rows, employees and announcements with permission checks', async () => {
    const db = await alice.post('/databases', { name: '거래처 목록' });
    const titleId = (await alice.get(`/databases/${db.body.id}`)).body.properties[0].id;
    await alice.post(`/databases/${db.body.id}/rows`, { cells: { [titleId]: '오감상사 50%_할인' } });
    const r = await bob.get(`/search?q=${encodeURIComponent('50%_')}&types=rows,databases`);
    expect(r.body.groups.find((g: { type: string }) => g.type === 'rows').items[0]).toMatchObject({ title: '오감상사 50%_할인', href: expect.stringContaining(`/admin/databases/${db.body.id}?row=`) });
    expect((await bob.get('/search?q=거래처&types=databases')).body.total).toBe(1);

    const emp = await bob.get('/search?q=캐럴&types=employees');
    const hit = emp.body.groups[0].items[0];
    expect(hit.title).toBe('캐럴');
    expect(Object.keys(hit).sort()).toEqual(['href', 'id', 'meta', 'snippet', 'title', 'type']);

    const bobUser = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
    const contentDept = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '콘텐츠' } });
    await prisma.announcement.create({ data: { organizationId: orgId, title: '전사 공지 보안점검', body: '본문', authorId: aliceId } });
    await prisma.announcement.create({ data: { organizationId: orgId, scope: 'DEPARTMENT', departmentId: contentDept.id, title: '콘텐츠팀 보안점검', body: '본문', authorId: aliceId } });
    const ann = await bob.get('/search?q=보안점검&types=announcements');
    expect(ann.body.groups[0].items.map((i: { title: string }) => i.title)).toEqual(['전사 공지 보안점검']);
    expect(bobUser).toBeTruthy();

    // GUEST: 데이터베이스/직원 권한 없음 → 결과 없음
    const g = await guest.get('/search?q=거래처');
    expect(g.status).toBe(200);
    expect(g.body.groups.find((x: { type: string }) => x.type === 'databases' || x.type === 'rows')).toBeUndefined();
  });

  it('requires a query of at least 2 characters and valid types', async () => {
    expect((await bob.get('/search?q=a')).status).toBe(400);
    expect((await bob.get('/search?q=ab&types=secrets')).status).toBe(400);
  });
});
