import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import {
  AddMemberDto, CreateProjectDto, CustomStatusDto, LinkDto, MilestoneDto, ProjectQueryDto, UpdateMilestoneDto, UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@RequirePermissions('projects.read')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: ProjectQueryDto) {
    return this.projects.list(u, q);
  }

  @RequirePermissions('projects.read', 'projects.write')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(u, id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(u, id);
  }

  @Get(':id/activity')
  activity(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.activityLog(u, id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMemberDto) {
    return this.projects.addMember(u, id, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.projects.removeMember(u, id, userId);
  }

  @Post(':id/milestones')
  addMilestone(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneDto) {
    return this.projects.addMilestone(u, id, dto);
  }

  @Patch(':id/milestones/:mid')
  updateMilestone(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string, @Body() dto: UpdateMilestoneDto) {
    return this.projects.updateMilestone(u, id, mid, dto);
  }

  @Delete(':id/milestones/:mid')
  removeMilestone(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('mid', ParseUUIDPipe) mid: string) {
    return this.projects.removeMilestone(u, id, mid);
  }

  @Post(':id/statuses')
  addStatus(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomStatusDto) {
    return this.projects.addStatus(u, id, dto);
  }

  @Delete(':id/statuses/:sid')
  removeStatus(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.projects.removeStatus(u, id, sid);
  }

  @Post(':id/links')
  addLink(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    return this.projects.addLink(u, id, dto);
  }

  @Delete(':id/links/:linkId')
  removeLink(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.projects.removeLink(u, id, linkId);
  }
}
