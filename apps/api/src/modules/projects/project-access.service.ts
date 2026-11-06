import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Project } from '@prisma/client';
import { AccessService } from '../../common/auth/access.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';

export type ProjectAccess = 'none' | 'view' | 'edit' | 'manage';

/** 프로젝트 리소스 단위 접근 제어 (서버 측 강제) */
@Injectable()
export class ProjectAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async level(auth: AuthContext, project: Project): Promise<ProjectAccess> {
    if (project.organizationId !== auth.organizationId || project.deletedAt) return 'none';
    if (!auth.permissions.has('projects.read')) return 'none';
    if (auth.permissions.has('projects.manage')) return 'manage';
    if (project.managerId === auth.userId || project.createdById === auth.userId) return 'manage';
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: auth.userId } },
    });
    if (member?.role === 'MANAGER') return 'manage';
    const grant = await this.access.grantedLevel(auth, 'PROJECT', project.id);
    if (grant === 'FULL') return 'manage';
    if (member?.role === 'MEMBER' || grant === 'EDIT') return 'edit';
    if (member || grant || (auth.departmentId && project.departmentId === auth.departmentId)) return 'view';
    return 'none';
  }

  async require(auth: AuthContext, projectId: string, needed: Exclude<ProjectAccess, 'none'>): Promise<Project> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: auth.organizationId, deletedAt: null } });
    if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    const lvl = await this.level(auth, project);
    const rank = { none: 0, view: 1, edit: 2, manage: 3 } as const;
    if (rank[lvl] === 0) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    if (rank[lvl] < rank[needed]) throw new ForbiddenException('프로젝트에 대한 권한이 부족합니다.');
    return project;
  }
}
