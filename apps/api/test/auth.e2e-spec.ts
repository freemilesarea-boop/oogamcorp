import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createUser, login, prisma, resetDatabase, TEST_PASSWORD } from './helpers';

describe('Authentication & sessions', () => {
  let app: INestApplication;
  let orgId: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('stores passwords hashed (argon2id), never plaintext', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.oogam' } });
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
    expect(owner.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('logs in and sets HttpOnly session + CSRF cookies', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'owner@test.oogam', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('oogam_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('oogam_csrf='))).not.toMatch(/HttpOnly/i);
    const stored = await prisma.session.findMany();
    // DB 에는 토큰 원문이 아닌 해시만 저장
    const token = session.split(';')[0].split('=')[1];
    expect(stored.some((s) => s.tokenHash === token)).toBe(false);
  });

  it('rejects wrong password with generic message', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'owner@test.oogam', password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  it('locks the account after repeated failures', async () => {
    const u = await createUser(orgId, 'EMPLOYEE');
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: u.email, password: 'bad-password-123' });
    }
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('너무 많습니다');
  });

  it('requires authentication for protected APIs', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/projects');
    expect(res.status).toBe(401);
  });

  it('blocks state-changing requests without a valid CSRF token', async () => {
    const c = await login(app, 'owner@test.oogam');
    const noToken = await c.agent.post('/api/v1/projects').send({ name: 'x' });
    expect(noToken.status).toBe(403);
    const badToken = await c.agent.post('/api/v1/projects').set('X-CSRF-Token', 'nope').send({ name: 'x' });
    expect(badToken.status).toBe(403);
    const ok = await c.post('/projects', { name: 'CSRF OK' });
    expect(ok.status).toBe(201);
  });

  it('blocks cross-origin writes', async () => {
    const c = await login(app, 'owner@test.oogam');
    const res = await c.agent.post('/api/v1/projects').set('X-CSRF-Token', c.csrf).set('Origin', 'https://evil.example').send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  it('logout revokes the session', async () => {
    const c = await login(app, 'owner@test.oogam');
    expect((await c.get('/auth/me')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('change password revokes other sessions', async () => {
    const u = await createUser(orgId, 'EMPLOYEE');
    const a = await login(app, u.email);
    const b = await login(app, u.email);
    const res = await a.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'NewPassw0rd123' });
    expect(res.status).toBe(200);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
  });

  it('disabled accounts cannot log in and lose access immediately', async () => {
    const u = await createUser(orgId, 'EMPLOYEE');
    const c = await login(app, u.email);
    await prisma.user.update({ where: { id: u.id }, data: { status: 'DISABLED' } });
    expect((await c.get('/auth/me')).status).toBe(401);
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('records audit logs for login events', async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { startsWith: 'auth.login' } } });
    expect(logs.length).toBeGreaterThan(0);
  });
});
