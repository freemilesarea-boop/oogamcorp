import { Global, Injectable, Module } from '@nestjs/common';
import { AccessLevel, EntityType, Page } from '@prisma/client';
import { AccessService } from '../../common/auth/access.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { ProjectsModule } from '../projects/projects.module';
import { TasksService } from '../projects/tasks.service';

export type Need = 'view' | 'comment' | 'edit';
const RANK: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 };
const NEED_RANK: Record<Need, number> = { view: 1, comment: 2, edit: 3 };

/**
 * 엔터티 단위 접근 판단 (댓글·파일·검색·알림 링크 등 교차 모듈에서 공통 사용).
 * 모든 판단은 서버에서 수행되며 조직(organizationId) 격리를 전제로 한다.
 */
@Injectable()
export class EntityAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * 문서(Page) 접근 수준.
   * - docs.manage 또는 작성자: FULL
   * - WORKSPACE 공개: 워크스페이스 구성원 → docs.write 보유 시 EDIT, 아니면 VIEW
   * - PRIVATE: 작성자만 (+명시 부여)
   * - RESTRICTED: 명시 부여(resource_grants PAGE)된 사용자/부서만
   * - 상위 문서가 RESTRICTED/PRIVATE 이면 하위 문서도 상위 문서 접근 권한을 함께 요구한다(상속)
   */
  async pageLevel(auth: AuthContext, page: Pick<Page, 'id' | 'organizationId' | 'workspaceId' | 'createdById' | 'visibility' | 'parentId'>, depth = 0): Promise<AccessLevel | null> {
    if (page.organizationId !== auth.organizationId) return null;
    if (!auth.permissions.has('docs.read')) return null;
    if (auth.permissions.has('docs.manage') || page.createdById === auth.userId) return 'FULL';
    const grant = await this.access.grantedLevel(auth, 'PAGE', page.id);
    let level: AccessLevel | null = grant;
    if (page.visibility === 'WORKSPACE') {
      const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: auth.userId } } });
      if (member && member.role !== 'VIEWER') {
        const base: AccessLevel = auth.permissions.has('docs.write') ? 'EDIT' : 'VIEW';
        if (!level || RANK[base] > RANK[level]) level = base;
      } else if (member) {
        if (!level) level = 'VIEW';
      }
    }
    if (!level) return null;
    // 상위 문서 제한 상속 (최대 깊이 10)
    if (page.parentId && depth < 10) {
      const parent = await this.prisma.page.findUnique({
        where: { id: page.parentId },
        select: { id: true, organizationId: true, workspaceId: true, createdById: true, visibility: true, parentId: true },
      });
      if (parent && parent.visibility !== 'WORKSPACE') {
        const parentLevel = await this.pageLevel(auth, parent, depth + 1);
        if (!parentLevel) return null;
        if (RANK[parentLevel] < RANK[level]) level = parentLevel;
      }
    }
    return level;
  }

  /** 엔터티 접근 가능 여부 */
  async can(auth: AuthContext, type: EntityType | 'PAGE', id: string, need: Need = 'view'): Promise<boolean> {
    switch (type) {
      case 'PAGE': {
        const page = await this.prisma.page.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
        if (!page) return false;
        const lvl = await this.pageLevel(auth, page);
        return !!lvl && RANK[lvl] >= NEED_RANK[need];
      }
      case 'TASK':
        return this.tasks.canAccess(auth, id, need === 'edit' ? 'edit' : 'view');
      case 'PROJECT': {
        try {
          await this.projectAccess.require(auth, id, need === 'edit' ? 'edit' : 'view');
          return true;
        } catch {
          return false;
        }
      }
      case 'APPROVAL': {
        const req = await this.prisma.approvalRequest.findFirst({
          where: { id, organizationId: auth.organizationId, deletedAt: null },
          select: { requesterId: true, status: true, steps: { select: { approverId: true } } },
        });
        if (!req) return false;
        const involved = req.requesterId === auth.userId || req.steps.some((s) => s.approverId === auth.userId);
        if (need === 'edit') return req.requesterId === auth.userId;
        return involved || auth.permissions.has('approvals.read_all');
      }
      case 'BUDGET':
      case 'TRANSACTION': {
        const perm = need === 'edit' ? 'finance.write' : 'finance.read';
        if (!auth.permissions.has(perm)) return false;
        const exists = type === 'BUDGET'
          ? await this.prisma.budget.count({ where: { id, organizationId: auth.organizationId, deletedAt: null } })
          : await this.prisma.financialTransaction.count({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
        return exists > 0;
      }
      case 'DATABASE':
      case 'DATABASE_ROW': {
        const perm = need === 'edit' ? 'databases.write' : 'databases.read';
        if (!auth.permissions.has(perm)) return false;
        const dbId = type === 'DATABASE' ? id : (await this.prisma.databaseRow.findUnique({ where: { id }, select: { databaseId: true } }))?.databaseId;
        if (!dbId) return false;
        const db = await this.prisma.database.findFirst({ where: { id: dbId, organizationId: auth.organizationId, deletedAt: null } });
        if (!db) return false;
        const member = await this.prisma.workspaceMember.count({ where: { workspaceId: db.workspaceId, userId: auth.userId } });
        if (member) return true;
        const grant = await this.access.grantedLevel(auth, 'DATABASE', dbId);
        return !!grant && RANK[grant] >= NEED_RANK[need];
      }
      case 'ANNOUNCEMENT':
        return auth.permissions.has(need === 'edit' ? 'announcements.write' : 'announcements.read');
      case 'EVENT': {
        const ev = await this.prisma.calendarEvent.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null }, include: { attendees: { select: { userId: true } } } });
        if (!ev) return false;
        const involved = ev.createdById === auth.userId || ev.attendees.some((a) => a.userId === auth.userId);
        if (need === 'edit') return ev.createdById === auth.userId;
        return auth.permissions.has('calendar.read') && (!ev.isPrivate || involved);
      }
      case 'CMS':
        return auth.permissions.has(need === 'edit' ? 'cms.write' : 'cms.read');
      case 'USER':
      case 'DEPARTMENT':
        return need === 'view' ? auth.permissions.has('employees.read') : auth.permissions.has('employees.manage');
      default:
        return false;
    }
  }
}

@Global()
@Module({ imports: [ProjectsModule], providers: [EntityAccessService], exports: [EntityAccessService] })
export class EntityAccessModule {}
