import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Comment, CommentTarget, EntityType } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService } from '../../common/auth/access.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated } from '../../common/dto/pagination.dto';
import { NotifyService } from '../../common/notify/notify.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService, type Need } from '../access/entity-access.service';
import { CommentQueryDto, CreateCommentDto, ResolveCommentDto, UpdateCommentDto } from './comments.dto';

const userSummary = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;
type Meta = { ip?: string; userAgent?: string };

/** 대상 엔터티로 이동하는 관리자 화면 링크 */
export function targetLink(type: CommentTarget, id: string): string {
  switch (type) {
    case 'PAGE': return `/admin/docs/${id}`;
    case 'TASK': return `/admin/my-tasks?task=${id}`;
    case 'PROJECT': return `/admin/projects/${id}`;
    case 'APPROVAL': return `/admin/approvals?id=${id}`;
    case 'DATABASE_ROW': return `/admin/databases?row=${id}`;
  }
}

const TARGET_LABEL: Record<CommentTarget, string> = { PAGE: '문서', TASK: '업무', PROJECT: '프로젝트', APPROVAL: '결재', DATABASE_ROW: '데이터베이스 항목' };

/** 범용 댓글 (문서/업무/프로젝트/결재/DB 항목). 접근 판단은 EntityAccessService 로 위임 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  private writeNeed(type: CommentTarget): Need {
    return type === 'PAGE' ? 'comment' : 'view';
  }

  private async assertTarget(auth: AuthContext, type: CommentTarget, id: string, need: Need) {
    const ok = await this.entityAccess.can(auth, type as EntityType, id, need);
    if (ok) return;
    if (need !== 'view' && (await this.entityAccess.can(auth, type as EntityType, id, 'view'))) {
      throw new ForbiddenException('댓글을 작성할 권한이 없습니다.');
    }
    throw new NotFoundException('대상을 찾을 수 없습니다.');
  }

  private async load(auth: AuthContext, id: string) {
    const c = await this.prisma.comment.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!c) throw new NotFoundException('댓글을 찾을 수 없습니다.');
    return c;
  }

  /** 다른 사용자 관점의 인증 컨텍스트 (멘션 대상의 열람 가능 여부 판단용) */
  private async contextFor(organizationId: string, userId: string): Promise<AuthContext | null> {
    const m = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { role: true, user: true },
    });
    if (!m || m.employmentStatus === 'RESIGNED' || m.user.status !== 'ACTIVE' || m.user.deletedAt) return null;
    const permissions = await this.access.resolvePermissions({ organizationId, userId, roleId: m.roleId, departmentId: m.departmentId });
    return {
      sessionId: '', csrfToken: '', userId, organizationId, membershipId: m.id, email: m.user.email, name: m.user.name,
      roleKey: m.role.key, roleRank: m.role.rank, departmentId: m.departmentId, permissions,
    };
  }

  /** 멘션 대상 검증: 조직 소속 + 대상 열람 가능 */
  private async validateMentions(auth: AuthContext, type: CommentTarget, targetId: string, ids: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(ids ?? [])].filter((id) => id !== auth.userId);
    const denied: string[] = [];
    for (const uid of unique) {
      const ctx = await this.contextFor(auth.organizationId, uid);
      if (!ctx) throw new BadRequestException('조직에 속하지 않은 사용자를 멘션할 수 없습니다.');
      if (!(await this.entityAccess.can(ctx, type as EntityType, targetId, 'view'))) denied.push(ctx.name);
    }
    if (denied.length) throw new BadRequestException(`다음 사용자는 이 ${TARGET_LABEL[type]}을(를) 볼 수 없어 멘션할 수 없습니다: ${denied.join(', ')}`);
    return unique;
  }

  async list(auth: AuthContext, q: CommentQueryDto) {
    await this.assertTarget(auth, q.targetType, q.targetId, 'view');
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = { organizationId: auth.organizationId, targetType: q.targetType, targetId: q.targetId, parentId: null };
    // 삭제된 최상위 댓글은 살아있는 답글이 있을 때만 자리 표시자로 노출
    const threadWhere = { ...where, OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }] };
    const [roots, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where: threadWhere,
        orderBy: { createdAt: q.order === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
        include: { replies: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.comment.count({ where: threadWhere }),
    ]);
    const all = roots.flatMap((r) => [r, ...r.replies]);
    const userIds = new Set<string>();
    for (const c of all) {
      userIds.add(c.authorId);
      c.mentions.forEach((m) => userIds.add(m));
    }
    const users = await this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, ...userSummary });
    const u = new Map(users.map((x) => [x.id, x]));
    const view = (c: Comment) => {
      const deleted = !!c.deletedAt;
      return {
        id: c.id,
        parentId: c.parentId,
        body: deleted ? '' : c.body,
        deleted,
        author: deleted ? null : u.get(c.authorId) ?? null,
        mentions: deleted ? [] : c.mentions.map((m) => u.get(m)).filter(Boolean),
        resolvedAt: c.resolvedAt,
        editedAt: c.editedAt,
        createdAt: c.createdAt,
        canEdit: !deleted && c.authorId === auth.userId,
        canDelete: !deleted && (c.authorId === auth.userId || auth.permissions.has('docs.manage')),
      };
    };
    return paginated(roots.map((r) => ({ ...view(r), replies: r.replies.map(view) })), total, page, pageSize);
  }

  async create(auth: AuthContext, dto: CreateCommentDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('내용을 입력하세요.');
    await this.assertTarget(auth, dto.targetType, dto.targetId, this.writeNeed(dto.targetType));
    let parent: Comment | null = null;
    if (dto.parentId) {
      parent = await this.load(auth, dto.parentId);
      if (parent.targetType !== dto.targetType || parent.targetId !== dto.targetId) throw new BadRequestException('다른 대상의 댓글에는 답글을 달 수 없습니다.');
      // 답글은 1단계만 (답글의 답글은 같은 스레드에 추가)
      if (parent.parentId) parent = await this.load(auth, parent.parentId);
    }
    const mentions = await this.validateMentions(auth, dto.targetType, dto.targetId, dto.mentions);
    const comment = await this.prisma.comment.create({
      data: {
        organizationId: auth.organizationId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        parentId: parent?.id ?? null,
        body,
        mentions,
        authorId: auth.userId,
      },
    });
    await this.sendNotifications(auth, comment, mentions, parent);
    return { ...comment, author: { id: auth.userId, name: auth.name, email: auth.email } };
  }

  private async targetTitle(type: CommentTarget, id: string): Promise<{ title: string; ownerId: string | null }> {
    switch (type) {
      case 'PAGE': {
        const p = await this.prisma.page.findUnique({ where: { id }, select: { title: true, createdById: true } });
        return { title: p?.title || '제목 없음', ownerId: p?.createdById ?? null };
      }
      case 'TASK': {
        const t = await this.prisma.task.findUnique({ where: { id }, select: { title: true } });
        return { title: t?.title ?? '', ownerId: null };
      }
      case 'PROJECT': {
        const p = await this.prisma.project.findUnique({ where: { id }, select: { name: true } });
        return { title: p?.name ?? '', ownerId: null };
      }
      case 'APPROVAL': {
        const a = await this.prisma.approvalRequest.findUnique({ where: { id }, select: { title: true, requesterId: true } });
        return { title: a?.title ?? '', ownerId: a?.requesterId ?? null };
      }
      default:
        return { title: '', ownerId: null };
    }
  }

  private async sendNotifications(auth: AuthContext, comment: Comment, mentions: string[], parent: Comment | null) {
    const { title, ownerId } = await this.targetTitle(comment.targetType, comment.targetId);
    const link = targetLink(comment.targetType, comment.targetId);
    const label = TARGET_LABEL[comment.targetType];
    const preview = comment.body.slice(0, 200);
    if (mentions.length) {
      await this.notify.send({
        organizationId: auth.organizationId,
        userIds: mentions,
        actorId: auth.userId,
        type: 'MENTION',
        title: `${auth.name}님이 ${label} "${title}"에서 회원님을 멘션했습니다`,
        body: preview,
        link,
        entityType: comment.targetType as EntityType,
        entityId: comment.targetId,
      });
    }
    // 문서 작성자/결재 요청자 + 답글 대상 댓글 작성자에게 댓글 알림 (멘션으로 이미 받은 사람 제외)
    const recipients = new Set<string>();
    if (ownerId && (comment.targetType === 'PAGE' || comment.targetType === 'APPROVAL')) recipients.add(ownerId);
    if (parent) recipients.add(parent.authorId);
    for (const m of mentions) recipients.delete(m);
    const targets: string[] = [];
    for (const uid of recipients) {
      if (uid === auth.userId) continue;
      const ctx = await this.contextFor(auth.organizationId, uid);
      if (ctx && (await this.entityAccess.can(ctx, comment.targetType as EntityType, comment.targetId, 'view'))) targets.push(uid);
    }
    if (targets.length) {
      await this.notify.send({
        organizationId: auth.organizationId,
        userIds: targets,
        actorId: auth.userId,
        type: 'COMMENT',
        title: parent ? `${auth.name}님이 댓글에 답글을 남겼습니다: ${title}` : `${auth.name}님이 ${label} "${title}"에 댓글을 남겼습니다`,
        body: preview,
        link,
        entityType: comment.targetType as EntityType,
        entityId: comment.targetId,
      });
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateCommentDto) {
    const c = await this.load(auth, id);
    if (c.authorId !== auth.userId) throw new ForbiddenException('본인이 작성한 댓글만 수정할 수 있습니다.');
    await this.assertTarget(auth, c.targetType, c.targetId, this.writeNeed(c.targetType));
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('내용을 입력하세요.');
    const mentions = dto.mentions ? await this.validateMentions(auth, c.targetType, c.targetId, dto.mentions) : c.mentions;
    const updated = await this.prisma.comment.update({ where: { id }, data: { body, mentions, editedAt: new Date() } });
    const added = mentions.filter((m) => !c.mentions.includes(m));
    if (added.length) {
      const { title } = await this.targetTitle(c.targetType, c.targetId);
      await this.notify.send({
        organizationId: auth.organizationId,
        userIds: added,
        actorId: auth.userId,
        type: 'MENTION',
        title: `${auth.name}님이 ${TARGET_LABEL[c.targetType]} "${title}"에서 회원님을 멘션했습니다`,
        body: body.slice(0, 200),
        link: targetLink(c.targetType, c.targetId),
        entityType: c.targetType as EntityType,
        entityId: c.targetId,
      });
    }
    return updated;
  }

  async remove(auth: AuthContext, id: string, meta: Meta) {
    const c = await this.load(auth, id);
    const isAuthor = c.authorId === auth.userId;
    if (!isAuthor && !auth.permissions.has('docs.manage')) throw new ForbiddenException('댓글을 삭제할 권한이 없습니다.');
    await this.assertTarget(auth, c.targetType, c.targetId, 'view');
    await this.prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    if (!isAuthor) {
      await this.audit.forUser(auth, 'comment.deleted_by_admin', { entityType: 'comment', entityId: id, metadata: { authorId: c.authorId, targetType: c.targetType, targetId: c.targetId }, ...meta });
    }
    return { ok: true };
  }

  async resolve(auth: AuthContext, id: string, dto: ResolveCommentDto) {
    const c = await this.load(auth, id);
    await this.assertTarget(auth, c.targetType, c.targetId, this.writeNeed(c.targetType));
    const resolved = dto.resolved ?? true;
    return this.prisma.comment.update({ where: { id }, data: { resolvedAt: resolved ? new Date() : null } });
  }
}
