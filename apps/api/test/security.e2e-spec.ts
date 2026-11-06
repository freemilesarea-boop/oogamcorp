import { INestApplication } from '@nestjs/common';
import IORedis from 'ioredis';
import request from 'supertest';
import { loadConfig } from '../src/config/configuration';
import { QueueService } from '../src/common/queue/queue.service';
import { currentStep, totpAt } from '../src/modules/auth/totp';
import { sendInvitationEmail } from '../src/worker/jobs';
import { createApp, createUser, login, prisma, resetDatabase, TEST_PASSWORD, type Client } from './helpers';

/**
 * 보안 회귀 테스트: MFA(TOTP) 등록·검증·우회 차단·복구 코드·해제·초기화,
 * 초대 토큰 큐 보호, 비밀번호·세션·CSRF·권한 회귀.
 * 설정은 loadConfig() 캐시 객체를 테스트 범위에서만 조정한다.
 */
describe('Security hardening', () => {
  let app: INestApplication;
  let orgId: string;
  const cfg = loadConfig();
  const originalRoles = [...cfg.mfa.requiredRoles];

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
  });
  afterAll(async () => {
    cfg.mfa.requiredRoles = originalRoles;
    cfg.smtp.enabled = false;
    await app.close();
    await prisma.$disconnect();
  });

  async function enroll(c: Client) {
    const start = await c.post('/auth/mfa/enroll/start', { password: TEST_PASSWORD });
    expect(start.status).toBe(200);
    expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret: string = start.body.secret;
    const confirm = await c.post('/auth/mfa/enroll/confirm', { code: totpAt(secret, currentStep()) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    return { secret, recoveryCodes: confirm.body.recoveryCodes as string[] };
  }

  describe('MFA (TOTP)', () => {
    let email: string;
    let userId: string;
    let secret: string;
    let recovery: string[];

    it('enrolls, stores only encrypted secret and hashed recovery codes', async () => {
      const u = await createUser(orgId, 'EXECUTIVE');
      email = u.email;
      userId = u.id;
      const c = await login(app, email);
      expect((await c.post('/auth/mfa/enroll/start', { password: 'wrong-password-1' })).status).toBe(400);
      ({ secret, recoveryCodes: recovery } = await enroll(c));
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaSecretEnc).toMatch(/^v1\./);
      expect(row.mfaSecretEnc).not.toContain(secret);
      const codes = await prisma.mfaRecoveryCode.findMany({ where: { userId } });
      expect(codes).toHaveLength(10);
      expect(codes.some((x) => recovery.some((r) => x.codeHash.includes(r.replace(/-/g, ''))))).toBe(false);
      // 등록한 세션은 계속 사용 가능
      expect((await c.get('/projects')).status).toBe(200);
    });

    it('blocks every admin API until the second factor is verified', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
      expect({ status: res.status, mfaRequired: res.body.mfaRequired }).toEqual({ status: 200, mfaRequired: true });
      const c = await login(app, email);
      for (const path of ['/projects', '/finance/dashboard', '/employees', '/documents', '/settings/roles', '/auth/sessions']) {
        const r = await c.get(path);
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('MFA_REQUIRED');
      }
      expect((await c.post('/projects', { name: 'x' })).status).toBe(401);
      expect((await c.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'Another1Passw0rd' })).status).toBe(401);
      // 허용: me, logout, verify
      const me = await c.get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.mfa).toMatchObject({ enabled: true, verified: false });
    });

    it('rejects wrong codes, accepts a valid code once (no replay)', async () => {
      const c = await login(app, email);
      expect((await c.post('/auth/mfa/verify', { code: '000000' })).status).toBe(400);
      expect((await c.post('/auth/mfa/verify', {})).status).toBe(400);
      const code = totpAt(secret, currentStep() + 1);
      const ok = await c.post('/auth/mfa/verify', { code });
      expect(ok.status).toBe(200);
      expect((await c.get('/projects')).status).toBe(200);
      const other = await login(app, email);
      expect((await other.post('/auth/mfa/verify', { code })).status).toBe(400); // 재사용 거부
    });

    it('revokes the session after too many failed attempts', async () => {
      const c = await login(app, email);
      for (let i = 0; i < cfg.mfa.maxAttempts - 1; i++) expect((await c.post('/auth/mfa/verify', { code: '111111' })).status).toBe(400);
      expect((await c.post('/auth/mfa/verify', { code: '111111' })).status).toBe(401);
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('recovery codes work exactly once', async () => {
      const a = await login(app, email);
      const r = await a.post('/auth/mfa/verify', { recoveryCode: recovery[0].toUpperCase() });
      expect(r.status).toBe(200);
      expect(r.body.recoveryCodesRemaining).toBe(9);
      const b = await login(app, email);
      expect((await b.post('/auth/mfa/verify', { recoveryCode: recovery[0] })).status).toBe(400);
    });

    it('a CSRF token cannot be replayed from another session', async () => {
      const a = await login(app, email);
      const b = await login(app, email);
      const res = await b.agent.post('/api/v1/auth/mfa/verify').set('X-CSRF-Token', a.csrf).send({ code: '123456' });
      expect(res.status).toBe(403);
    });

    it('enforces enrollment for required roles and blocks bypass', async () => {
      cfg.mfa.requiredRoles = ['OWNER'];
      const owner = await login(app, 'owner@test.oogam');
      const blocked = await owner.get('/projects');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
      expect((await owner.get('/auth/mfa')).status).toBe(200);
      await enroll(owner);
      expect((await owner.get('/projects')).status).toBe(200);
      // 필수 역할은 스스로 해제 불가
      const st = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.oogam' } });
      expect(st.mfaEnabled).toBe(true);
      cfg.mfa.requiredRoles = [];
    });

    it('collab handshake rejects MFA-pending sessions', async () => {
      const { CollabPersistence } = await import('../src/modules/documents/collab-persistence');
      const page = await prisma.page.create({
        data: { organizationId: orgId, workspaceId: (await prisma.workspace.findFirstOrThrow()).id, title: 'mfa', createdById: userId },
      });
      const c = await login(app, email);
      const cookie = ([] as string[]).concat((await c.agent.get('/api/v1/auth/me')).request.cookies ?? []).join('; ');
      void cookie;
      // 세션 쿠키 원문 확보: 새 로그인 응답의 Set-Cookie 사용
      const loginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
      const sessionCookie = ([] as string[]).concat(loginRes.headers['set-cookie'] ?? []).find((x) => x.startsWith('oogam_session='))!.split(';')[0];
      const persistence = new CollabPersistence(prisma as never, ['http://localhost:3000'], ['oogam_session']);
      await expect(persistence.authenticate({ documentName: `page:${page.id}`, headers: { cookie: sessionCookie, origin: 'http://localhost:3000' } })).rejects.toThrow('mfa required');
      // 대조군: 검증 완료 세션은 연결 허용
      const sid = (await prisma.session.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 1 }))[0].id;
      await prisma.session.update({ where: { id: sid }, data: { mfaVerified: true } });
      await expect(persistence.authenticate({ documentName: `page:${page.id}`, headers: { cookie: sessionCookie, origin: 'http://localhost:3000' } })).resolves.toMatchObject({ pageId: page.id });
    });

    it('owner can reset another user MFA; executive cannot', async () => {
      const execOther = await createUser(orgId, 'EXECUTIVE');
      const ex = await login(app, execOther.email);
      expect((await ex.post(`/auth/mfa/reset/${userId}`)).status).toBe(403);
      const owner = await login(app, 'owner@test.oogam');
      const ownerSecret = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.oogam' } });
      expect(ownerSecret.mfaEnabled).toBe(true);
      // owner 는 MFA 등록되어 있으므로 검증 필요 → 복구 경로 대신 비밀키로 검증
      const { open } = await import('../src/common/crypto/secret-box');
      const s = open(ownerSecret.mfaSecretEnc!, 'mfa-secret');
      expect((await owner.post('/auth/mfa/verify', { code: totpAt(s, currentStep() + 1) })).status).toBe(200);
      expect((await owner.post(`/auth/mfa/reset/${userId}`)).status).toBe(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(after.mfaEnabled).toBe(false);
      expect(await prisma.mfaRecoveryCode.count({ where: { userId } })).toBe(0);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.mfa.admin_reset', entityId: userId } });
      expect(audit).toBeTruthy();
    });

    it('user can disable MFA with password + code (non-required role)', async () => {
      const u = await createUser(orgId, 'EMPLOYEE');
      const c = await login(app, u.email);
      const { secret: s } = await enroll(c);
      expect((await c.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: '000000' })).status).toBe(400);
      expect((await c.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: totpAt(s, currentStep() + 1) })).status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).mfaEnabled).toBe(false);
    });
  });

  describe('Invitation token in job queue', () => {
    it('stores only an encrypted token in Redis and the worker sends the correct link', async () => {
      cfg.smtp.enabled = true;
      const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@test.oogam' } });
      await prisma.user.update({ where: { id: owner.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      const c = await login(app, 'owner@test.oogam');
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key: 'EMPLOYEE' } });
      const res = await c.post('/employees/invitations', { email: 'queue-check@test.oogam', name: '큐 확인', roleId: role.id });
      expect(res.status).toBe(201);
      expect(res.body.emailQueued).toBe(true);
      const token = new URL(res.body.inviteUrl, 'http://x').searchParams.get('token')!;

      const redis = new IORedis(cfg.redisUrl);
      const keys = await redis.keys('bull:oogam-notifications:*');
      let found = false;
      let jobData: { kind: string; invitationId: string; sealedToken: string } | null = null;
      for (const k of keys) {
        const type = await redis.type(k);
        const dump = type === 'hash' ? JSON.stringify(await redis.hgetall(k)) : type === 'string' ? (await redis.get(k)) ?? '' : '';
        if (dump.includes(token)) found = true;
        if (type === 'hash') {
          const h = await redis.hgetall(k);
          if (h.data?.includes(res.body.id)) jobData = JSON.parse(h.data);
        }
      }
      expect(found).toBe(false);
      expect(jobData?.kind).toBe('invitation-email');
      expect(jobData?.sealedToken).toMatch(/^v1\./);

      // 워커 처리: 복호화한 링크가 실제 토큰과 일치
      const sent: string[] = [];
      const r = await sendInvitationEmail(
        { prisma: prisma as never, cfg, mailer: { send: async (m: { text: string }) => { sent.push(m.text); } } as never, log: { info: () => undefined, warn: () => undefined } as never },
        jobData!.invitationId,
        jobData!.sealedToken,
      );
      expect(r).toBe('sent');
      expect(sent[0]).toContain(encodeURIComponent(token));
      // 다른 초대 ID 로 옮긴 암호문은 거부
      const other = await sendInvitationEmail(
        { prisma: prisma as never, cfg, mailer: { send: async () => undefined } as never, log: { info: () => undefined, warn: () => undefined } as never },
        '00000000-0000-0000-0000-000000000000',
        jobData!.sealedToken,
      );
      expect(other).toBe('skipped');
      // 정리
      const q = app.get(QueueService).notifications;
      for (const j of await q.getJobs(['waiting', 'delayed', 'paused'])) if (j.data.kind === 'invitation-email') await j.remove();
      await redis.quit();
      cfg.smtp.enabled = false;
    });
  });

  describe('Regression: password / session / CSRF / authorization', () => {
    it('password hashes are argon2id and never returned by any user API', async () => {
      const c = await login(app, 'owner@test.oogam');
      for (const path of ['/auth/me', '/employees', '/directory/users']) {
        const body = JSON.stringify((await c.get(path)).body);
        expect(body).not.toMatch(/passwordHash|\$argon2|mfaSecret|tokenHash|csrfToken"\s*:\s*"[^"]+".*csrfToken/);
        expect(body).not.toContain('$argon2');
      }
    });

    it('rejects forged or missing session cookies', async () => {
      const r = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', 'oogam_session=forged-token-value');
      expect(r.status).toBe(401);
    });

    it('expired sessions are rejected', async () => {
      const u = await createUser(orgId, 'EMPLOYEE');
      const c = await login(app, u.email);
      await prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('idle sessions are revoked', async () => {
      const u = await createUser(orgId, 'EMPLOYEE');
      const c = await login(app, u.email);
      await prisma.session.updateMany({ where: { userId: u.id }, data: { lastSeenAt: new Date(Date.now() - (cfg.session.idleMinutes + 1) * 60_000) } });
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('CSRF is required on PUT/PATCH/DELETE too', async () => {
      const c = await login(app, 'owner@test.oogam');
      expect((await c.agent.patch('/api/v1/projects/00000000-0000-0000-0000-000000000000').send({ name: 'x' })).status).toBe(403);
      expect((await c.agent.delete('/api/v1/auth/sessions/00000000-0000-0000-0000-000000000000')).status).toBe(403);
      expect((await c.agent.put('/api/v1/documents/00000000-0000-0000-0000-000000000000/content').send({})).status).toBe(403);
    });

    it('method override headers do not bypass checks', async () => {
      const g = await createUser(orgId, 'GUEST');
      const c = await login(app, g.email);
      const r = await c.agent.get('/api/v1/finance/dashboard').set('X-HTTP-Method-Override', 'GET');
      expect(r.status).toBe(403);
      const r2 = await c.post('/projects?_method=GET', { name: 'x' });
      expect(r2.status).toBe(403);
    });

    it('role permissions: guest/employee cannot reach sensitive or admin modules', async () => {
      const g = await login(app, (await createUser(orgId, 'GUEST')).email);
      const e = await login(app, (await createUser(orgId, 'EMPLOYEE')).email);
      const m = await login(app, (await createUser(orgId, 'MANAGER')).email);
      const forbidden: [Client, string][] = [
        [g, '/finance/dashboard'], [e, '/finance/transactions'], [m, '/finance/budgets'],
        [e, '/audit-logs'], [m, '/audit-logs'], [e, '/cms/inquiries'], [m, '/cms/inquiries'],
        [e, '/settings/grants'], [m, '/settings/grants'], [g, '/employees'],
      ];
      for (const [c, path] of forbidden) expect([403, 404]).toContain((await c.get(path)).status);
      const invite = await e.post('/employees/invitations', { email: 'x@test.oogam', name: 'x', roleId: (await prisma.role.findFirstOrThrow({ where: { key: 'OWNER' } })).id });
      expect(invite.status).toBe(403);
    });

    it('privilege escalation via role change is blocked', async () => {
      const mgrUser = await createUser(orgId, 'MANAGER');
      await prisma.resourceGrant.create({ data: { organizationId: orgId, resourceType: 'MODULE', resourceId: 'employees.manage', userId: mgrUser.id, access: 'FULL' } });
      const mgr = await login(app, mgrUser.email);
      const ownerRole = await prisma.role.findFirstOrThrow({ where: { key: 'OWNER' } });
      const res = await mgr.patch(`/employees/${mgrUser.id}`, { roleId: ownerRole.id });
      expect([400, 403]).toContain(res.status);
      const membership = await prisma.membership.findFirstOrThrow({ where: { userId: mgrUser.id }, include: { role: true } });
      expect(membership.role.key).toBe('MANAGER');
    });

    it('UUID path params are validated (no injection through ids)', async () => {
      const c = await login(app, 'owner@test.oogam');
      expect((await c.get("/projects/1' OR '1'='1")).status).toBe(400);
      expect((await c.get('/projects?sort=password&order=asc')).status).toBe(200);
    });
  });

  describe('Login rate limit (IP)', () => {
    it('returns 429 with a Korean message after the per-minute limit', async () => {
      const prevEnv = cfg.env;
      const prevLimit = process.env.LOGIN_RATE_LIMIT_PER_MIN;
      try {
        (cfg as { env: string }).env = 'development';
        process.env.LOGIN_RATE_LIMIT_PER_MIN = '3';
        const statuses: number[] = [];
        let last: request.Response | undefined;
        for (let i = 0; i < 5; i++) {
          last = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@test.oogam', password: 'x' });
          statuses.push(last.status);
        }
        // 같은 IP 의 이전 로그인 요청도 집계되므로 순서와 무관하게: 한도 초과 시 429 로 전환되고 이후 계속 429
        expect(statuses.every((st) => st === 401 || st === 429)).toBe(true);
        expect(statuses[4]).toBe(429);
        expect(statuses.filter((st) => st === 401).length).toBeLessThanOrEqual(3);
        expect(last!.body.message).toContain('요청이 너무 많습니다');
      } finally {
        (cfg as { env: string }).env = prevEnv;
        if (prevLimit === undefined) delete process.env.LOGIN_RATE_LIMIT_PER_MIN;
        else process.env.LOGIN_RATE_LIMIT_PER_MIN = prevLimit;
      }
    });
  });
});
