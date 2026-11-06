import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Paginated } from '@oogam/shared';

export class PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize?: number = DEFAULT_PAGE_SIZE;

  /** 검색어 */
  @IsOptional() @IsString() @MaxLength(200)
  q?: string;

  /** 정렬 필드 (각 API 의 허용 목록 내) */
  @IsOptional() @IsString() @MaxLength(50)
  sort?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}

export function pageArgs(q: PaginationQueryDto) {
  const page = q.page ?? 1;
  const pageSize = Math.min(q.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

/** 허용된 정렬 필드만 반영 (임의 컬럼 정렬로 인한 정보 노출/오류 방지) */
export function orderByArg<T extends string>(q: PaginationQueryDto, allowed: readonly T[], fallback: T) {
  const field = (allowed as readonly string[]).includes(q.sort ?? '') ? (q.sort as T) : fallback;
  return { [field]: q.order ?? 'desc' } as Record<T, 'asc' | 'desc'>;
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
