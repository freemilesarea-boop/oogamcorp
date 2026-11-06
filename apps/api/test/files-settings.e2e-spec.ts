import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { kstToday } from '../src/modules/dashboard/dashboard.service';
import { runDueReminders } from '../src/worker/jobs';
import { createApp, createUser, grantModule, login, prisma, resetDatabase, type Client } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

describe('Files, settings, audit logs, notifications, announcements, dashboard', () => {
  let app: INestApplication;
  let orgId: string;
  let workspaceId: string;
  let roles: Record<string, string>;
  let owner: Client;
  let exec: Client;
  let execId: string;
  let manager: Client;
  let managerId: string;
  let alice: Client; // 테크
  let aliceId: string;
  let bob: Client; // 콘텐츠
  let bobId: string;

  const upload = (c: Client, buf: Buffer, name: string, contentType: string, fields: Record<string, string> = {}) => {
    let req = c.agent.post('/api/v1/files').set('X-CSRF-Token', c.csrf);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', buf, { filename: name, contentType });
  };

  beforeAll(async () => {
    ({ organizationId: orgId, workspaceId, roles } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const x = await createUser(orgId, 'EXECUTIVE');
    const m = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    const a = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const b = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    execId = x.id;
    managerId = m.id;
    aliceId = a.id;
    bobId = b.id;
    exec = await login(app, x.email);
    manager = await login(app, m.email);
    alice = await login(app, a.email);
    bob = await login(app, b.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('files', () => {
    let plainId: string;

    it('uploads a file and only the uploader can download an unattached file', async () => {
      const res = await upload(alice, Buffer.from('hello world'), 'memo.txt', 'text/plain');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ originalName: 'memo.txt', mimeType: 'text/plain', size: 11 });
      expect(res.body.url).toBe(`/api/v1/files/${res.body.id}/download`);
      plainId = res.body.id;
      const row = await prisma.file.findUniqueOrThrow({ where: { id: plainId } });
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);

      const dl = await alice.get(`/files/${plainId}/download`);
      expect(dl.status).toBe(200);
      expect(dl.text).toBe('hello world');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect((await bob.get(`/files/${plainId}/download`)).status).toBe(404);
      expect((await bob.get(`/files/${plainId}`)).status).toBe(404);

      const mine = await alice.get('/files');
      expect(mine.body.items.map((f: { id: string }) => f.id)).toContain(plainId);
      expect((await bob.get('/files')).body.items).toHaveLength(0);
    });

    it('denies another user for a file attached to a PRIVATE page', async () => {
      const page = await prisma.page.create({ data: { organizationId: orgId, workspaceId, title: '비공개 메모', visibility: 'PRIVATE', createdById: aliceId } });
      const res = await upload(alice, PDF, '계약서 초안.pdf', 'application/pdf', { targetType: 'PAGE', targetId: page.id });
      expect(res.status).toBe(201);
      expect(res.body.targetType).toBe('PAGE');
      expect((await bob.get(`/files/${res.body.id}/download`)).status).toBe(404);
      expect((await bob.get(`/files?targetType=PAGE&targetId=${page.id}`)).status).toBe(404);
      // 다른 사용자는 비공개 문서에 첨부 업로드도 불가
      expect((await upload(bob, Buffer.from('x'), 'x.txt', 'text/plain', { targetType: 'PAGE', targetId: page.id })).status).toBe(403);
      // 열람 가능 사용자(작성자) 목록 + inline PDF + RFC 5987 파일명
      const list = await alice.get(`/files?targetType=PAGE&targetId=${page.id}`);
      expect(list.body.items).toHaveLength(1);
      const dl = await alice.get(`/files/${res.body.id}/download`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-disposition']).toMatch(/^inline;/);
      expect(dl.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('계약서 초안.pdf')}`);
    });

    it('denies a user who cannot see the project the file is attached to', async () => {
      const tech = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '테크' } });
      const project = await prisma.project.create({
        data: { organizationId: orgId, key: 'FIL', name: '파일 프로젝트', createdById: managerId, managerId, departmentId: tech.id, members: { create: [{ userId: managerId, role: 'MANAGER' }] } },
      });
      const res = await upload(manager, PNG, 'shot.png', 'image/png', { targetType: 'PROJECT', targetId: project.id });
      expect(res.status).toBe(201);
      expect((await alice.get(`/files/${res.body.id}/download`)).status).toBe(200); // 같은 부서 → 열람 가능
      expect((await bob.get(`/files/${res.body.id}/download`)).status).toBe(404);
      expect((await upload(bob, PNG, 'a.png', 'image/png', { targetType: 'PROJECT', targetId: project.id })).status).toBe(403);
      // 대상 일부만 지정하면 검증 오류
      expect((await upload(manager, PNG, 'a.png', 'image/png', { targetType: 'PROJECT' })).status).toBe(400);
    });

    it('rejects disallowed mimetypes, extension mismatch and spoofed content', async () => {
      expect((await upload(alice, Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html')).status).toBe(415);
      expect((await upload(alice, Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml')).status).toBe(415);
      expect((await upload(alice, Buffer.from('MZ'), 'run.exe', 'application/octet-stream')).status).toBe(415);
      expect((await upload(alice, Buffer.from('hello'), 'note.exe', 'text/plain')).status).toBe(415);
      expect((await upload(alice, Buffer.from('not a png'), 'fake.png', 'image/png')).status).toBe(400); // 내용-형식 불일치
      const none = await alice.agent.post('/api/v1/files').set('X-CSRF-Token', alice.csrf).field('x', 'y');
      expect(none.status).toBe(400);
    });

    it('neutralizes path traversal in file names', async () => {
      const res = await upload(alice, Buffer.from('root'), '../../../etc/passwd.txt', 'text/plain');
      expect(res.status).toBe(201);
      expect(res.body.originalName).toBe('passwd.txt');
      const row = await prisma.file.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.storageKey).toMatch(new RegExp(`^${orgId}/\\d{4}/\\d{2}/[0-9a-f-]{36}$`));
      const storageDir = resolve(process.env.STORAGE_LOCAL_DIR!);
      expect(existsSync(resolve(storageDir, row.storageKey))).toBe(true);
    });

    it('deletes: only uploader (or target editor); download is gone afterwards and audited', async () => {
      expect((await bob.del(`/files/${plainId}`)).status).toBe(404);
      const row = await prisma.file.findUniqueOrThrow({ where: { id: plainId } });
      expect((await alice.del(`/files/${plainId}`)).status).toBe(200);
      expect((await alice.get(`/files/${plainId}/download`)).status).toBe(404);
      expect(existsSync(resolve(process.env.STORAGE_LOCAL_DIR!, row.storageKey))).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'file.deleted', entityId: plainId } })).toBe(1);
    });

    it('requires files.read / files.write', async () => {
      const guest = await login(app, (await createUser(orgId, 'GUEST')).email);
      expect((await upload(guest, Buffer.from('x'), 'x.txt', 'text/plain')).status).toBe(403);
    });
  });

  describe('permission matrix & grants', () => {
    it('lists roles and the permission catalog with sensitive flags (permissions.manage only)', async () => {
      const cat = await owner.get('/settings/permissions');
      expect(cat.status).toBe(200);
      expect(cat.body.find((p: { key: string }) => p.key === 'hr.sensitive.read')).toMatchObject({ sensitive: true });
      const r = await owner.get('/settings/roles');
      expect(r.body.find((x: { key: string }) => x.key === 'OWNER').permissions.length).toBe(cat.body.length);
      expect((await exec.get('/settings/roles')).status).toBe(403);
      expect((await alice.get('/settings/permissions')).status).toBe(403);
    });

    it('OWNER permission matrix change takes effect immediately', async () => {
      expect((await alice.get('/employees/invitations')).status).toBe(403);
      const before = (await owner.get('/settings/roles')).body.find((x: { key: string }) => x.key === 'EMPLOYEE');
      const res = await owner.put(`/settings/roles/${roles.EMPLOYEE}/permissions`, { permissions: [...before.permissions, 'employees.manage'] });
      expect(res.status).toBe(200);
      expect(res.body.permissions).toContain('employees.manage');
      expect((await alice.get('/employees/invitations')).status).toBe(200);
      expect((await owner.put(`/settings/roles/${roles.EMPLOYEE}/permissions`, { permissions: before.permissions })).status).toBe(200);
      expect((await alice.get('/employees/invitations')).status).toBe(403);
      const audit = await prisma.auditLog.findMany({ where: { action: 'permissions.role.updated', entityId: roles.EMPLOYEE } });
      expect(audit).toHaveLength(2);
      expect(audit.map((a) => a.metadata)).toEqual(expect.arrayContaining([expect.objectContaining({ added: ['employees.manage'] })]));
    });

    it('rejects unknown keys and reducing OWNER permissions', async () => {
      expect((await owner.put(`/settings/roles/${roles.EMPLOYEE}/permissions`, { permissions: ['root.everything'] })).status).toBe(400);
      expect((await owner.put(`/settings/roles/${roles.OWNER}/permissions`, { permissions: ['workspace.access'] })).status).toBe(400);
    });

    it('EXECUTIVE cannot change permissions, even with permissions.manage granted cannot touch sensitive/own-rank roles', async () => {
      expect((await exec.put(`/settings/roles/${roles.EMPLOYEE}/permissions`, { permissions: [] })).status).toBe(403);
      await grantModule(orgId, execId, 'permissions.manage');
      expect((await exec.put(`/settings/roles/${roles.EXECUTIVE}/permissions`, { permissions: ['workspace.access'] })).status).toBe(403);
      expect((await exec.put(`/settings/roles/${roles.OWNER}/permissions`, { permissions: [] })).status).toBe(403);
      const mgr = (await exec.get('/settings/roles')).body.find((x: { key: string }) => x.key === 'MANAGER');
      expect((await exec.put(`/settings/roles/${roles.MANAGER}/permissions`, { permissions: [...mgr.permissions, 'finance.read'] })).status).toBe(403);
      expect((await exec.post('/settings/grants', { permission: 'hr.sensitive.read', userId: execId })).status).toBe(403);
      // 비민감 권한은 하위 역할에 부여 가능
      expect((await exec.put(`/settings/roles/${roles.MANAGER}/permissions`, { permissions: [...mgr.permissions, 'cms.publish'] })).status).toBe(200);
      await prisma.resourceGrant.deleteMany({ where: { userId: execId, resourceId: 'permissions.manage' } });
    });

    it('custom roles: rank below own, cannot delete system roles or roles in use', async () => {
      expect((await owner.post('/settings/roles', { key: 'INTERN', name: '인턴', rank: 100 })).status).toBe(400); // OWNER 서열 이상 불가
      const res = await owner.post('/settings/roles', { key: 'INTERN', name: '인턴', rank: 30, permissions: ['workspace.access', 'docs.read'] });
      expect(res.status).toBe(201);
      expect(res.body.permissions).toEqual(['docs.read', 'workspace.access']);
      expect((await owner.post('/settings/roles', { key: 'INTERN', name: 'dup', rank: 30 })).status).toBe(409);
      expect((await owner.del(`/settings/roles/${roles.GUEST}`)).status).toBe(400);
      const u = await createUser(orgId, 'EMPLOYEE');
      await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: u.id } }, data: { roleId: res.body.id } });
      expect((await owner.del(`/settings/roles/${res.body.id}`)).status).toBe(409);
      await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: u.id } }, data: { roleId: roles.EMPLOYEE } });
      expect((await owner.del(`/settings/roles/${res.body.id}`)).status).toBe(200);
    });

    it('module grants with expiry', async () => {
      const g = await owner.post('/settings/grants', { permission: 'audit.read', userId: aliceId, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      expect(g.status).toBe(201);
      expect((await alice.get('/audit-logs')).status).toBe(200);
      await prisma.resourceGrant.update({ where: { id: g.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await alice.get('/audit-logs')).status).toBe(403);
      expect((await owner.post('/settings/grants', { permission: 'audit.read', userId: aliceId, departmentId: roles.EMPLOYEE })).status).toBe(400);
      expect((await owner.post('/settings/grants', { permission: 'audit.read', expiresAt: '2000-01-01' })).status).toBe(400);
      const list = await owner.get(`/settings/grants?userId=${aliceId}`);
      expect(list.body[0]).toMatchObject({ permission: 'audit.read', expired: true, sensitive: true });
    });

    it('system settings allowlist (settings.manage)', async () => {
      expect((await owner.put('/settings/system/company.info', { value: { name: 'OOGAM', ceo: '홍길동' } })).status).toBe(200);
      expect((await owner.get('/settings/system/company.info')).body.value).toEqual({ name: 'OOGAM', ceo: '홍길동' });
      expect((await owner.put('/settings/system/company.info', { value: { hacked: true } })).status).toBe(400);
      expect((await owner.put('/settings/system/evil.key', { value: {} })).status).toBe(404);
      expect((await owner.put('/settings/system/notifications.email', { value: { enabled: 'yes' } })).status).toBe(400);
      expect((await exec.get('/settings/system/company.info')).status).toBe(403);
    });
  });

  describe('audit logs', () => {
    it('lists filtered logs with actor names (audit.read)', async () => {
      const res = await owner.get('/audit-logs?action=permissions.&pageSize=50');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((l: { action: string }) => l.action.startsWith('permissions.'))).toBe(true);
      expect(res.body.items[0].actor).toMatchObject({ name: expect.any(String) });
      const byExec = await exec.get(`/audit-logs?actorId=${execId}&from=2020-01-01&to=2099-12-31`);
      expect(byExec.status).toBe(200);
      expect(byExec.body.items.every((l: { actorId: string }) => l.actorId === execId)).toBe(true);
      expect((await alice.get('/audit-logs')).status).toBe(403);
      expect((await owner.get('/audit-logs?action=bad action!')).status).toBe(400);
    });
  });

  describe('notifications', () => {
    it('are strictly own-only', async () => {
      const mk = (userId: string, title: string) => prisma.notification.create({ data: { organizationId: orgId, userId, type: 'SYSTEM', title } });
      const a1 = await mk(aliceId, 'A1');
      await mk(aliceId, 'A2');
      const b1 = await mk(bobId, 'B1');
      const list = await alice.get('/notifications?pageSize=50');
      expect(list.body.items.map((n: { title: string }) => n.title).sort()).toEqual(expect.arrayContaining(['A1', 'A2']));
      expect(list.body.items.find((n: { id: string }) => n.id === b1.id)).toBeUndefined();
      expect((await alice.post(`/notifications/${b1.id}/read`)).status).toBe(404);
      expect((await alice.del(`/notifications/${b1.id}`)).status).toBe(404);
      expect((await alice.get('/notifications/unread-count')).body.count).toBeGreaterThanOrEqual(2);
      expect((await alice.post(`/notifications/${a1.id}/read`)).status).toBe(200);
      expect((await alice.get('/notifications?unread=true')).body.items.find((n: { id: string }) => n.id === a1.id)).toBeUndefined();
      expect((await alice.post('/notifications/read-all')).status).toBe(200);
      expect((await alice.get('/notifications/unread-count')).body.count).toBe(0);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: b1.id } })).readAt).toBeNull();
      expect((await alice.del(`/notifications/${a1.id}`)).status).toBe(200);
    });
  });

  describe('announcements', () => {
    it('department scoping, notifications and read state', async () => {
      const tech = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '테크' } });
      expect((await alice.post('/announcements', { title: 'x', body: 'y', scope: 'COMPANY' })).status).toBe(403);
      expect((await manager.post('/announcements', { title: 'x', body: 'y', scope: 'DEPARTMENT' })).status).toBe(400);
      const res = await manager.post('/announcements', { title: '테크팀 회의', body: '금요일 회의', scope: 'DEPARTMENT', departmentId: tech.id, pinned: true });
      expect(res.status).toBe(201);
      const id = res.body.id;

      const aList = await alice.get('/announcements');
      expect(aList.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({ read: false, pinned: true, department: { name: '테크' } });
      expect((await bob.get('/announcements')).body.items.find((x: { id: string }) => x.id === id)).toBeUndefined();
      expect((await bob.get(`/announcements/${id}`)).status).toBe(404);
      expect((await bob.post(`/announcements/${id}/read`)).status).toBe(404);

      expect(await prisma.notification.count({ where: { userId: aliceId, type: 'ANNOUNCEMENT', entityId: id } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: bobId, type: 'ANNOUNCEMENT', entityId: id } })).toBe(0);

      expect((await alice.post(`/announcements/${id}/read`)).status).toBe(200);
      expect((await alice.get(`/announcements/${id}`)).body.read).toBe(true);
      expect((await alice.get('/announcements?unread=true')).body.items.find((x: { id: string }) => x.id === id)).toBeUndefined();

      const company = await owner.post('/announcements', { title: '전사 공지', body: '본문', scope: 'COMPANY' });
      const bl = await bob.get('/announcements');
      expect(bl.body.items.find((x: { id: string }) => x.id === company.body.id)).toBeDefined();
      expect(bl.body.unreadCount).toBeGreaterThanOrEqual(1);
      expect(await prisma.notification.count({ where: { userId: bobId, entityId: company.body.id } })).toBe(1);

      // 다른 작성자 공지 수정 불가 (경영진 이상 제외)
      await grantModule(orgId, aliceId, 'announcements.write');
      expect((await alice.patch(`/announcements/${id}`, { title: 'hack' })).status).toBe(403);
      expect((await manager.patch(`/announcements/${id}`, { pinned: false })).status).toBe(200);
      expect((await manager.del(`/announcements/${id}`)).status).toBe(200);
      expect((await alice.get(`/announcements/${id}`)).status).toBe(404);
    });

    it('project announcements require project access', async () => {
      const p = await prisma.project.create({ data: { organizationId: orgId, key: 'ANN', name: '공지 프로젝트', createdById: managerId, managerId, members: { create: [{ userId: managerId, role: 'MANAGER' }] } } });
      await grantModule(orgId, bobId, 'announcements.write');
      expect((await bob.post('/announcements', { title: 'x', body: 'y', scope: 'PROJECT', projectId: p.id })).status).toBe(403);
      const ok = await manager.post('/announcements', { title: '프로젝트 공지', body: 'y', scope: 'PROJECT', projectId: p.id });
      expect(ok.status).toBe(201);
      expect((await bob.get(`/announcements/${ok.body.id}`)).status).toBe(404);
    });
  });

  describe('dashboard & worker jobs', () => {
    it('shows finance KPIs only with finance.read', async () => {
      const today = kstToday();
      await prisma.financialTransaction.createMany({
        data: [
          { organizationId: orgId, txDate: today, type: 'REVENUE', description: '매출', supplyAmount: '1000.10', totalAmount: '1100.11', status: 'APPROVED', createdById: managerId },
          { organizationId: orgId, txDate: today, type: 'EXPENSE', description: '지출', supplyAmount: '100', totalAmount: '100.01', status: 'APPROVED', createdById: managerId },
          { organizationId: orgId, txDate: today, type: 'REVENUE', description: '미승인', supplyAmount: '999', totalAmount: '999', status: 'PENDING', createdById: managerId },
        ],
      });
      const a = await alice.get('/dashboard');
      expect(a.status).toBe(200);
      expect(a.body.finance).toBeNull();
      expect(a.body.tasks).toMatchObject({ open: expect.any(Number) });
      const o = await owner.get('/dashboard');
      expect(o.body.finance).toMatchObject({ revenue: '1100.11', expense: '100.01', net: '1000.10' });
    });

    it('due-reminder job creates TASK_DUE notifications once per 24h', async () => {
      const task = await prisma.task.create({ data: { organizationId: orgId, title: '마감 임박', dueDate: kstToday(), createdById: aliceId, assignees: { create: [{ userId: aliceId }] } } });
      const first = await runDueReminders(prisma);
      expect(first.created.length).toBeGreaterThanOrEqual(1);
      expect(await prisma.notification.count({ where: { userId: aliceId, type: 'TASK_DUE', entityId: task.id } })).toBe(1);
      await runDueReminders(prisma);
      expect(await prisma.notification.count({ where: { userId: aliceId, type: 'TASK_DUE', entityId: task.id } })).toBe(1);
      const dash = await alice.get('/dashboard');
      expect(dash.body.tasks.open).toBeGreaterThanOrEqual(1);
    });
  });
});
