/**
 * Preview(검수용) 전용 시드 1단계: 데모 데이터 생성을 담당할 가상 경영진 계정 2개를 만든다.
 * - PREVIEW_SEED=1 일 때만 실행 (운영 환경 오용 방지)
 * - 비밀번호는 실행 시 무작위 생성, 결과는 stdout(JSON)으로만 출력 → 호출 스크립트가 0600 파일로 보관
 * - 이 계정들은 가상 인물이며 실제 직원 정보가 아니다.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const PERSONAS = [
  { key: 'creator', email: 'jung.sample@preview.oogam.invalid', name: '정샘플', title: '이사' },
  { key: 'approver', email: 'han.sample@preview.oogam.invalid', name: '한샘플', title: '상무' },
];

async function main() {
  if (process.env.PREVIEW_SEED !== '1') throw new Error('PREVIEW_SEED=1 일 때만 실행할 수 있습니다.');
  const org = await prisma.organization.findFirstOrThrow({ where: { slug: process.env.SEED_ORG_SLUG ?? 'oogam' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: 'EXECUTIVE' } } });
  const dept = await prisma.department.findFirst({ where: { organizationId: org.id, name: '경영지원' } });
  const ws = await prisma.workspace.findFirst({ where: { organizationId: org.id, isDefault: true } });
  const owner = await prisma.membership.findFirst({ where: { organizationId: org.id, role: { key: 'OWNER' } }, select: { userId: true } });
  const out: Record<string, unknown> = { ownerUserId: owner?.userId };
  for (const p of PERSONAS) {
    const password = randomBytes(18).toString('base64url') + 'a1';
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = await prisma.user.upsert({
      where: { email: p.email },
      create: { email: p.email, name: p.name, status: 'ACTIVE', passwordHash, passwordChangedAt: new Date() },
      update: { passwordHash, status: 'ACTIVE', mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastUsedStep: null },
    });
    await prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      create: { organizationId: org.id, userId: user.id, roleId: role.id, departmentId: dept?.id, title: p.title, hireDate: new Date() },
      update: { roleId: role.id },
    });
    if (ws) await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } }, create: { workspaceId: ws.id, userId: user.id }, update: {} });
    out[p.key] = { email: p.email, password, userId: user.id };
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
