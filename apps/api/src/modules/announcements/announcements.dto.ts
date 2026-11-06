import { AnnouncementScope } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class AnnouncementQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(AnnouncementScope) scope?: AnnouncementScope;
  @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false';
  @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}

export class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MinLength(1) @MaxLength(20_000) body: string;
  @IsEnum(AnnouncementScope) scope: AnnouncementScope;
  @ValidateIf((o: CreateAnnouncementDto) => o.scope === 'DEPARTMENT') @IsUUID() departmentId?: string;
  @ValidateIf((o: CreateAnnouncementDto) => o.scope === 'PROJECT') @IsUUID() projectId?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20_000) body?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}
