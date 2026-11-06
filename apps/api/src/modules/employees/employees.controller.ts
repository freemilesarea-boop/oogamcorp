import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { reqMeta } from '../../common/utils/request';
import {
  ChangeRoleDto, CreateInvitationDto, DeactivateDto, EmployeeQueryDto, InvitationQueryDto, UpdateEmployeeDto, UpdateHrRecordDto,
} from './employees.dto';
import { EmployeesService } from './employees.service';
import { InvitationsService } from './invitations.service';

@ApiTags('Employees')
@RequirePermissions('employees.manage')
@Controller('employees/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: InvitationQueryDto) {
    return this.invitations.list(u, q);
  }

  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateInvitationDto) {
    return this.invitations.create(u, dto);
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.resend(u, id);
  }

  @Delete(':id')
  revoke(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(u, id);
  }
}

@ApiTags('Employees')
@RequirePermissions('employees.read')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: EmployeeQueryDto) {
    return this.employees.list(u, q);
  }

  /** 역할 선택용 목록 (초대/역할 변경 화면) */
  @Get('roles')
  roles(@CurrentUser() u: AuthContext) {
    return this.employees.roles(u);
  }

  @Get(':id')
  detail(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.detail(u, id);
  }

  @RequirePermissions('employees.read', 'employees.manage')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(u, id, dto);
  }

  @RequirePermissions('employees.read', 'employees.manage')
  @Put(':id/role')
  changeRole(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRoleDto) {
    return this.employees.changeRole(u, id, dto);
  }

  @RequirePermissions('employees.read', 'employees.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeactivateDto) {
    return this.employees.deactivate(u, id, dto);
  }

  @RequirePermissions('employees.read', 'employees.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.reactivate(u, id);
  }

  /** 민감 인사정보 열람 — hr.sensitive.read 필요, 열람 자체를 감사 로그에 기록 */
  @RequirePermissions('hr.sensitive.read')
  @Get(':id/hr')
  getHr(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.employees.getHr(u, id, reqMeta(req));
  }

  @RequirePermissions('hr.sensitive.write')
  @Put(':id/hr')
  updateHr(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHrRecordDto, @Req() req: Request) {
    return this.employees.updateHr(u, id, dto, reqMeta(req));
  }
}
