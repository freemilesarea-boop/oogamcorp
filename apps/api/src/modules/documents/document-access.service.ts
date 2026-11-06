import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, Page, PageVisibility } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';

export type PageNeed = 'view' | 'comment' | 'edit' | 'full';
export const LEVEL_RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };
const NEED_RANK: Record<PageNeed, number> = { view: 1, comment: 2, edit: 3, full: 4 };

export interface PageLite {
  id: string;
  organizationId: string;
  workspaceId: string;
  parentId: string | null;
  createdById: string;
  visibility: PageVisibility;
  title: string;
  icon: string | null;
  position: number;
  isTemplate: boolean;
  deletedAt: Date | null;
  deletedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export const PAGE_LITE_SELECT = {
  id: true, organizationId: true, workspaceId: true, parentId: true, createdById: true, visibility: true,
  title: true, icon: true, position: true, isTemplate: true, deletedAt: true, deletedById: true, updatedAt: true, createdAt: true,
} as const;

export interface AccessMap {
  pages: Map<string, PageLite>;
  level: (id: string) => AccessLevel | null;
}

/**
 * 문서 접근 제어.
 * - 단건 판단은 EntityAccessService.pageLevel(정식 규칙)을 그대로 사용한다.
 * - 트리/검색/휴지통처럼 다건 판단이 필요한 경우 N+1 쿼리를 피하기 위해 동일 규칙을 메모리에서 일괄 계산한다
 *   (accessMap). 규칙을 변경할 때는 pageLevel 과 함께 변경해야 한다.
 */
@Injectable()
export class DocumentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
  ) {}

  /** 문서 로드 + 접근 수준 확인. 접근 불가 시 존재 여부를 노출하지 않도록 404 */
  async require(auth: AuthContext, id: string, need: PageNeed, opts: { deleted?: boolean } = {}): Promise<{ page: Page; level: AccessLevel }> {
    const page = await this.prisma.page.findFirst({
      where: { id, organizationId: auth.organizationId, deletedAt: opts.deleted ? { not: null } : null },
    });
    if (!page) throw new NotFoundException('문서를 찾을 수 없습니다.');
    const level = await this.entityAccess.pageLevel(auth, page);
    if (!level) throw new NotFoundException('문서를 찾을 수 없습니다.');
    if (LEVEL_RANK[level] < NEED_RANK[need]) {
      throw new ForbiddenException(need === 'full' ? '이 문서의 권한을 관리할 수 없습니다.' : '이 문서에 대한 권한이 부족합니다.');
    }
    return { page, level };
  }

  /** 단건 접근 수준 (정식 규칙) */
  level(auth: AuthContext, page: Pick<Page, 'id' | 'organizationId' | 'workspaceId' | 'createdById' | 'visibility' | 'parentId'>) {
    return this.entityAccess.pageLevel(auth, page);
  }

  /** 워크스페이스 접근 (문서 생성 위치 확인). 반환: 워크스페이스 */
  async requireWorkspace(auth: AuthContext, workspaceId: string | undefined, write: boolean) {
    const ws = workspaceId
      ? await this.prisma.workspace.findFirst({ where: { id: workspaceId, organizationId: auth.organizationId } })
      : await this.prisma.workspace.findFirst({ where: { organizationId: auth.organizationId, isDefault: true } });
    if (!ws) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    if (auth.permissions.has('docs.manage')) return ws;
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: auth.userId } } });
    if (!member) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    if (write && member.role === 'VIEWER') throw new ForbiddenException('이 워크스페이스에 문서를 만들 권한이 없습니다.');
    return ws;
  }

  /** 조직 내 모든 문서(삭제 포함)의 접근 수준을 일괄 계산 */
  async accessMap(auth: AuthContext, filter: { workspaceId?: string } = {}): Promise<AccessMap> {
    const now = new Date();
    const [rows, grants, memberships] = await Promise.all([
      this.prisma.page.findMany({
        where: { organizationId: auth.organizationId, ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}) },
        select: PAGE_LITE_SELECT,
      }),
      this.prisma.resourceGrant.findMany({
        where: {
          organizationId: auth.organizationId,
          resourceType: 'PAGE',
          OR: [{ userId: auth.userId }, ...(auth.departmentId ? [{ departmentId: auth.departmentId }] : [])],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        select: { resourceId: true, access: true },
      }),
      this.prisma.workspaceMember.findMany({ where: { userId: auth.userId, workspace: { organizationId: auth.organizationId } }, select: { workspaceId: true, role: true } }),
    ]);
    const pages = new Map(rows.map((p) => [p.id, p as PageLite]));
    const grantBy = new Map<string, AccessLevel>();
    for (const g of grants) {
      const prev = grantBy.get(g.resourceId);
      if (!prev || LEVEL_RANK[g.access] > LEVEL_RANK[prev]) grantBy.set(g.resourceId, g.access);
    }
    const memberBy = new Map(memberships.map((m) => [m.workspaceId, m.role]));
    const memo = new Map<string, AccessLevel | null>();
    const canRead = auth.permissions.has('docs.read');
    const isManager = auth.permissions.has('docs.manage');
    const canWrite = auth.permissions.has('docs.write');

    // pageLevel 과 동일한 규칙 (상위 문서 제한 상속은 최대 깊이 10)
    const compute = (p: PageLite, depth: number): AccessLevel | null => {
      if (!canRead) return null;
      if (isManager || p.createdById === auth.userId) return 'FULL';
      let level: AccessLevel | null = grantBy.get(p.id) ?? null;
      if (p.visibility === 'WORKSPACE') {
        const role = memberBy.get(p.workspaceId);
        if (role && role !== 'VIEWER') {
          const base: AccessLevel = canWrite ? 'EDIT' : 'VIEW';
          if (!level || LEVEL_RANK[base] > LEVEL_RANK[level]) level = base;
        } else if (role) {
          if (!level) level = 'VIEW';
        }
      }
      if (!level) return null;
      if (p.parentId && depth < 10) {
        const parent = pages.get(p.parentId);
        if (parent && parent.visibility !== 'WORKSPACE') {
          const pl = compute(parent, depth + 1);
          if (!pl) return null;
          if (LEVEL_RANK[pl] < LEVEL_RANK[level]) level = pl;
        }
      }
      return level;
    };
    const get = (id: string): AccessLevel | null => {
      if (memo.has(id)) return memo.get(id)!;
      const p = pages.get(id);
      const lvl = p ? compute(p, 0) : null;
      memo.set(id, lvl);
      return lvl;
    };
    return { pages, level: get };
  }

  /** 하위 문서 ID 목록 (자신 제외, BFS). predicate 로 필터 */
  static descendants(pages: Map<string, PageLite>, rootId: string, predicate: (p: PageLite) => boolean = () => true): string[] {
    const children = new Map<string, PageLite[]>();
    for (const p of pages.values()) {
      if (!p.parentId) continue;
      const arr = children.get(p.parentId) ?? [];
      arr.push(p);
      children.set(p.parentId, arr);
    }
    const out: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>([rootId]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of children.get(cur) ?? []) {
        if (seen.has(c.id) || !predicate(c)) continue;
        seen.add(c.id);
        out.push(c.id);
        queue.push(c.id);
      }
    }
    return out;
  }

  /** 사용자/부서가 조직 소속인지 확인 */
  async assertOrgPrincipal(auth: AuthContext, ref: { userId?: string; departmentId?: string }) {
    if (ref.userId) {
      const ok = await this.prisma.membership.count({ where: { organizationId: auth.organizationId, userId: ref.userId } });
      if (!ok) throw new BadRequestException('조직에 속하지 않은 사용자입니다.');
    }
    if (ref.departmentId) {
      const ok = await this.prisma.department.count({ where: { id: ref.departmentId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('부서를 찾을 수 없습니다.');
    }
  }
}
