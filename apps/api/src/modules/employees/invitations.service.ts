import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { generateToken, sha256 } from '../../common/auth/tokens';
import { PrismaService } from '../../common/prisma/prisma.service';
import { inviteAad, QueueService } from '../../common/queue/queue.service';
import { seal } from '../../common/crypto/secret-box';
import { loadConfig } from '../../config/configuration';
import { CreateInvitationDto, InvitationQueryDto } from './employees.dto';
import { assertCanAssignRole } from './role-rules';

export const INVITATION_TTL_DAYS = 7;

/**
 * 직원 초대. 토큰 원문은 생성 시 1회만 응답(inviteUrl)으로 반환하고 DB 에는 SHA-256 해시만 저장한다.
 * SMTP 가 활성화된 경우에만 워커가 초대 메일을 발송한다.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  private inviteUrl(token: string) {
    return `/admin/accept-invite?token=${encodeURIComponent(token)}`;
  }

  private async enqueueEmail(invitationId: string, token: string): Promise<boolean> {
    if (!loadConfig().smtp.enabled) return false;
    try {
      // Redis 에는 토큰 원문을 두지 않는다: AES-256-GCM 암호문(초대 ID 를 AAD 로 바인딩)만 저장, 완료/실패 시 즉시 제거
      await this.queue.notifications.add(
        'invitation-email',
        { kind: 'invitation-email', invitationId, sealedToken: seal(token, inviteAad(invitationId)) },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: true },
      );
      return true;
    } catch (e) {
      this.logger.warn(`초대 메일 큐잉 실패: ${(e as Error).message}`);
      return false;
    }
  }

  async list(auth: AuthContext, q: InvitationQueryDto) {
    const now = new Date();
    const rows = await this.prisma.invitation.findMany({
      where: {
        organizationId: auth.organizationId,
        ...(q.status === 'all' ? {} : { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }),
      },
      include: { role: { select: { id: true, key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
    const inviterIds = [...new Set(rows.map((r) => r.invitedById))];
    const [depts, inviters] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } }),
    ]);
    const dMap = new Map(depts.map((d) => [d.id, d]));
    const uMap = new Map(inviters.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      title: r.title,
      role: r.role,
      department: r.departmentId ? dMap.get(r.departmentId) ?? null : null,
      invitedBy: uMap.get(r.invitedById) ?? null,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      status: r.acceptedAt ? 'ACCEPTED' : r.revokedAt ? 'REVOKED' : r.expiresAt <= now ? 'EXPIRED' : 'PENDING',
    }));
  }

  async create(auth: AuthContext, dto: CreateInvitationDto) {
    const role = await this.prisma.role.findFirst({ where: { id: dto.roleId, organizationId: auth.organizationId } });
    if (!role) throw new BadRequestException('역할을 찾을 수 없습니다.');
    assertCanAssignRole(auth, role);
    if (dto.departmentId) {
      const ok = await this.prisma.department.count({ where: { id: dto.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, status: true, memberships: { select: { organizationId: true } } },
    });
    if (existing && existing.status !== 'INVITED') {
      throw new ConflictException('이미 계정이 있는 이메일입니다. 비활성 계정은 직원 화면에서 재활성화하세요.');
    }
    if (existing && existing.memberships.some((m) => m.organizationId !== auth.organizationId)) {
      throw new ConflictException('다른 조직에 속한 이메일입니다.');
    }
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000);
    const inv = await this.prisma.$transaction(async (tx) => {
      // 같은 이메일의 기존 대기 초대는 무효화 (토큰 1개만 유효)
      await tx.invitation.updateMany({
        where: { organizationId: auth.organizationId, email: dto.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId: auth.organizationId,
          email: dto.email,
          name: dto.name,
          roleId: role.id,
          departmentId: dto.departmentId,
          title: dto.title,
          tokenHash: sha256(token),
          invitedById: auth.userId,
          expiresAt,
        },
      });
      await this.audit.forUser(auth, 'employee.invited', { entityType: 'invitation', entityId: created.id, metadata: { email: dto.email, role: role.key } }, tx);
      return created;
    });
    const emailQueued = await this.enqueueEmail(inv.id, token);
    return { id: inv.id, email: inv.email, expiresAt, inviteUrl: this.inviteUrl(token), emailQueued };
  }

  private async requirePending(auth: AuthContext, id: string) {
    const inv = await this.prisma.invitation.findFirst({ where: { id, organizationId: auth.organizationId }, include: { role: true } });
    if (!inv) throw new NotFoundException('초대를 찾을 수 없습니다.');
    if (inv.acceptedAt) throw new BadRequestException('이미 수락된 초대입니다.');
    return inv;
  }

  async revoke(auth: AuthContext, id: string) {
    const inv = await this.requirePending(auth, id);
    assertCanAssignRole(auth, inv.role);
    await this.prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.forUser(auth, 'employee.invitation.revoked', { entityType: 'invitation', entityId: id, metadata: { email: inv.email } });
    return { ok: true };
  }

  /** 재발송: 새 토큰과 만료일을 발급한다 (기존 링크는 즉시 무효) */
  async resend(auth: AuthContext, id: string) {
    const inv = await this.requirePending(auth, id);
    assertCanAssignRole(auth, inv.role);
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86400_000);
    await this.prisma.invitation.update({ where: { id }, data: { tokenHash: sha256(token), expiresAt, revokedAt: null } });
    await this.audit.forUser(auth, 'employee.invitation.resent', { entityType: 'invitation', entityId: id, metadata: { email: inv.email } });
    const emailQueued = await this.enqueueEmail(id, token);
    return { id, email: inv.email, expiresAt, inviteUrl: this.inviteUrl(token), emailQueued };
  }
}
