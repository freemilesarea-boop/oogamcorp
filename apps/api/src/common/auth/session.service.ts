import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import type { Response } from 'express';
import { loadConfig } from '../../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from './access.service';
import type { AuthContext } from './auth.types';
import { generateToken, sha256 } from './tokens';

/** 서버 측 세션 저장소 (PostgreSQL). 쿠키에는 불투명 토큰만 저장, DB 에는 해시만 저장 */
@Injectable()
export class SessionService {
  private readonly cfg = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async create(params: { userId: string; organizationId: string; ip?: string; userAgent?: string }) {
    const token = generateToken(32);
    const csrfToken = generateToken(24);
    const expiresAt = new Date(Date.now() + this.cfg.session.ttlHours * 3600_000);
    const session = await this.prisma.session.create({
      data: {
        userId: params.userId,
        organizationId: params.organizationId,
        tokenHash: sha256(token),
        csrfToken,
        ip: params.ip?.slice(0, 64),
        userAgent: params.userAgent?.slice(0, 255),
        expiresAt,
      },
    });
    return { token, csrfToken, session };
  }

  /** 쿠키 토큰으로 인증 컨텍스트를 구성한다. 만료·유휴 시간 초과·비활성 계정은 null */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (now - session.lastSeenAt.getTime() > this.cfg.session.idleMinutes * 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return null;
    }
    const user = session.user;
    if (user.status !== UserStatus.ACTIVE || user.deletedAt) return null;

    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: session.organizationId, userId: user.id } },
      include: { role: true },
    });
    if (!membership || membership.employmentStatus === 'RESIGNED') return null;

    // lastSeenAt 갱신은 60초 단위로 제한 (쓰기 부하 감소)
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }

    const permissions = await this.access.resolvePermissions({
      organizationId: session.organizationId,
      userId: user.id,
      roleId: membership.roleId,
      departmentId: membership.departmentId,
    });

    return {
      sessionId: session.id,
      userId: user.id,
      organizationId: session.organizationId,
      membershipId: membership.id,
      email: user.email,
      name: user.name,
      roleKey: membership.role.key,
      roleRank: membership.role.rank,
      departmentId: membership.departmentId,
      permissions,
      csrfToken: session.csrfToken,
      mfa: {
        enabled: user.mfaEnabled,
        verified: !user.mfaEnabled || session.mfaVerified,
        required: this.cfg.mfa.requiredRoles.includes(membership.role.key),
      },
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }

  setCookies(res: Response, token: string, csrfToken: string): void {
    const maxAge = this.cfg.session.ttlHours * 3600_000;
    res.cookie(this.cfg.cookie.sessionName, token, {
      httpOnly: true,
      secure: this.cfg.cookie.secure,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    res.cookie(this.cfg.cookie.csrfName, csrfToken, {
      httpOnly: false, // 프런트엔드가 읽어 X-CSRF-Token 헤더로 전송 (세션에 바인딩된 동기화 토큰)
      secure: this.cfg.cookie.secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  }

  clearCookies(res: Response): void {
    res.clearCookie(this.cfg.cookie.sessionName, { path: '/' });
    res.clearCookie(this.cfg.cookie.csrfName, { path: '/' });
  }
}
