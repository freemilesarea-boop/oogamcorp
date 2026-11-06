import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PermissionKey, SystemRole } from '@oogam/shared';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { hashPassword } from '../src/modules/auth/password';
import { seed } from '../prisma/seed';

export const prisma = new PrismaClient();
export const TEST_PASSWORD = 'TestPassw0rd!';

export async function resetDatabase(): Promise<{ organizationId: string; roles: Record<string, string>; workspaceId: string }> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  process.env.SEED_OWNER_PASSWORD = TEST_PASSWORD;
  process.env.SEED_OWNER_EMAIL = 'owner@test.oogam';
  return seed(prisma, { quiet: true });
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

let counter = 0;
/** 지정 역할의 활성 사용자를 생성 */
export async function createUser(orgId: string, role: SystemRole, opts: { departmentName?: string; name?: string } = {}) {
  counter += 1;
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: orgId, key: role } } });
  const dept = opts.departmentName
    ? await prisma.department.findFirst({ where: { organizationId: orgId, name: opts.departmentName } })
    : null;
  const email = `${role.toLowerCase()}${counter}-${Date.now()}@test.oogam`;
  const user = await prisma.user.create({
    data: { email, name: opts.name ?? `${role} ${counter}`, status: 'ACTIVE', passwordHash: await hashPassword(TEST_PASSWORD) },
  });
  await prisma.membership.create({ data: { organizationId: orgId, userId: user.id, roleId: roleRow.id, departmentId: dept?.id } });
  const ws = await prisma.workspace.findFirst({ where: { organizationId: orgId, isDefault: true } });
  if (ws) await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id } });
  return { ...user, email };
}

/** 명시적 모듈 권한 부여 (resource_grants MODULE) */
export async function grantModule(orgId: string, userId: string, perm: PermissionKey) {
  await prisma.resourceGrant.create({ data: { organizationId: orgId, resourceType: 'MODULE', resourceId: perm, userId, access: 'FULL' } });
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

/** 로그인된 HTTP 클라이언트 (쿠키 유지 + CSRF 헤더 자동 첨부) */
export async function login(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<Client> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken as string;
  const p = (path: string) => `/api/v1${path}`;
  return {
    agent,
    csrf,
    get: (url) => agent.get(p(url)),
    post: (url, body = {}) => agent.post(p(url)).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(p(url)).set('X-CSRF-Token', csrf).send(body),
    put: (url, body = {}) => agent.put(p(url)).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(p(url)).set('X-CSRF-Token', csrf),
  };
}
