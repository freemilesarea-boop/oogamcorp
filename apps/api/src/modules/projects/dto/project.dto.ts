import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { EntityType, MilestoneStatus, Priority, ProjectMemberRole, ProjectStatus, TaskStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ProjectQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() managerId?: string;
  /** true 면 본인이 참여한 프로젝트만 */
  @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  /** 프로젝트 키 (예: WEB). 미입력 시 자동 생성 */
  @IsOptional() @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: '키는 영문 대문자로 시작하는 2~10자여야 합니다.' }) key?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsUUID() budgetId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) memberIds?: string[];
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() managerId?: string | null;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsUUID() budgetId?: string | null;
}

export class AddMemberDto {
  @IsUUID() userId: string;
  @IsOptional() @IsEnum(ProjectMemberRole) role?: ProjectMemberRole;
}

export class MilestoneDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsEnum(MilestoneStatus) status?: MilestoneStatus;
}

export class UpdateMilestoneDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsEnum(MilestoneStatus) status?: MilestoneStatus;
}

export class CustomStatusDto {
  @IsString() @MinLength(1) @MaxLength(50) name: string;
  @IsEnum(TaskStatus) category: TaskStatus;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
}

export class LinkDto {
  @ApiPropertyOptional({ enum: EntityType })
  @IsEnum(EntityType) targetType: EntityType;
  @IsUUID() targetId: string;
}

export class ChecklistItemDto {
  @IsString() @MaxLength(50) id: string;
  @IsString() @MaxLength(500) text: string;
  done: boolean;
}

export class ChecklistDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto)
  items: ChecklistItemDto[];
}
