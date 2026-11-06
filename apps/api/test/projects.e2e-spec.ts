import { INestApplication } from '@nestjs/common';
import { createApp, createUser, login, prisma, resetDatabase, type Client } from './helpers';

describe('Projects & tasks', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let manager: Client;
  let employee: Client;
  let outsider: Client;
  let guest: Client;
  let employeeId: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const m = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    const e = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const o = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    const g = await createUser(orgId, 'GUEST');
    employeeId = e.id;
    manager = await login(app, m.email);
    employee = await login(app, e.email);
    outsider = await login(app, o.email);
    guest = await login(app, g.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let projectId: string;
  let taskId: string;

  it('manager creates a project; employee cannot (projects.write)', async () => {
    const res = await manager.post('/projects', { name: '웹사이트 리뉴얼', key: 'WEB', priority: 'HIGH', startDate: '2026-11-01', endDate: '2026-12-31' });
    expect(res.status).toBe(201);
    projectId = res.body.id;
    expect((await employee.post('/projects', { name: 'x' })).status).toBe(403);
    expect((await guest.post('/projects', { name: 'x' })).status).toBe(403);
  });

  it('validates input', async () => {
    expect((await manager.post('/projects', { name: '' })).status).toBe(400);
    expect((await manager.post('/projects', { name: 'a', key: 'bad key' })).status).toBe(400);
    expect((await manager.post('/projects', { name: 'a', hacker: true })).status).toBe(400);
    expect((await manager.post('/projects', { name: 'a', startDate: '2026-12-01', endDate: '2026-01-01' })).status).toBe(400);
  });

  it('enforces resource-level visibility', async () => {
    // 같은 부서 직원은 열람 가능, 다른 부서 직원은 불가
    expect((await employee.get(`/projects/${projectId}`)).status).toBe(200);
    expect((await outsider.get(`/projects/${projectId}`)).status).toBe(404);
    const list = await outsider.get('/projects');
    expect(list.body.items.find((p: { id: string }) => p.id === projectId)).toBeUndefined();
    // 경영진(projects.manage)은 전체 열람
    expect((await owner.get(`/projects/${projectId}`)).status).toBe(200);
  });

  it('view-only member cannot create tasks until added as member', async () => {
    expect((await employee.post('/tasks', { title: 't', projectId })).status).toBe(403);
    expect((await manager.post(`/projects/${projectId}/members`, { userId: employeeId })).status).toBe(201);
    expect((await employee.post('/tasks', { title: '디자인 시안', projectId })).status).toBe(201);
  });

  it('creates tasks with assignees, subtasks, checklist and notifies assignees', async () => {
    const res = await manager.post('/tasks', {
      title: '메인 페이지 개발', projectId, priority: 'URGENT', dueDate: '2026-11-20', assigneeIds: [employeeId],
      checklist: [{ id: 'a', text: 'Hero', done: false }],
    });
    expect(res.status).toBe(201);
    taskId = res.body.id;
    expect(res.body.assignees).toHaveLength(1);
    const sub = await manager.post('/tasks', { title: '하위 업무', parentId: taskId });
    expect(sub.status).toBe(201);
    expect(sub.body.projectId).toBe(projectId);
    const notes = await prisma.notification.findMany({ where: { userId: employeeId, type: 'TASK_ASSIGNED' } });
    expect(notes.length).toBe(1);
  });

  it('moves through TODO → IN_PROGRESS → REVIEW → DONE with history and progress', async () => {
    for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE']) {
      const r = await employee.patch(`/tasks/${taskId}`, { status });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe(status);
    }
    const detail = await employee.get(`/tasks/${taskId}`);
    expect(detail.body.history.length).toBeGreaterThanOrEqual(3);
    expect(detail.body.completedAt).toBeTruthy();
    const project = await manager.get(`/projects/${projectId}`);
    expect(project.body.progress).toBe(50); // 최상위 업무 2개 중 1개 완료
  });

  it('supports custom statuses mapped to base categories', async () => {
    const s = await manager.post(`/projects/${projectId}/statuses`, { name: 'QA 대기', category: 'REVIEW' });
    expect(s.status).toBe(201);
    const t = await manager.post('/tasks', { title: 'QA', projectId, customStatusId: s.body.id });
    expect(t.body.status).toBe('REVIEW');
    expect(t.body.customStatus.name).toBe('QA 대기');
  });

  it('prevents cyclic dependencies', async () => {
    const a = (await manager.post('/tasks', { title: 'A', projectId })).body.id;
    const b = (await manager.post('/tasks', { title: 'B', projectId })).body.id;
    expect((await manager.post(`/tasks/${b}/dependencies`, { dependsOnId: a })).status).toBe(201);
    expect((await manager.post(`/tasks/${a}/dependencies`, { dependsOnId: b })).status).toBe(400);
  });

  it('my tasks returns assigned tasks grouped', async () => {
    const res = await employee.get('/tasks/mine?includeDone=true');
    expect(res.status).toBe(200);
    expect(res.body.groups.done.length).toBe(1);
  });

  it('outsider cannot read or modify tasks of an invisible project', async () => {
    expect((await outsider.get(`/tasks/${taskId}`)).status).toBe(404);
    expect((await outsider.patch(`/tasks/${taskId}`, { title: 'hack' })).status).toBe(404);
  });

  it('records project activity log and soft deletes', async () => {
    const act = await manager.get(`/projects/${projectId}/activity`);
    expect(act.body.length).toBeGreaterThan(3);
    expect((await employee.del(`/projects/${projectId}`)).status).toBe(403);
    expect((await manager.del(`/projects/${projectId}`)).status).toBe(200);
    expect((await manager.get(`/projects/${projectId}`)).status).toBe(404);
    const row = await prisma.project.findUnique({ where: { id: projectId } });
    expect(row?.deletedAt).toBeTruthy();
  });
});
