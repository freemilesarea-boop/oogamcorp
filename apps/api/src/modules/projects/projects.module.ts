import { Module } from '@nestjs/common';
import { ProjectAccessService } from './project-access.service';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [ProjectsController, TasksController],
  providers: [ProjectsRepository, ProjectsService, TasksService, ProjectAccessService],
  exports: [ProjectAccessService, TasksService],
})
export class ProjectsModule {}
