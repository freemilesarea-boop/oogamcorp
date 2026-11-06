import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityAccessService } from '../access/entity-access.service';
import { grantedIds, projectVisibleWhere, taskVisibleWhere } from './visibility';

export const SEARCH_TYPES = ['pages', 'projects', 'tasks', 'databases', 'rows', 'employees', 'announcements'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
const LABELS: Record<SearchType, string> = {
  pages: '문서', projects: '프로젝트', tasks: '업무', databases: '데이터베이스', rows: '데이터베이스 항목', employees: '직원', announcements: '공지',
};

export interface SearchHit { type: SearchType; id: string; title: string; snippet: string | null; href: string; meta?: string | null; updatedAt?: Date | null }

/** 일치 위치 주변 문맥 발췌 */
export function snippet(text: string | null | undefined, q: string, radius = 60): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat || null;
  const start = Math.max(0, i - radius);
  const end = Math.min(flat.length, i + q.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * 권한 인지 통합 검색 (Postgres ILIKE).
 * - 각 유형별로 열람 조건을 WHERE 에 포함해 후보를 조회하고, 문서(Page)는 상위 문서 제한 상속까지
 *   EntityAccessService.pageLevel() 로 재검증한다 (제한/비공개 문서 누출 방지).
 * - 확장: 데이터가 커지면 pg_trgm GIN 인덱스(title, contentText) 추가 후 similarity 정렬로 교체.
 *   (CREATE EXTENSION pg_trgm; CREATE INDEX ... USING gin ("contentText" gin_trgm_ops))
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entityAccess: EntityAccessService,
  ) {}

  async search(auth: AuthContext, rawQ: string, typesParam?: string, limit = 8) {
    const q = (rawQ ?? '').trim();
    if (q.length < 2) throw new BadRequestException('검색어는 2자 이상 입력하세요.');
    if (q.length > 100) throw new BadRequestException('검색어는 100자 이하여야 합니다.');
    const requested = typesParam ? typesParam.split(',').map((t) => t.trim()).filter(Boolean) : [...SEARCH_TYPES];
    const invalid = requested.filter((t) => !(SEARCH_TYPES as readonly string[]).includes(t));
    if (invalid.length) throw new BadRequestException(`지원하지 않는 검색 유형: ${invalid.join(', ')}`);
    const types = new Set(requested as SearchType[]);
    const take = Math.min(Math.max(limit, 1), 50);

    const runners: Record<SearchType, () => Promise<SearchHit[]>> = {
      pages: () => this.pages(auth, q, take),
      projects: () => this.projects(auth, q, take),
      tasks: () => this.tasks(auth, q, take),
      databases: () => this.databases(auth, q, take),
      rows: () => this.rows(auth, q, take),
      employees: () => this.employees(auth, q, take),
      announcements: () => this.announcements(auth, q, take),
    };
    const groups = await Promise.all(
      SEARCH_TYPES.filter((t) => types.has(t)).map(async (type) => ({ type, label: LABELS[type], items: await runners[type]() })),
    );
    const nonEmpty = groups.filter((g) => g.items.length > 0);
    return { q, total: nonEmpty.reduce((n, g) => n + g.items.length, 0), groups: nonEmpty };
  }

  private async pages(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('docs.read')) return [];
    const granted = await grantedIds(this.prisma, auth, 'PAGE');
    const candidates = await this.prisma.page.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { contentText: { contains: q, mode: 'insensitive' } }],
        ...(auth.permissions.has('docs.manage')
          ? {}
          : {
              AND: [{
                OR: [
                  { createdById: auth.userId },
                  { visibility: 'WORKSPACE', workspace: { members: { some: { userId: auth.userId } } } },
                  ...(granted.length ? [{ id: { in: granted } }] : []),
                ],
              }],
            }),
      },
      select: { id: true, organizationId: true, workspaceId: true, createdById: true, visibility: true, parentId: true, title: true, icon: true, contentText: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: take * 4,
    });
    const out: SearchHit[] = [];
    for (const p of candidates) {
      if (out.length >= take) break;
      // 상속 규칙까지 포함한 최종 판정 (WHERE 는 후보 축소용)
      if (!(await this.entityAccess.pageLevel(auth, p))) continue;
      out.push({
        type: 'pages', id: p.id, title: `${p.icon ? `${p.icon} ` : ''}${p.title || '제목 없음'}`,
        snippet: snippet(p.contentText, q), href: `/admin/docs/${p.id}`, updatedAt: p.updatedAt,
      });
    }
    return out;
  }

  private async projects(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('projects.read')) return [];
    const rows = await this.prisma.project.findMany({
      where: {
        AND: [
          projectVisibleWhere(auth, await grantedIds(this.prisma, auth, 'PROJECT')),
          { OR: [{ name: { contains: q, mode: 'insensitive' } }, { key: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
        ],
      },
      select: { id: true, key: true, name: true, description: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return rows.map((p) => ({ type: 'projects', id: p.id, title: `[${p.key}] ${p.name}`, snippet: snippet(p.description, q), href: `/admin/projects/${p.id}`, meta: p.status, updatedAt: p.updatedAt }));
  }

  private async tasks(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('projects.read')) return [];
    const rows = await this.prisma.task.findMany({
      where: {
        AND: [
          taskVisibleWhere(auth, await grantedIds(this.prisma, auth, 'PROJECT')),
          { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
        ],
      },
      select: { id: true, title: true, description: true, status: true, projectId: true, project: { select: { key: true, name: true } }, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return rows.map((t) => ({
      type: 'tasks', id: t.id, title: t.title, snippet: snippet(t.description, q),
      href: t.projectId ? `/admin/projects/${t.projectId}?task=${t.id}` : `/admin/my-tasks?task=${t.id}`,
      meta: t.project ? `${t.project.key} · ${t.status}` : t.status, updatedAt: t.updatedAt,
    }));
  }

  private async visibleDatabaseWhere(auth: AuthContext): Promise<Prisma.DatabaseWhereInput> {
    const granted = await grantedIds(this.prisma, auth, 'DATABASE');
    return {
      organizationId: auth.organizationId,
      deletedAt: null,
      OR: [{ workspace: { members: { some: { userId: auth.userId } } } }, ...(granted.length ? [{ id: { in: granted } }] : [])],
    };
  }

  private async databases(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('databases.read')) return [];
    const rows = await this.prisma.database.findMany({
      where: { AND: [await this.visibleDatabaseWhere(auth), { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }] },
      select: { id: true, name: true, icon: true, description: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return rows.map((d) => ({ type: 'databases', id: d.id, title: `${d.icon ? `${d.icon} ` : ''}${d.name}`, snippet: snippet(d.description, q), href: `/admin/databases/${d.id}`, updatedAt: d.updatedAt }));
  }

  /** 데이터베이스 행: 제목(TITLE) 셀 텍스트 ILIKE */
  private async rows(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('databases.read')) return [];
    const dbs = await this.prisma.database.findMany({ where: await this.visibleDatabaseWhere(auth), select: { id: true, name: true }, take: 2000 });
    if (!dbs.length) return [];
    const names = new Map(dbs.map((d) => [d.id, d.name]));
    const pattern = `%${escapeLike(q)}%`;
    const hits = await this.prisma.$queryRaw<{ id: string; databaseId: string; title: string; updatedAt: Date }[]>`
      SELECT r.id, r."databaseId", c.value #>> '{}' AS title, r."updatedAt"
      FROM database_rows r
      JOIN database_cells c ON c."rowId" = r.id
      JOIN database_properties p ON p.id = c."propertyId" AND p.type = 'TITLE'
      WHERE r."databaseId" IN (${Prisma.join(dbs.map((d) => Prisma.sql`${d.id}::uuid`))})
        AND r."deletedAt" IS NULL
        AND (c.value #>> '{}') ILIKE ${pattern}
      ORDER BY r."updatedAt" DESC
      LIMIT ${take}`;
    return hits.map((h) => ({
      type: 'rows', id: h.id, title: h.title, snippet: null, meta: names.get(h.databaseId) ?? null,
      href: `/admin/databases/${h.databaseId}?row=${h.id}`, updatedAt: h.updatedAt,
    }));
  }

  /** 직원: 디렉터리 공개 필드(이름·이메일·직책·부서)만 */
  private async employees(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('employees.read')) return [];
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: auth.organizationId,
        employmentStatus: { not: 'RESIGNED' },
        user: { deletedAt: null, status: { not: 'DISABLED' } },
        OR: [
          { user: { name: { contains: q, mode: 'insensitive' } } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
          { title: { contains: q, mode: 'insensitive' } },
          { department: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: { title: true, department: { select: { name: true } }, user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
      take,
    });
    return rows.map((m) => ({
      type: 'employees', id: m.user.id, title: m.user.name, snippet: m.user.email,
      meta: [m.department?.name, m.title].filter(Boolean).join(' · ') || null, href: `/admin/employees?user=${m.user.id}`,
    }));
  }

  /** 공지: 전사 공지, 내 부서 공지, 열람 가능한 프로젝트 공지, 내가 작성한 공지 */
  private async announcements(auth: AuthContext, q: string, take: number): Promise<SearchHit[]> {
    if (!auth.permissions.has('announcements.read')) return [];
    const visibleProjects = auth.permissions.has('projects.read')
      ? (await this.prisma.project.findMany({ where: projectVisibleWhere(auth, await grantedIds(this.prisma, auth, 'PROJECT')), select: { id: true } })).map((p) => p.id)
      : [];
    const rows = await this.prisma.announcement.findMany({
      where: {
        organizationId: auth.organizationId,
        deletedAt: null,
        AND: [
          { OR: [{ publishedAt: { lte: new Date() } }, { authorId: auth.userId }] },
          {
            OR: [
              { scope: 'COMPANY' },
              { authorId: auth.userId },
              ...(auth.departmentId ? [{ scope: 'DEPARTMENT' as const, departmentId: auth.departmentId }] : []),
              ...(visibleProjects.length ? [{ scope: 'PROJECT' as const, projectId: { in: visibleProjects } }] : []),
            ],
          },
          { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] },
        ],
      },
      select: { id: true, title: true, body: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: 'desc' },
      take,
    });
    return rows.map((a) => ({ type: 'announcements', id: a.id, title: a.title, snippet: snippet(a.body, q), href: `/admin/announcements?id=${a.id}`, updatedAt: a.updatedAt }));
  }
}
