import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { AnnouncementQueryDto, CreateAnnouncementDto, UpdateAnnouncementDto } from './announcements.dto';
import { AnnouncementsService } from './announcements.service';

@ApiTags('Announcements')
@RequirePermissions('announcements.read')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: AnnouncementQueryDto) {
    return this.announcements.list(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.get(u, id);
  }

  @RequirePermissions('announcements.read', 'announcements.write')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(u, dto);
  }

  @RequirePermissions('announcements.read', 'announcements.write')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(u, id, dto);
  }

  @RequirePermissions('announcements.read', 'announcements.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.remove(u, id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.markRead(u, id);
  }
}
