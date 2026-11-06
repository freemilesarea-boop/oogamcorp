import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { AssignMembersDto, CreateDepartmentDto, DeleteDepartmentQueryDto, UpdateDepartmentDto } from './teams.dto';
import { TeamsService } from './teams.service';

@ApiTags('Departments')
@RequirePermissions('employees.read')
@Controller('departments')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.teams.list(u);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(u, id);
  }

  @Get(':id/members')
  members(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.members(u, id);
  }

  @RequirePermissions('teams.manage')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateDepartmentDto) {
    return this.teams.create(u, dto);
  }

  @RequirePermissions('teams.manage')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.teams.update(u, id, dto);
  }

  @RequirePermissions('teams.manage')
  @Post(':id/members')
  assign(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignMembersDto) {
    return this.teams.assignMembers(u, id, dto);
  }

  @RequirePermissions('teams.manage')
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.teams.removeMember(u, id, userId);
  }

  @RequirePermissions('teams.manage')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: DeleteDepartmentQueryDto) {
    return this.teams.remove(u, id, q);
  }
}
