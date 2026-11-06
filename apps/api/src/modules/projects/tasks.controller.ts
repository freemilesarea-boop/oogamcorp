import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { LinkDto } from './dto/project.dto';
import { BulkPositionDto, CreateTaskDto, DependencyDto, MyTasksQueryDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@RequirePermissions('projects.read')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: TaskQueryDto) {
    return this.tasks.list(u, q);
  }

  /** 내 업무 (마감 기준 그룹) */
  @Get('mine')
  mine(@CurrentUser() u: AuthContext, @Query() q: MyTasksQueryDto) {
    return this.tasks.myTasks(u, q.includeDone === 'true');
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(u, dto);
  }

  /** 칸반 드래그 정렬 일괄 반영 */
  @RequirePermissions('projects.read', 'tasks.write')
  @Post('reorder')
  reorder(@CurrentUser() u: AuthContext, @Body() dto: BulkPositionDto) {
    return this.tasks.reorder(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(u, id);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(u, id, dto);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.remove(u, id);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Post(':id/dependencies')
  addDep(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DependencyDto) {
    return this.tasks.addDependency(u, id, dto.dependsOnId);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Delete(':id/dependencies/:depId')
  removeDep(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('depId', ParseUUIDPipe) depId: string) {
    return this.tasks.removeDependency(u, id, depId);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Post(':id/links')
  addLink(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    return this.tasks.addLink(u, id, dto);
  }

  @RequirePermissions('projects.read', 'tasks.write')
  @Delete(':id/links/:linkId')
  removeLink(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.tasks.removeLink(u, id, linkId);
  }
}
