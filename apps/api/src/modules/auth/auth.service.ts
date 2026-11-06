import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { loadConfig } from '../../config/configuration';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import { sha256 } from '../../common/auth/tokens';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dummyHash, hashPassword, verifyPassword } from './password';

const GENERIC_LOGIN_ERROR = '이메일 또는 비밀번호가 올바르지 않습니다.';

@Injectable()
export class AuthService {
  private readonly cfg = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { memberships: { select: { organizationId: true, employmentStatus: true }, take: 1 } },
    });

    if (!user || user.deletedAt) {
      await verifyPassword(await dummyHash(), password); // 타이밍 공격 완화
      await this.audit.log({ action: 'auth.login.failed', metadata: { email: normalized, reason: 'unknown' }, ...meta });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ action: 'auth.login.locked', actorId: user.id, ...meta });
      throw new UnauthorizedException('로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
    }

    const ok = await verifyPassword(user.passwordHash, password);
    const membership = user.memberships[0];
    if (!ok || user.status !== UserStatus.ACTIVE || !membership || membership.employmentStatus === 'RESIGNED') {
      if (!ok) {
        const failures = user.failedLoginCount + 1;
        const lock = failures >= this.cfg.login.maxFailures;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failures,
            lockedUntil: lock ? new Date(Date.now() + this.cfg.login.lockMinutes * 60_000) : undefined,
          },
        });
      }
      await this.audit.log({
        action: 'auth.login.failed',
        actorId: user.id,
        organizationId: membership?.organizationId,
        metadata: { reason: ok ? 'inactive' : 'password' },
        ...meta,
      });
      throw new UnauthorizedException(ok ? '비활성화된 계정입니다. 관리자에게 문의하세요.' : GENERIC_LOGIN_ERROR);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const created = await this.sessions.create({ userId: user.id, organizationId: membership.organizationId, ...meta });
    await this.audit.log({ action: 'auth.login.success', actorId: user.id, organizationId: membership.organizationId, ...meta });
    // MFA 구조: user.mfaEnabled 가 true 인 경우 session.mfaVerified=false 로 생성 후 추가 검증 단계를 요구하도록 확장
    return { ...created, mfaRequired: user.mfaEnabled };
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
    }
    if (current === next) throw new BadRequestException('새 비밀번호는 기존 비밀번호와 달라야 합니다.');
    await this.prisma.user.update({
      where: { id: auth.userId },
      data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() },
    });
    const revoked = await this.sessions.revokeAllForUser(auth.userId, auth.sessionId);
    await this.audit.forUser(auth, 'auth.password.changed', { metadata: { revokedOtherSessions: revoked } });
  }

  async me(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, locale: true, mfaEnabled: true, lastLoginAt: true },
    });
    const membership = await this.prisma.membership.findUniqueOrThrow({
      where: { id: auth.membershipId },
      select: { title: true, department: { select: { id: true, name: true } }, role: { select: { key: true, name: true } } },
    });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId }, select: { id: true, name: true, slug: true } });
    return {
      user,
      organization: org,
      role: membership.role,
      title: membership.title,
      department: membership.department,
      permissions: [...auth.permissions].sort(),
      csrfToken: auth.csrfToken,
    };
  }

  listSessions(auth: AuthContext) {
    return this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(auth: AuthContext, sessionId: string) {
    const r = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.forUser(auth, 'auth.session.revoked', { entityType: 'session', entityId: sessionId });
    return { revoked: r.count };
  }

  async invitationInfo(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { organization: { select: { name: true } }, role: { select: { name: true } } },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
      throw new BadRequestException('유효하지 않거나 만료된 초대입니다.');
    }
    return { email: inv.email, name: inv.name, organization: inv.organization.name, role: inv.role.name, expiresAt: inv.expiresAt };
  }

  /** 초대 수락: 계정 활성화 + 비밀번호 설정 (외부 공개 회원가입은 존재하지 않음) */
  async acceptInvitation(token: string, name: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const tokenHash = sha256(token);
    const passwordHash = await hashPassword(password);
    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash } });
      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
        throw new BadRequestException('유효하지 않거나 만료된 초대입니다.');
      }
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('이미 사용된 초대입니다.');

      const existing = await tx.user.findUnique({ where: { email: inv.email } });
      if (existing && existing.status === UserStatus.ACTIVE) throw new BadRequestException('이미 활성화된 계정입니다.');
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { name, passwordHash, status: UserStatus.ACTIVE, passwordChangedAt: new Date() } })
        : await tx.user.create({ data: { email: inv.email, name, passwordHash, status: UserStatus.ACTIVE, passwordChangedAt: new Date() } });
      await tx.membership.upsert({
        where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } },
        create: { organizationId: inv.organizationId, userId: user.id, roleId: inv.roleId, departmentId: inv.departmentId, title: inv.title, hireDate: new Date() },
        update: { roleId: inv.roleId, departmentId: inv.departmentId, title: inv.title, employmentStatus: 'ACTIVE' },
      });
      const ws = await tx.workspace.findFirst({ where: { organizationId: inv.organizationId, isDefault: true } });
      if (ws) {
        await tx.workspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
          create: { workspaceId: ws.id, userId: user.id },
          update: {},
        });
      }
      await this.audit.log({ action: 'auth.invitation.accepted', organizationId: inv.organizationId, actorId: user.id, entityType: 'invitation', entityId: inv.id, ...meta }, tx);
      return { userId: user.id, organizationId: inv.organizationId };
    });
    return result;
  }
}
