import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import { open, seal } from '../../common/crypto/secret-box';
import { PrismaService } from '../../common/prisma/prisma.service';
import { loadConfig } from '../../config/configuration';
import { verifyPassword } from './password';
import { generateSecret, otpauthUrl, verifyTotp } from './totp';

const RECOVERY_COUNT = 10;
const AAD = 'mfa-secret';

/** 복구 코드 정규화 + HMAC 해시 (원문 미저장) */
function hashRecovery(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return createHmac('sha256', loadConfig().encryptionKey).update(`recovery:${normalized}`).digest('hex');
}

function newRecoveryCode(): string {
  const raw = randomBytes(8).toString('hex'); // 16 hex chars, 64bit
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

/**
 * 관리자 계정 2단계 인증 (TOTP).
 * 등록(start → confirm) / 로그인 후 검증 / 해제 / 복구 코드 재발급 / 관리자 초기화.
 * 비밀키는 AES-256-GCM 으로 암호화 저장, 복구 코드는 HMAC 해시만 저장(1회용).
 */
@Injectable()
export class MfaService {
  private readonly cfg = loadConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async status(auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { mfaEnabled: true, mfaEnrolledAt: true } });
    const remaining = user.mfaEnabled ? await this.prisma.mfaRecoveryCode.count({ where: { userId: auth.userId, usedAt: null } }) : 0;
    return { enabled: user.mfaEnabled, enrolledAt: user.mfaEnrolledAt, required: auth.mfa.required, verified: auth.mfa.verified, recoveryCodesRemaining: remaining };
  }

  async startEnrollment(auth: AuthContext, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabled) throw new BadRequestException('이미 2단계 인증이 등록되어 있습니다.');
    if (!(await verifyPassword(user.passwordHash, password))) throw new BadRequestException('비밀번호가 올바르지 않습니다.');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaPendingSecretEnc: seal(secret, AAD) } });
    const url = otpauthUrl(secret, user.email, this.cfg.mfa.issuer);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0a0a0a', light: '#ffffff' } });
    await this.audit.forUser(auth, 'auth.mfa.enrollment_started');
    return { secret, otpauthUrl: url, qrDataUrl };
  }

  async confirmEnrollment(auth: AuthContext, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabled) throw new BadRequestException('이미 2단계 인증이 등록되어 있습니다.');
    if (!user.mfaPendingSecretEnc) throw new BadRequestException('먼저 등록을 시작하세요.');
    const secret = open(user.mfaPendingSecretEnc, AAD);
    const step = verifyTotp(secret, code);
    if (step === null) throw new BadRequestException('인증 코드가 올바르지 않습니다. 기기 시간을 확인하세요.');
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaSecretEnc: seal(secret, AAD), mfaPendingSecretEnc: null, mfaEnrolledAt: new Date(), mfaLastUsedStep: step },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: hashRecovery(c) })) });
      await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerified: true, mfaFailedAttempts: 0 } });
      await this.audit.forUser(auth, 'auth.mfa.enabled', {}, tx);
    });
    await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    return { enabled: true, recoveryCodes: codes };
  }

  /** 로그인 후 2단계 검증 (TOTP 또는 복구 코드). 실패 한도 초과 시 세션 폐기 */
  async verify(auth: AuthContext, input: { code?: string; recoveryCode?: string }, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new BadRequestException('2단계 인증이 등록되지 않은 계정입니다.');
    if (auth.mfa.verified) return { verified: true, recoveryCodeUsed: false, recoveryCodesRemaining: undefined };

    let ok = false;
    let usedRecovery = false;
    if (input.code) {
      const step = verifyTotp(open(user.mfaSecretEnc, AAD), input.code, { lastUsedStep: user.mfaLastUsedStep });
      if (step !== null) {
        // 동시 요청 재사용 방지: 더 큰 단계로만 갱신
        const r = await this.prisma.user.updateMany({
          where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
          data: { mfaLastUsedStep: step },
        });
        ok = r.count === 1;
      }
    } else if (input.recoveryCode) {
      const r = await this.prisma.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashRecovery(input.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      ok = r.count === 1;
      usedRecovery = ok;
    }

    if (!ok) {
      const s = await this.prisma.session.update({ where: { id: auth.sessionId }, data: { mfaFailedAttempts: { increment: 1 } } });
      await this.audit.forUser(auth, 'auth.mfa.failed', { metadata: { attempts: s.mfaFailedAttempts }, ...meta });
      if (s.mfaFailedAttempts >= this.cfg.mfa.maxAttempts) {
        await this.sessions.revoke(auth.sessionId);
        await this.audit.forUser(auth, 'auth.mfa.session_revoked', meta);
        throw new UnauthorizedException('2단계 인증 실패 횟수를 초과했습니다. 다시 로그인하세요.');
      }
      throw new BadRequestException('인증 코드가 올바르지 않습니다.');
    }
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { mfaVerified: true, mfaFailedAttempts: 0 } });
    await this.audit.forUser(auth, usedRecovery ? 'auth.mfa.recovery_used' : 'auth.mfa.verified', meta);
    const remaining = await this.prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
    return { verified: true, recoveryCodeUsed: usedRecovery, recoveryCodesRemaining: remaining };
  }

  private async assertSecondFactor(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw new BadRequestException('2단계 인증이 등록되지 않았습니다.');
    if (!(await verifyPassword(user.passwordHash, password))) throw new BadRequestException('비밀번호가 올바르지 않습니다.');
    const step = verifyTotp(open(user.mfaSecretEnc, AAD), code, { lastUsedStep: user.mfaLastUsedStep });
    if (step === null) throw new BadRequestException('인증 코드가 올바르지 않습니다.');
    await this.prisma.user.update({ where: { id: userId }, data: { mfaLastUsedStep: step } });
    return user;
  }

  async disable(auth: AuthContext, password: string, code: string) {
    if (auth.mfa.required) throw new ForbiddenException('역할 정책상 2단계 인증을 해제할 수 없습니다. 기기를 바꾸려면 복구 코드를 재발급하거나 관리자 초기화를 요청하세요.');
    await this.assertSecondFactor(auth.userId, password, code);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: auth.userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastUsedStep: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: auth.userId } }),
    ]);
    await this.sessions.revokeAllForUser(auth.userId, auth.sessionId);
    await this.audit.forUser(auth, 'auth.mfa.disabled');
    return { enabled: false };
  }

  async regenerateRecoveryCodes(auth: AuthContext, password: string, code: string) {
    await this.assertSecondFactor(auth.userId, password, code);
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: auth.userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: auth.userId, codeHash: hashRecovery(c) })) }),
    ]);
    await this.audit.forUser(auth, 'auth.mfa.recovery_regenerated');
    return { recoveryCodes: codes };
  }

  /** 분실 시 관리자 초기화: OWNER 서열만, 자기 자신 불가, 대상 세션 전체 폐기 */
  async adminReset(auth: AuthContext, targetUserId: string) {
    if (auth.roleKey !== 'OWNER' || !auth.permissions.has('settings.manage')) throw new ForbiddenException('최고관리자만 2단계 인증을 초기화할 수 있습니다.');
    if (targetUserId === auth.userId) throw new BadRequestException('본인 MFA 는 초기화할 수 없습니다.');
    const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: auth.organizationId, userId: targetUserId } } });
    if (!m) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: targetUserId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastUsedStep: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: targetUserId } }),
    ]);
    await this.sessions.revokeAllForUser(targetUserId);
    await this.audit.forUser(auth, 'auth.mfa.admin_reset', { entityType: 'user', entityId: targetUserId });
    return { ok: true };
  }
}
