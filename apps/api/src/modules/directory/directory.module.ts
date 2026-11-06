import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

class DirectoryQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

/**
 * 사용자 디렉터리: 담당자/참석자/결재자/멘션 선택용 최소 정보(이름·이메일·부서·직책)만 제공.
 * 민감 인사정보는 포함하지 않는다. 워크스페이스 접근 권한만 필요.
 */
@ApiTags('Users')
@Controller('directory')
export class DirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('users')
  async users(@CurrentUser() auth: AuthContext, @Query() q: DirectoryQuery) {
    const rows = await this.prisma.membership.findMany({
      where: {
        organizationId: auth.organizationId,
        employmentStatus: { not: 'RESIGNED' },
        user: {
          status: 'ACTIVE',
          deletedAt: null,
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
        },
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      select: {
        title: true,
        department: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { user: { name: 'asc' } },
      take: 200,
    });
    return rows.map((r) => ({ ...r.user, title: r.title, department: r.department }));
  }

  @Get('departments')
  departments(@CurrentUser() auth: AuthContext) {
    return this.prisma.department.findMany({
      where: { organizationId: auth.organizationId, deletedAt: null },
      select: { id: true, name: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}

@Module({ controllers: [DirectoryController] })
export class DirectoryModule {}
