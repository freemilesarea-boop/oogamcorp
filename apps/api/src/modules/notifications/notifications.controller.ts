import { Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationType, Prisma } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/decorators';
import { PaginationQueryDto, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false';
  @IsOptional() @IsEnum(NotificationType) type?: NotificationType;
}

const select = {
  id: true, type: true, title: true, body: true, link: true, entityType: true, entityId: true, readAt: true, createdAt: true,
} satisfies Prisma.NotificationSelect;

/** 인앱 알림: 본인 알림만 조회/변경 가능 (userId + organizationId 로 항상 제한) */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private own(auth: AuthContext): Prisma.NotificationWhereInput {
    return { userId: auth.userId, organizationId: auth.organizationId };
  }

  async list(auth: AuthContext, q: NotificationQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.NotificationWhereInput = {
      ...this.own(auth),
      ...(q.unread === 'true' ? { readAt: null } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { body: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, select, orderBy: { createdAt: q.order === 'asc' ? 'asc' : 'desc' }, skip, take }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async unreadCount(auth: AuthContext) {
    return { count: await this.prisma.notification.count({ where: { ...this.own(auth), readAt: null } }) };
  }

  async markRead(auth: AuthContext, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, ...this.own(auth) }, select: { id: true, readAt: true } });
    if (!n) throw new NotFoundException('알림을 찾을 수 없습니다.');
    if (!n.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async readAll(auth: AuthContext) {
    const r = await this.prisma.notification.updateMany({ where: { ...this.own(auth), readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  async remove(auth: AuthContext, id: string) {
    const r = await this.prisma.notification.deleteMany({ where: { id, ...this.own(auth) } });
    if (!r.count) throw new NotFoundException('알림을 찾을 수 없습니다.');
    return { ok: true };
  }
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: NotificationQueryDto) {
    return this.notifications.list(u, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() u: AuthContext) {
    return this.notifications.unreadCount(u);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() u: AuthContext) {
    return this.notifications.readAll(u);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(u, id);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.remove(u, id);
  }
}
