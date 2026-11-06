import { BadRequestException, ConflictException, ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { ActivityService } from '../../common/activity/activity.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { extractText, sanitizeDoc } from '../../common/utils/tiptap';
import { DocumentAccessService, LEVEL_RANK, type PageLite } from './document-access.service';
import {
  CreateDocumentDto, DocumentQueryDto, DuplicateDocumentDto, MoveDocumentDto, SaveContentDto, TreeQueryDto, UpdateDocumentDto,
} from './dto/document.dto';
import { replaceYContent } from './ydoc';

export const userSummary = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;
/** 자동 스냅샷 최소 간격 */
export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60_000;
/** 문서 JSON 최대 크기 (바이트) */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const POSITION_STEP = 1024;
const MAX_DUPLICATE = 300;

/** 응답에서 yState(바이너리)를 제외한 문서 필드 */
const PAGE_PUBLIC_SELECT = {
  id: true, organizationId: true, workspaceId: true, parentId: true, title: true, icon: true, coverUrl: true, content: true,
  position: true, isTemplate: true, visibility: true, version: true, createdById: true, updatedById: true,
  createdAt: true, updatedAt: true, deletedAt: true,
} as const;

export interface TreeNode {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  position: number;
  visibility: string;
  access: string;
  updatedAt: Date;
  children: TreeNode[];
}

const byPosition = (a: { position: number; createdAt: Date }, b: { position: number; createdAt: Date }) =>
  a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docAccess: DocumentAccessService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
  ) {}

  private normalizeContent(content: unknown) {
    const size = Buffer.byteLength(JSON.stringify(content ?? null));
    if (size > MAX_CONTENT_BYTES) throw new PayloadTooLargeException('문서가 너무 큽니다. 내용을 나누어 저장하세요.');
    const obj = content as { type?: unknown; content?: unknown } | null;
    if (!obj || obj.type !== 'doc' || (obj.content !== undefined && !Array.isArray(obj.content))) {
      throw new BadRequestException('올바른 문서 형식이 아닙니다.');
    }
    const clean = sanitizeDoc(obj) as Prisma.InputJsonObject;
    return { content: clean, contentText: extractText(clean) };
  }

  private async nextPosition(organizationId: string, workspaceId: string, parentId: string | null, tx: Prisma.TransactionClient = this.prisma) {
    const last = await tx.page.aggregate({
      where: { organizationId, workspaceId, parentId, deletedAt: null },
      _max: { position: true },
    });
    return (last._max.position ?? 0) + POSITION_STEP;
  }

  // ───────────────────────── 생성 / 조회 / 수정 ─────────────────────────

  async create(auth: AuthContext, dto: CreateDocumentDto) {
    let workspaceId = dto.workspaceId;
    if (dto.parentId) {
      const { page: parent } = await this.docAccess.require(auth, dto.parentId, 'edit');
      if (workspaceId && workspaceId !== parent.workspaceId) throw new BadRequestException('상위 문서와 다른 워크스페이스입니다.');
      workspaceId = parent.workspaceId;
    }
    const ws = await this.docAccess.requireWorkspace(auth, workspaceId, true);

    let content: Prisma.InputJsonObject | undefined;
    let contentText = '';
    let title = dto.title?.trim() ?? '';
    let icon = dto.icon ?? null;
    if (dto.templateId) {
      const { page: tpl } = await this.docAccess.require(auth, dto.templateId, 'view');
      if (!tpl.isTemplate) throw new BadRequestException('템플릿 문서가 아닙니다.');
      if (tpl.content) ({ content, contentText } = this.normalizeContent(tpl.content));
      if (!title) title = tpl.title;
      if (!icon) icon = tpl.icon;
    }

    return this.prisma.$transaction(async (tx) => {
      const position = await this.nextPosition(auth.organizationId, ws.id, dto.parentId ?? null, tx);
      const page = await tx.page.create({
        data: {
          organizationId: auth.organizationId,
          workspaceId: ws.id,
          parentId: dto.parentId ?? null,
          title: title.slice(0, 300),
          icon,
          content: content ?? { type: 'doc', content: [] },
          contentText,
          position,
          isTemplate: dto.isTemplate ?? false,
          visibility: dto.visibility ?? 'WORKSPACE',
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        select: PAGE_PUBLIC_SELECT,
      });
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: page.id, action: 'page.created', actorId: auth.userId, changes: { title: page.title, templateId: dto.templateId } }, tx);
      return { ...page, access: 'FULL' as const };
    });
  }

  async get(auth: AuthContext, id: string) {
    const { level } = await this.docAccess.require(auth, id, 'view');
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id }, select: { ...PAGE_PUBLIC_SELECT, yState: false } });
    const userIds = [page.createdById, page.updatedById].filter(Boolean) as string[];
    const [users, workspace, breadcrumbs, childCount] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, ...userSummary }),
      this.prisma.workspace.findUnique({ where: { id: page.workspaceId }, select: { id: true, name: true, icon: true } }),
      this.breadcrumbs(auth, page.parentId),
      this.prisma.page.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const hasYState = (await this.prisma.page.count({ where: { id, yState: { not: null } } })) > 0;
    return {
      ...page,
      access: level,
      createdBy: u.get(page.createdById) ?? null,
      updatedBy: page.updatedById ? u.get(page.updatedById) ?? null : null,
      workspace,
      breadcrumbs,
      childCount,
      hasYState,
    };
  }

  /** 상위 문서 경로 (접근 가능한 문서만 제목 노출) */
  private async breadcrumbs(auth: AuthContext, parentId: string | null) {
    const out: { id: string; title: string; icon: string | null }[] = [];
    let cur = parentId;
    for (let i = 0; cur && i < 10; i++) {
      const p = await this.prisma.page.findFirst({ where: { id: cur, organizationId: auth.organizationId, deletedAt: null } });
      if (!p) break;
      const lvl = await this.docAccess.level(auth, p);
      out.unshift(lvl ? { id: p.id, title: p.title, icon: p.icon } : { id: p.id, title: '(접근 제한)', icon: null });
      cur = p.parentId;
    }
    return out;
  }

  async update(auth: AuthContext, id: string, dto: UpdateDocumentDto) {
    const { page } = await this.docAccess.require(auth, id, 'edit');
    if (dto.coverUrl && !/^(https?:|\/)/i.test(dto.coverUrl)) throw new BadRequestException('허용되지 않는 커버 이미지 주소입니다.');
    const data: Prisma.PageUncheckedUpdateInput = {
      title: dto.title?.slice(0, 300),
      icon: dto.icon,
      coverUrl: dto.coverUrl,
      isTemplate: dto.isTemplate,
      updatedById: auth.userId,
    };
    const changes = ActivityService.diff(page as unknown as Record<string, unknown>, { title: data.title, icon: data.icon, coverUrl: data.coverUrl, isTemplate: data.isTemplate });
    const updated = await this.prisma.page.update({ where: { id }, data, select: PAGE_PUBLIC_SELECT });
    if (Object.keys(changes).length) {
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: id, action: 'page.updated', actorId: auth.userId, changes });
    }
    return updated;
  }

  /**
   * 본문 자동 저장 (낙관적 동시성 제어).
   * baseVersion 이 현재 버전과 다르면 409. 성공 시 version+1, 10분 간격으로 AUTO 스냅샷 생성.
   * 실시간 공동 편집 상태(yState)가 있으면 CRDT 호환 방식으로 함께 갱신한다.
   */
  async saveContent(auth: AuthContext, id: string, dto: SaveContentDto) {
    const { page } = await this.docAccess.require(auth, id, 'edit');
    const { content, contentText } = this.normalizeContent(dto.content);
    if (page.version !== dto.baseVersion) {
      throw new ConflictException({ statusCode: 409, message: '다른 사용자가 먼저 문서를 수정했습니다. 최신 내용을 불러온 뒤 다시 편집하세요.', currentVersion: page.version });
    }
    return this.prisma.$transaction(async (tx) => {
      const yState = page.yState ? replaceYContent(page.yState, content) : undefined;
      const res = await tx.page.updateMany({
        where: { id, version: dto.baseVersion, deletedAt: null },
        data: { content, contentText, version: { increment: 1 }, updatedById: auth.userId, ...(yState ? { yState } : {}) },
      });
      if (res.count === 0) {
        const cur = await tx.page.findUnique({ where: { id }, select: { version: true } });
        throw new ConflictException({ statusCode: 409, message: '다른 사용자가 먼저 문서를 수정했습니다. 최신 내용을 불러온 뒤 다시 편집하세요.', currentVersion: cur?.version });
      }
      const version = dto.baseVersion + 1;
      const last = await tx.pageSnapshot.findFirst({ where: { pageId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      let snapshot = false;
      if (!last || Date.now() - last.createdAt.getTime() >= AUTO_SNAPSHOT_INTERVAL_MS) {
        await tx.pageSnapshot.create({ data: { pageId: id, version, title: page.title, content, reason: 'AUTO', createdById: auth.userId } });
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: id, action: 'page.edited', actorId: auth.userId, changes: { version } }, tx);
        snapshot = true;
      }
      const updatedAt = (await tx.page.findUnique({ where: { id }, select: { updatedAt: true } }))!.updatedAt;
      return { version, updatedAt, snapshot };
    });
  }

  // ───────────────────────── 트리 / 이동 ─────────────────────────

  async tree(auth: AuthContext, q: TreeQueryDto) {
    const ws = await this.docAccess.requireWorkspace(auth, q.workspaceId, false);
    const { pages, level } = await this.docAccess.accessMap(auth, { workspaceId: ws.id });
    const visible = [...pages.values()].filter((p) => !p.deletedAt && !p.isTemplate && level(p.id));
    const nodes = new Map<string, TreeNode & { createdAt: Date }>();
    for (const p of visible.sort(byPosition)) {
      nodes.set(p.id, {
        id: p.id, title: p.title, icon: p.icon, parentId: p.parentId, position: p.position, visibility: p.visibility,
        access: level(p.id)!, updatedAt: p.updatedAt, createdAt: p.createdAt, children: [],
      });
    }
    const roots: TreeNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentId ? nodes.get(n.parentId) : undefined;
      // 상위 문서에 접근할 수 없으면 최상위로 노출
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return { workspace: { id: ws.id, name: ws.name, icon: ws.icon }, items: roots };
  }

  async move(auth: AuthContext, id: string, dto: MoveDocumentDto) {
    const { page } = await this.docAccess.require(auth, id, 'edit');
    const parentId = dto.parentId === undefined ? page.parentId : dto.parentId;
    if (parentId) {
      if (parentId === id) throw new BadRequestException('문서를 자기 자신 아래로 이동할 수 없습니다.');
      const { page: parent } = await this.docAccess.require(auth, parentId, 'edit');
      if (parent.workspaceId !== page.workspaceId) throw new BadRequestException('다른 워크스페이스로는 이동할 수 없습니다.');
      // 순환 방지: 새 상위 문서의 조상 중 자신이 있으면 거부
      let cur: string | null = parent.parentId;
      for (let i = 0; cur && i < 100; i++) {
        if (cur === id) throw new BadRequestException('하위 문서 아래로 이동할 수 없습니다.');
        const p: { parentId: string | null } | null = await this.prisma.page.findUnique({ where: { id: cur }, select: { parentId: true } });
        cur = p?.parentId ?? null;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const siblings = await tx.page.findMany({
        where: { organizationId: auth.organizationId, workspaceId: page.workspaceId, parentId, deletedAt: null, id: { not: id } },
        select: { id: true, position: true, createdAt: true },
      });
      siblings.sort(byPosition);
      let position: number;
      const anchorId = dto.beforeId ?? dto.afterId;
      if (anchorId) {
        const idx = siblings.findIndex((s) => s.id === anchorId);
        if (idx < 0) throw new BadRequestException('기준 문서가 같은 위치에 없습니다.');
        const insertAt = dto.beforeId ? idx : idx + 1;
        const prev = siblings[insertAt - 1]?.position;
        const next = siblings[insertAt]?.position;
        position = prev === undefined && next === undefined ? POSITION_STEP
          : prev === undefined ? next! - POSITION_STEP
          : next === undefined ? prev + POSITION_STEP
          : (prev + next) / 2;
        // 분수 위치 정밀도 고갈 시 형제 순서 재정렬
        if (prev !== undefined && next !== undefined && Math.abs(next - prev) < 1e-6) {
          const ordered = [...siblings.slice(0, insertAt).map((s) => s.id), id, ...siblings.slice(insertAt).map((s) => s.id)];
          for (const [i, sid] of ordered.entries()) await tx.page.update({ where: { id: sid }, data: { position: (i + 1) * POSITION_STEP } });
          position = (insertAt + 1) * POSITION_STEP;
        }
      } else if (dto.position !== undefined) {
        position = dto.position;
      } else {
        position = (siblings.at(-1)?.position ?? 0) + POSITION_STEP;
      }
      const updated = await tx.page.update({ where: { id }, data: { parentId, position }, select: { id: true, parentId: true, position: true } });
      if (parentId !== page.parentId) {
        await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: id, action: 'page.moved', actorId: auth.userId, changes: { parentId: { from: page.parentId, to: parentId } } }, tx);
      }
      return updated;
    });
  }

  // ───────────────────────── 검색 / 템플릿 ─────────────────────────

  async search(auth: AuthContext, q: DocumentQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const ws = q.workspaceId ? await this.docAccess.requireWorkspace(auth, q.workspaceId, false) : null;
    const { pages, level } = await this.docAccess.accessMap(auth, ws ? { workspaceId: ws.id } : {});
    const ids = [...pages.values()].filter((p) => !p.deletedAt && level(p.id)).map((p) => p.id);
    const term = q.q?.trim();
    const where: Prisma.PageWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      id: { in: ids },
      ...(q.templates === 'true' ? { isTemplate: true } : q.templates === 'false' ? { isTemplate: false } : {}),
      ...(q.parentId ? { parentId: q.parentId } : {}),
      ...(term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { contentText: { contains: term, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.page.findMany({
        where,
        skip,
        take,
        orderBy: orderByArg(q, ['updatedAt', 'createdAt', 'title'] as const, 'updatedAt'),
        select: { id: true, title: true, icon: true, parentId: true, workspaceId: true, isTemplate: true, visibility: true, updatedAt: true, createdAt: true, contentText: true, updatedById: true },
      }),
      this.prisma.page.count({ where }),
    ]);
    const editors = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.updatedById).filter(Boolean) as string[] } }, ...userSummary });
    const byId = new Map(editors.map((e) => [e.id, e]));
    const items = rows.map(({ contentText, updatedById, ...r }) => ({
      ...r,
      access: level(r.id),
      updatedBy: updatedById ? byId.get(updatedById) ?? null : null,
      snippet: snippet(contentText, term),
      path: pathOf(pages, r.parentId, level),
    }));
    return paginated(items, total, page, pageSize);
  }

  templates(auth: AuthContext, q: DocumentQueryDto) {
    return this.search(auth, Object.assign(new DocumentQueryDto(), q, { templates: 'true' as const }));
  }

  // ───────────────────────── 복제 ─────────────────────────

  async duplicate(auth: AuthContext, id: string, dto: DuplicateDocumentDto) {
    const { page: src } = await this.docAccess.require(auth, id, 'view');
    if (src.parentId) await this.docAccess.require(auth, src.parentId, 'edit');
    else await this.docAccess.requireWorkspace(auth, src.workspaceId, true);
    const { pages, level } = await this.docAccess.accessMap(auth, { workspaceId: src.workspaceId });
    const childIds = dto.includeChildren ? DocumentAccessService.descendants(pages, id, (p) => !p.deletedAt && !!level(p.id)) : [];
    if (childIds.length + 1 > MAX_DUPLICATE) throw new BadRequestException(`한 번에 최대 ${MAX_DUPLICATE}개 문서까지 복제할 수 있습니다.`);
    const full = await this.prisma.page.findMany({
      where: { id: { in: [id, ...childIds] } },
      select: { id: true, parentId: true, title: true, icon: true, coverUrl: true, content: true, contentText: true, position: true, visibility: true, isTemplate: true },
    });
    const byId = new Map(full.map((p) => [p.id, p]));
    return this.prisma.$transaction(async (tx) => {
      const mapping = new Map<string, string>();
      // 원본 바로 뒤에 위치
      const nextSibling = await tx.page.findFirst({
        where: { organizationId: auth.organizationId, workspaceId: src.workspaceId, parentId: src.parentId, deletedAt: null, position: { gt: src.position } },
        orderBy: { position: 'asc' },
        select: { position: true },
      });
      const rootPos = nextSibling ? (src.position + nextSibling.position) / 2 : src.position + POSITION_STEP;
      for (const pid of [id, ...childIds]) {
        const p = byId.get(pid)!;
        const isRoot = pid === id;
        const created = await tx.page.create({
          data: {
            organizationId: auth.organizationId,
            workspaceId: src.workspaceId,
            parentId: isRoot ? src.parentId : mapping.get(p.parentId!) ?? null,
            title: isRoot ? `${p.title || '제목 없음'} (사본)`.slice(0, 300) : p.title,
            icon: p.icon,
            coverUrl: p.coverUrl,
            content: (p.content ?? undefined) as Prisma.InputJsonValue | undefined,
            contentText: p.contentText,
            position: isRoot ? rootPos : p.position,
            visibility: p.visibility,
            isTemplate: isRoot ? false : p.isTemplate,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          select: { id: true },
        });
        mapping.set(pid, created.id);
      }
      const newId = mapping.get(id)!;
      await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: newId, action: 'page.duplicated', actorId: auth.userId, changes: { sourceId: id, count: mapping.size } }, tx);
      return { id: newId, count: mapping.size };
    });
  }

  // ───────────────────────── 휴지통 ─────────────────────────

  /** 휴지통으로 이동 (하위 문서 포함, 동일 deletedAt 으로 묶어 함께 복원 가능) */
  async remove(auth: AuthContext, id: string, meta: { ip?: string; userAgent?: string }) {
    const { page } = await this.docAccess.require(auth, id, 'edit');
    const { pages } = await this.docAccess.accessMap(auth, { workspaceId: page.workspaceId });
    const ids = [id, ...DocumentAccessService.descendants(pages, id, (p) => !p.deletedAt)];
    const now = new Date();
    await this.prisma.page.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now, deletedById: auth.userId } });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: id, action: 'page.deleted', actorId: auth.userId, changes: { count: ids.length } });
    await this.audit.forUser(auth, 'page.deleted', { entityType: 'page', entityId: id, metadata: { title: page.title, descendants: ids.length - 1 }, ...meta });
    return { ok: true, count: ids.length };
  }

  async trash(auth: AuthContext, q: PaginationQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const { pages, level } = await this.docAccess.accessMap(auth);
    const term = q.q?.trim().toLowerCase();
    // 삭제 단위의 최상위 문서만 표시 (같이 삭제된 하위 문서는 복원 시 함께 복원)
    const roots = [...pages.values()].filter((p) => {
      if (!p.deletedAt) return false;
      const lvl = level(p.id);
      if (!lvl || LEVEL_RANK[lvl] < LEVEL_RANK.EDIT) return false;
      const parent = p.parentId ? pages.get(p.parentId) : undefined;
      if (parent?.deletedAt && parent.deletedAt.getTime() === p.deletedAt.getTime()) return false;
      return !term || p.title.toLowerCase().includes(term);
    });
    roots.sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime());
    const slice = roots.slice(skip, skip + take);
    const users = await this.prisma.user.findMany({ where: { id: { in: slice.map((p) => p.deletedById).filter(Boolean) as string[] } }, ...userSummary });
    const u = new Map(users.map((x) => [x.id, x]));
    const items = slice.map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      deletedAt: p.deletedAt,
      deletedBy: p.deletedById ? u.get(p.deletedById) ?? null : null,
      descendants: DocumentAccessService.descendants(pages, p.id, (c) => c.deletedAt?.getTime() === p.deletedAt!.getTime()).length,
      canPurge: auth.permissions.has('docs.manage') || p.createdById === auth.userId,
    }));
    return paginated(items, roots.length, page, pageSize);
  }

  async restore(auth: AuthContext, id: string, meta: { ip?: string; userAgent?: string }) {
    const { page } = await this.docAccess.require(auth, id, 'edit', { deleted: true });
    const { pages } = await this.docAccess.accessMap(auth, { workspaceId: page.workspaceId });
    const stamp = page.deletedAt!.getTime();
    const ids = [id, ...DocumentAccessService.descendants(pages, id, (p) => p.deletedAt?.getTime() === stamp)];
    const parent = page.parentId ? pages.get(page.parentId) : undefined;
    const detach = !!page.parentId && (!parent || !!parent.deletedAt);
    await this.prisma.$transaction(async (tx) => {
      await tx.page.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null, deletedById: null } });
      if (detach) {
        const position = await this.nextPosition(auth.organizationId, page.workspaceId, null, tx);
        await tx.page.update({ where: { id }, data: { parentId: null, position } });
      }
    });
    await this.activity.record({ organizationId: auth.organizationId, entityType: EntityType.PAGE, entityId: id, action: 'page.restored', actorId: auth.userId, changes: { count: ids.length } });
    await this.audit.forUser(auth, 'page.restored', { entityType: 'page', entityId: id, metadata: { count: ids.length }, ...meta });
    return { ok: true, count: ids.length, movedToRoot: detach };
  }

  /** 영구 삭제: 휴지통에 있는 문서만, 작성자 또는 docs.manage */
  async purge(auth: AuthContext, id: string, meta: { ip?: string; userAgent?: string }) {
    const { page } = await this.docAccess.require(auth, id, 'view', { deleted: true });
    if (page.createdById !== auth.userId && !auth.permissions.has('docs.manage')) {
      throw new ForbiddenException('작성자 또는 문서 관리자만 영구 삭제할 수 있습니다.');
    }
    const { pages } = await this.docAccess.accessMap(auth, { workspaceId: page.workspaceId });
    const ids = [id, ...DocumentAccessService.descendants(pages, id, (p) => !!p.deletedAt)];
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { organizationId: auth.organizationId, targetType: 'PAGE', targetId: { in: ids } } });
      await tx.resourceGrant.deleteMany({ where: { organizationId: auth.organizationId, resourceType: 'PAGE', resourceId: { in: ids } } });
      await tx.entityLink.deleteMany({ where: { OR: [{ sourceType: 'PAGE', sourceId: { in: ids } }, { targetType: 'PAGE', targetId: { in: ids } }] } });
      await tx.page.deleteMany({ where: { id: { in: ids }, organizationId: auth.organizationId } });
    });
    await this.audit.forUser(auth, 'page.purged', { entityType: 'page', entityId: id, metadata: { title: page.title, count: ids.length }, ...meta });
    return { ok: true, count: ids.length };
  }
}

function snippet(text: string, term?: string, radius = 60): string {
  if (!text) return '';
  if (!term) return text.slice(0, radius * 2).replace(/\s+/g, ' ');
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2).replace(/\s+/g, ' ');
  const start = Math.max(0, i - radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, i + term.length + radius).replace(/\s+/g, ' ')}${i + term.length + radius < text.length ? '…' : ''}`;
}

function pathOf(pages: Map<string, PageLite>, parentId: string | null, level: (id: string) => unknown): string[] {
  const out: string[] = [];
  let cur = parentId;
  for (let i = 0; cur && i < 10; i++) {
    const p = pages.get(cur);
    if (!p || p.deletedAt) break;
    out.unshift(level(p.id) ? p.title || '제목 없음' : '…');
    cur = p.parentId;
  }
  return out;
}

