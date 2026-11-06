import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

/** 워크스페이스 조회. 구성원(또는 docs.manage)만 접근 가능 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext) {
    const all = auth.permissions.has('docs.manage');
    const rows = await this.prisma.workspace.findMany({
      where: { organizationId: auth.organizationId, ...(all ? {} : { members: { some: { userId: auth.userId } } }) },
      include: {
        members: { where: { userId: auth.userId }, select: { role: true } },
        _count: { select: { members: true, pages: { where: { deletedAt: null } } } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map(({ members, _count, ...w }) => ({
      ...w,
      role: members[0]?.role ?? null,
      memberCount: _count.members,
      pageCount: _count.pages,
    }));
  }

  async get(auth: AuthContext, id: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id, organizationId: auth.organizationId },
      include: { _count: { select: { members: true, pages: { where: { deletedAt: null } } } } },
    });
    if (!ws) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    const member = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: auth.userId } } });
    if (!member && !auth.permissions.has('docs.manage')) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    const { _count, ...rest } = ws;
    return { ...rest, role: member?.role ?? null, memberCount: _count.members, pageCount: _count.pages };
  }
}

@ApiTags('Workspaces')
@RequirePermissions('workspace.access')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.workspaces.list(u);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.workspaces.get(u, id);
  }
}

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService], exports: [WorkspacesService] })
export class WorkspacesModule {}
