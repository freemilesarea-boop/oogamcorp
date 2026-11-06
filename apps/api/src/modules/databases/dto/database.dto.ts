import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { DbPropertyType, DbViewType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

// ───────────── Databases ─────────────
export class DatabaseQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() workspaceId?: string;
}

export class CreateDatabaseDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(16) icon?: string;
  /** 미지정 시 조직 기본 워크스페이스 */
  @IsOptional() @IsUUID() workspaceId?: string;
}

export class UpdateDatabaseDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(16) icon?: string | null;
}

// ───────────── Properties ─────────────
export class CreatePropertyDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEnum(DbPropertyType) type: DbPropertyType;
  /** 타입별 설정 (서버에서 타입별 스키마로 검증) */
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class UpdatePropertyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(DbPropertyType) type?: DbPropertyType;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class ReorderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @IsUUID('all', { each: true }) orderedIds: string[];
}

// ───────────── Rows ─────────────
export class CreateRowDto {
  /** { [propertyId]: value } — 값은 속성 타입별 스키마로 서버 검증 */
  @IsOptional() @IsObject() cells?: Record<string, unknown>;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) position?: number;
}

export class UpdateRowDto {
  @IsObject() cells: Record<string, unknown>;
}

export class RowQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  /** 보드/캘린더 뷰는 한 번에 더 많은 행을 필요로 하므로 최대 500 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number = 50;
  /** 저장된 뷰의 필터/정렬(+개인 설정)을 적용 */
  @IsOptional() @IsUUID() viewId?: string;
  /** JSON 배열: [{ propertyId, operator, value? }] — 지정 시 뷰 필터를 대체 */
  @IsOptional() @IsString() @MaxLength(10_000) filters?: string;
  /** JSON 배열: [{ propertyId, direction }] — 지정 시 뷰 정렬을 대체 */
  @IsOptional() @IsString() @MaxLength(2_000) sorts?: string;
  @IsOptional() @IsIn(['and', 'or']) filterMode?: 'and' | 'or';
  /** SELECT / PERSON / CHECKBOX 속성 ID — 그룹별 개수 반환 */
  @IsOptional() @IsUUID() groupBy?: string;
  /** 제목(TITLE) 텍스트 검색 */
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

// ───────────── Views ─────────────
export class CreateViewDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEnum(DbViewType) type: DbViewType;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  /** true 면 본인만 보는 개인 뷰 */
  @IsOptional() @IsBoolean() personal?: boolean;
}

export class UpdateViewDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(DbViewType) type?: DbViewType;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class ViewPreferenceDto {
  @IsObject() config: Record<string, unknown>;
}

// ───────────── CSV ─────────────
export class ExportQueryDto {
  @IsOptional() @IsUUID() viewId?: string;
}

export class ImportDto {
  /** JSON 본문으로 CSV 텍스트 전달 시 (multipart 의 file 필드 대신) */
  @IsOptional() @IsString() @MaxLength(5 * 1024 * 1024) csv?: string;
  /** 헤더에 없는 속성명을 TEXT 속성으로 생성 (multipart 에서는 'true'/'false' 문자열) */
  @IsOptional() @IsIn([true, false, 'true', 'false']) createMissing?: boolean | 'true' | 'false';
}
