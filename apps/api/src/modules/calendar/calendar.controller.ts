import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { CalendarService } from './calendar.service';
import { CreateEventDto, EventRangeQueryDto, RespondDto, UpdateEventDto } from './dto/calendar.dto';

@ApiTags('Calendar')
@RequirePermissions('calendar.read')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** 기간 조회: 열람 가능한 일정 (+ include=tasks 시 업무 마감일, 읽기 전용) */
  @Get('events')
  range(@CurrentUser() u: AuthContext, @Query() q: EventRangeQueryDto) {
    return this.calendar.range(u, q);
  }

  @Get('invitations')
  invitations(@CurrentUser() u: AuthContext) {
    return this.calendar.invitations(u);
  }

  @Get('events/:id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.get(u, id);
  }

  @RequirePermissions('calendar.read', 'calendar.write')
  @Post('events')
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateEventDto) {
    return this.calendar.create(u, dto);
  }

  @RequirePermissions('calendar.read', 'calendar.write')
  @Patch('events/:id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto) {
    return this.calendar.update(u, id, dto);
  }

  @RequirePermissions('calendar.read', 'calendar.write')
  @Delete('events/:id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(u, id);
  }

  /** 참석 응답 (초대받은 사용자, calendar.read 만 필요) */
  @Post('events/:id/respond')
  respond(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.calendar.respond(u, id, dto);
  }
}
