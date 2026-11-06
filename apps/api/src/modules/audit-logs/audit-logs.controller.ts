import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PaginationQueryDto, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';

export class AuditLogQueryDto extends PaginationQueryDto {
  /** 액션 접두사 (예: employee., hr.record) */
  @IsOptional() @Matches(/^[a-z0-9_.-]{1,80}$/i) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(50) entityType?: string;
  @IsOptional() @IsString() @MaxLength(80) entityId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext, q: AuditLogQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    let to: Date | undefined;
    if (q.to) {
      to = new Date(q.to);
      // 날짜만 지정한 경우 해당 일자 전체 포함
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to = new Date(to.getTime() + 86400_000);
    }
    const where: Prisma.AuditLogWhereInput = {
      organizationId: auth.organizationId,
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(q.q ? { OR: [{ action: { contains: q.q, mode: 'insensitive' } }, { entityId: { contains: q.q } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' }, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [];
    const a = new Map(actors.map((x) => [x.id, x]));
    return paginated(
      rows.map((r) => ({ ...r, actor: r.actorId ? a.get(r.actorId) ?? null : null })),
      total, page, pageSize,
    );
  }

  /** 필터용 액션 목록 */
  async actions(auth: AuthContext) {
    const rows = await this.prisma.auditLog.groupBy({ by: ['action'], where: { organizationId: auth.organizationId }, _count: true, orderBy: { action: 'asc' } });
    return rows.map((r) => ({ action: r.action, count: r._count }));
  }
}

@ApiTags('Audit logs')
@RequirePermissions('audit.read')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: AuditLogQueryDto) {
    return this.logs.list(u, q);
  }

  @Get('actions')
  actions(@CurrentUser() u: AuthContext) {
    return this.logs.actions(u);
  }
}
