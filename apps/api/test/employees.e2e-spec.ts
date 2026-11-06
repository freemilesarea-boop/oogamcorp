import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createUser, grantModule, login, prisma, resetDatabase, TEST_PASSWORD, type Client } from './helpers';

describe('Employees, invitations, roles, HR, departments', () => {
  let app: INestApplication;
  let orgId: string;
  let roles: Record<string, string>;
  let owner: Client;
  let ownerId: string;
  let exec: Client;
  let execId: string;
  let manager: Client;
  let managerId: string;
  let employee: Client;
  let employeeId: string;

  beforeAll(async () => {
    ({ organizationId: orgId, roles } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.oogam' } })).id;
    const x = await createUser(orgId, 'EXECUTIVE', { departmentName: '경영지원' });
    const m = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    const e = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    execId = x.id;
    managerId = m.id;
    employeeId = e.id;
    exec = await login(app, x.email);
    manager = await login(app, m.email);
    employee = await login(app, e.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists employees without HR data and supports filters', async () => {
    const res = await employee.get('/employees?pageSize=50');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('annualSalary');
    expect(raw).not.toContain('passwordHash');
    const me = res.body.items.find((i: { id: string }) => i.id === employeeId);
    expect(me).toMatchObject({ role: { key: 'EMPLOYEE' }, department: { name: '테크' }, employmentStatus: 'ACTIVE' });
    expect(me.phone).toBeUndefined(); // 연락처는 관리자에게만

    const tech = await employee.get('/employees?role=MANAGER');
    expect(tech.body.items.every((i: { role: { key: string } }) => i.role.key === 'MANAGER')).toBe(true);
    expect((await employee.get('/employees?status=BOGUS')).status).toBe(400);
    expect((await employee.get(`/employees/${managerId}`)).status).toBe(200);
  });

  it('invite → accept → login works end-to-end with the one-time token', async () => {
    const res = await owner.post('/employees/invitations', { email: 'New.Hire@Test.oogam', name: '신입', roleId: roles.EMPLOYEE, title: '디자이너' });
    expect(res.status).toBe(201);
    expect(res.body.inviteUrl).toMatch(/^\/admin\/accept-invite\?token=/);
    expect(res.body.emailQueued).toBe(false);
    const token = decodeURIComponent(res.body.inviteUrl.split('token=')[1]);
    // 원문 토큰은 DB 에 저장되지 않는다
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.email).toBe('new.hire@test.oogam');

    const pending = await owner.get('/employees/invitations');
    expect(pending.body.find((i: { id: string }) => i.id === res.body.id)).toMatchObject({ status: 'PENDING' });

    const anon = request(app.getHttpServer());
    expect((await anon.get(`/api/v1/auth/invitation?token=${encodeURIComponent(token)}`)).status).toBe(200);
    const accept = await anon.post('/api/v1/auth/accept-invitation').send({ token, name: '신입 사원', password: TEST_PASSWORD });
    expect(accept.status).toBe(200);
    const newbie = await login(app, 'new.hire@test.oogam');
    const me = await newbie.get('/auth/me');
    expect(me.body.role.key).toBe('EMPLOYEE');
    // 토큰 재사용 불가
    expect((await anon.post('/api/v1/auth/accept-invitation').send({ token, name: 'x', password: TEST_PASSWORD })).status).toBe(400);
    // 이미 활성 계정은 재초대 불가
    expect((await owner.post('/employees/invitations', { email: 'new.hire@test.oogam', roleId: roles.EMPLOYEE })).status).toBe(409);
  });

  it('resend issues a new token (old one invalid) and revoke works', async () => {
    const inv = await owner.post('/employees/invitations', { email: 'later@test.oogam', roleId: roles.GUEST });
    const oldToken = decodeURIComponent(inv.body.inviteUrl.split('token=')[1]);
    const resent = await owner.post(`/employees/invitations/${inv.body.id}/resend`);
    expect(resent.status).toBe(200);
    const newToken = decodeURIComponent(resent.body.inviteUrl.split('token=')[1]);
    expect(newToken).not.toBe(oldToken);
    const anon = request(app.getHttpServer());
    expect((await anon.get(`/api/v1/auth/invitation?token=${encodeURIComponent(oldToken)}`)).status).toBe(400);
    expect((await anon.get(`/api/v1/auth/invitation?token=${encodeURIComponent(newToken)}`)).status).toBe(200);
    expect((await owner.del(`/employees/invitations/${inv.body.id}`)).status).toBe(200);
    expect((await anon.get(`/api/v1/auth/invitation?token=${encodeURIComponent(newToken)}`)).status).toBe(400);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: 'employee.invit' } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['employee.invited', 'employee.invitation.resent', 'employee.invitation.revoked']));
  });

  it('EMPLOYEE cannot invite or manage (403)', async () => {
    expect((await employee.post('/employees/invitations', { email: 'x@test.oogam', roleId: roles.EMPLOYEE })).status).toBe(403);
    expect((await employee.get('/employees/invitations')).status).toBe(403);
    expect((await employee.patch(`/employees/${managerId}`, { title: 'x' })).status).toBe(403);
    expect((await employee.put(`/employees/${managerId}/role`, { roleId: roles.EMPLOYEE })).status).toBe(403);
  });

  it('MANAGER (with employees.manage) cannot promote to EXECUTIVE or invite an EXECUTIVE', async () => {
    await grantModule(orgId, managerId, 'employees.manage');
    expect((await manager.put(`/employees/${employeeId}/role`, { roleId: roles.EXECUTIVE })).status).toBe(403);
    expect((await manager.post('/employees/invitations', { email: 'boss@test.oogam', roleId: roles.EXECUTIVE })).status).toBe(403);
    // 자신보다 높은 사용자 변경 불가
    expect((await manager.patch(`/employees/${execId}`, { title: 'x' })).status).toBe(403);
    // 동일 서열까지는 허용
    expect((await manager.put(`/employees/${employeeId}/role`, { roleId: roles.MANAGER })).status).toBe(200);
    expect((await manager.put(`/employees/${employeeId}/role`, { roleId: roles.EMPLOYEE })).status).toBe(200);
    expect((await manager.put(`/employees/${managerId}/role`, { roleId: roles.MANAGER })).status).toBe(400); // 본인 역할 변경 불가
  });

  it('EXECUTIVE cannot grant OWNER', async () => {
    expect((await exec.put(`/employees/${employeeId}/role`, { roleId: roles.OWNER })).status).toBe(403);
    expect((await exec.post('/employees/invitations', { email: 'owner2@test.oogam', roleId: roles.OWNER })).status).toBe(403);
    expect((await exec.put(`/employees/${ownerId}/role`, { roleId: roles.EMPLOYEE })).status).toBe(403);
    expect((await exec.post(`/employees/${ownerId}/deactivate`)).status).toBe(403);
    // OWNER 는 OWNER 를 부여할 수 있다
    expect((await owner.post('/employees/invitations', { email: 'owner2@test.oogam', roleId: roles.OWNER })).status).toBe(201);
  });

  it('protects the last active OWNER from demotion/deactivation', async () => {
    // OWNER 와 같은 서열의 사용자 정의 역할(테스트 전용)로 마지막 OWNER 강등 시도
    const perms = await prisma.permission.findMany({ where: { key: { in: ['workspace.access', 'employees.read', 'employees.manage'] } } });
    const superRole = await prisma.role.create({ data: { organizationId: orgId, key: 'SUPER_ADMIN', name: '슈퍼', rank: 100, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } } });
    const s = await createUser(orgId, 'EMPLOYEE');
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: s.id } }, data: { roleId: superRole.id } });
    const sup = await login(app, s.email);
    const demote = await sup.put(`/employees/${ownerId}/role`, { roleId: roles.EXECUTIVE });
    expect(demote.status).toBe(400);
    expect(demote.body.message).toContain('마지막 최고관리자');
    expect((await sup.post(`/employees/${ownerId}/deactivate`)).status).toBe(400);
    expect((await sup.patch(`/employees/${ownerId}`, { employmentStatus: 'RESIGNED' })).status).toBe(400);
    // 본인 비활성화/역할 변경 불가
    expect((await owner.post(`/employees/${ownerId}/deactivate`)).status).toBe(400);
    expect((await owner.put(`/employees/${ownerId}/role`, { roleId: roles.EXECUTIVE })).status).toBe(400);

    // 두 번째 OWNER 가 생기면 강등 가능
    const o2 = await createUser(orgId, 'OWNER');
    expect((await sup.put(`/employees/${o2.id}/role`, { roleId: roles.EXECUTIVE })).status).toBe(200);
    const roleAudit = await prisma.auditLog.findFirst({ where: { action: 'employee.role.changed', entityId: o2.id } });
    expect(roleAudit?.metadata).toMatchObject({ from: 'OWNER', to: 'EXECUTIVE' });
  });

  it('deactivate revokes all sessions; reactivate restores login', async () => {
    const victim = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    const v = await login(app, victim.email);
    expect((await v.get('/auth/me')).status).toBe(200);
    const res = await owner.post(`/employees/${victim.id}/deactivate`, { resign: true });
    expect(res.status).toBe(200);
    expect(res.body.revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await v.get('/auth/me')).status).toBe(401);
    await expect(login(app, victim.email)).rejects.toThrow();
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: victim.id } });
    expect(m.employmentStatus).toBe('RESIGNED');
    expect((await owner.post(`/employees/${victim.id}/reactivate`)).status).toBe(200);
    expect((await (await login(app, victim.email)).get('/auth/me')).status).toBe(200);
  });

  it('updates profile fields with validation', async () => {
    const dept = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '콘텐츠' } });
    const res = await owner.patch(`/employees/${employeeId}`, { title: '선임', departmentId: dept.id, hireDate: '2024-03-02', employeeNumber: 'E-001', phone: '010-1234-5678' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: '선임', department: { name: '콘텐츠' }, employeeNumber: 'E-001' });
    expect((await owner.patch(`/employees/${employeeId}`, { salary: 1 })).status).toBe(400);
    expect((await owner.patch(`/employees/${employeeId}`, { phone: '<script>' })).status).toBe(400);
  });

  it('HR record hidden from EXECUTIVE by default, visible after explicit grant; access audited', async () => {
    const put = await owner.put(`/employees/${employeeId}/hr`, { annualSalary: '52000000.50', salaryNote: '2026 연봉' });
    expect(put.status).toBe(200);
    expect(put.body.annualSalary).toBe('52000000.50');
    expect((await owner.put(`/employees/${employeeId}/hr`, { annualSalary: '-1' })).status).toBe(400);
    expect((await owner.put(`/employees/${employeeId}/hr`, { annualSalary: 1.5 })).status).toBe(400);

    expect((await exec.get(`/employees/${employeeId}/hr`)).status).toBe(403);
    const detail = await exec.get(`/employees/${employeeId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain('52000000');

    // EXECUTIVE 는 권한 정책 변경 불가
    expect((await exec.post('/settings/grants', { permission: 'hr.sensitive.read', userId: execId })).status).toBe(403);
    const grant = await owner.post('/settings/grants', { permission: 'hr.sensitive.read', userId: execId });
    expect(grant.status).toBe(201);
    const view = await exec.get(`/employees/${employeeId}/hr`);
    expect(view.status).toBe(200);
    expect(view.body.annualSalary).toBe('52000000.50');
    expect((await exec.put(`/employees/${employeeId}/hr`, { annualSalary: '1' })).status).toBe(403);

    const logs = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: 'hr.record' } } });
    expect(logs.some((l) => l.action === 'hr.record.viewed' && l.actorId === execId)).toBe(true);
    const upd = logs.find((l) => l.action === 'hr.record.updated');
    expect(JSON.stringify(upd?.metadata)).not.toContain('52000000'); // 값은 감사 로그에 남기지 않음

    // 부여 철회 후 다시 차단
    expect((await owner.del(`/settings/grants/${grant.body.id}`)).status).toBe(200);
    expect((await exec.get(`/employees/${employeeId}/hr`)).status).toBe(403);
  });

  it('employee detail only lists projects the viewer can see', async () => {
    const tech = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '테크' } });
    const p = await prisma.project.create({
      data: { organizationId: orgId, key: 'SEC', name: '비공개 프로젝트', createdById: managerId, managerId, departmentId: tech.id, members: { create: [{ userId: managerId, role: 'MANAGER' }] } },
    });
    const outsider = await createUser(orgId, 'EMPLOYEE', { departmentName: '브랜드전략' });
    const oc = await login(app, outsider.email);
    const seen = await oc.get(`/employees/${managerId}`);
    expect(seen.body.projects.find((x: { id: string }) => x.id === p.id)).toBeUndefined();
    const byOwner = await owner.get(`/employees/${managerId}`);
    expect(byOwner.body.projects.find((x: { id: string }) => x.id === p.id)).toBeDefined();
  });

  describe('departments', () => {
    let parentId: string;
    let childId: string;

    it('creates hierarchy, prevents cycles and validates manager', async () => {
      expect((await employee.post('/departments', { name: '신규' })).status).toBe(403);
      const parent = await owner.post('/departments', { name: '연구소', managerId });
      expect(parent.status).toBe(201);
      parentId = parent.body.id;
      const child = await owner.post('/departments', { name: 'AI 팀', parentId });
      childId = child.body.id;
      expect((await owner.patch(`/departments/${parentId}`, { parentId: childId })).status).toBe(400);
      expect((await owner.patch(`/departments/${parentId}`, { parentId })).status).toBe(400);
      expect((await owner.post('/departments', { name: 'x', managerId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      expect((await owner.post('/departments', { name: '연구소' })).status).toBe(409);
      const list = await employee.get('/departments');
      expect(list.body.find((d: { id: string }) => d.id === parentId)).toMatchObject({ manager: { id: managerId } });
    });

    it('assigns members and refuses deletion while active members remain', async () => {
      expect((await owner.post(`/departments/${childId}/members`, { userIds: [employeeId] })).status).toBe(201);
      const members = await employee.get(`/departments/${childId}/members`);
      expect(members.body.map((m: { id: string }) => m.id)).toContain(employeeId);
      expect((await owner.del(`/departments/${childId}`)).status).toBe(409);
      expect((await owner.del(`/departments/${childId}?moveTo=${parentId}`)).status).toBe(200);
      const m = await prisma.membership.findFirstOrThrow({ where: { userId: employeeId } });
      expect(m.departmentId).toBe(parentId);
      expect((await employee.get(`/departments/${childId}`)).status).toBe(404);
      // 삭제된 이름 재사용 가능
      expect((await owner.post('/departments', { name: 'AI 팀' })).status).toBe(201);
    });
  });
});
