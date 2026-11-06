import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { Priority, TaskStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ChecklistItemDto } from './project.dto';

export class TaskQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsUUID() milestoneId?: string;
  /** 'root' 면 최상위 업무만, UUID 면 해당 상위 업무의 하위 업무 */
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsDateString() dueFrom?: string;
  @IsOptional() @IsDateString() dueTo?: string;
  @IsOptional() @IsIn(['true', 'false']) includeDone?: 'true' | 'false';
}

export class CreateTaskDto {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsUUID() milestoneId?: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsUUID() customStatusId?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) assigneeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) checklist?: ChecklistItemDto[];
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string | null;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsUUID() customStatusId?: string | null;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() milestoneId?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) assigneeIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) checklist?: ChecklistItemDto[];
}

export class DependencyDto {
  @IsUUID() dependsOnId: string;
}

export class BulkPositionDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TaskPositionDto)
  items: TaskPositionDto[];
}

export class TaskPositionDto {
  @IsUUID() id: string;
  @IsNumber() position: number;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
}

export class MyTasksQueryDto {
  @IsOptional() @IsIn(['true', 'false']) includeDone?: 'true' | 'false';
  @IsOptional() @IsBoolean() _?: boolean;
}
