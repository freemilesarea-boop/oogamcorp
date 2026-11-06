import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { AccessLevel, PageVisibility } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateDocumentDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsUUID() workspaceId?: string;
  @IsOptional() @IsString() @MaxLength(16) icon?: string;
  @IsOptional() @IsEnum(PageVisibility) visibility?: PageVisibility;
  /** 템플릿 문서 ID: 지정 시 템플릿 내용으로 생성 */
  @IsOptional() @IsUUID() templateId?: string;
  /** 템플릿으로 생성 (템플릿 목록에 표시) */
  @IsOptional() @IsBoolean() isTemplate?: boolean;
}

export class UpdateDocumentDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(16) icon?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) coverUrl?: string | null;
  @IsOptional() @IsBoolean() isTemplate?: boolean;
}

export class SaveContentDto {
  /** Tiptap(ProseMirror) JSON 문서 */
  @IsObject() content: Record<string, unknown>;
  /** 클라이언트가 편집을 시작한 기준 버전 (낙관적 동시성 제어) */
  @Type(() => Number) @IsInt() @Min(1) baseVersion: number;
}

export class MoveDocumentDto {
  /** null 이면 최상위로 이동 */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
  /** 형제 사이 위치 (분수 위치). 미지정 시 맨 끝 */
  @IsOptional() @IsNumber() position?: number;
  /** 지정 시 이 문서 바로 앞으로 이동 (position 보다 우선) */
  @IsOptional() @IsUUID() beforeId?: string;
  /** 지정 시 이 문서 바로 뒤로 이동 */
  @IsOptional() @IsUUID() afterId?: string;
}

export class DuplicateDocumentDto {
  @IsOptional() @IsBoolean() includeChildren?: boolean;
}

export class DocumentQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() workspaceId?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsIn(['true', 'false']) templates?: 'true' | 'false';
}

export class TreeQueryDto {
  @IsOptional() @IsUUID() workspaceId?: string;
}

export class GrantDto {
  @ValidateIf((o: GrantDto) => !o.departmentId) @IsUUID() userId?: string;
  @ValidateIf((o: GrantDto) => !o.userId) @IsUUID() departmentId?: string;
  @IsEnum(AccessLevel) access: AccessLevel;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class VisibilityDto {
  @IsEnum(PageVisibility) visibility: PageVisibility;
}
