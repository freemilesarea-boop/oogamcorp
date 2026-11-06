import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, IsUUID,
  Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ContentStatus, InquiryStatus, PostType } from '@prisma/client';
import { SLUG_PATTERN } from '@oogam/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const SLUG_MSG = '슬러그는 영문 소문자·숫자·한글과 하이픈(-)만 사용할 수 있습니다.';
/** http/https 만 허용 (javascript:, data: 등 차단) */
const HTTP_URL: Parameters<typeof IsUrl>[0] = { protocols: ['http', 'https'], require_protocol: true };
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ───────────── 공통 ─────────────
export class StatusChangeDto {
  @IsEnum(ContentStatus) status: ContentStatus;
  /** 관계 확인 메모가 있는 브랜드를 게시할 때 확인 체크 (공식 계열사 표기 금지 확인) */
  @IsOptional() @IsBoolean() acknowledgeRelationship?: boolean;
}

export class ContentQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
}

// ───────────── 브랜드 ─────────────
export class CreateBrandDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) logoUrl?: string | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsUrl(HTTP_URL, { message: '웹사이트 주소는 http(s):// 로 시작해야 합니다.' }) @MaxLength(1000) websiteUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(80) category?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) relationshipNote?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
}

export class UpdateBrandDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) logoUrl?: string | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsUrl(HTTP_URL, { message: '웹사이트 주소는 http(s):// 로 시작해야 합니다.' }) @MaxLength(1000) websiteUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(80) category?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) relationshipNote?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
}

export class ReorderDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids: string[];
}

// ───────────── 포트폴리오 ─────────────
export class PortfolioQueryDto extends ContentQueryDto {
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsIn(['true', 'false']) featured?: 'true' | 'false';
}

export class CreatePortfolioDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) body?: string | null;
  @IsOptional() @IsString() @MaxLength(200) client?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1990) @Max(2100) year?: number | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
}

export class UpdatePortfolioDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) body?: string | null;
  @IsOptional() @IsString() @MaxLength(200) client?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1990) @Max(2100) year?: number | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) imageUrl?: string | null;
  @IsOptional() @IsUUID() brandId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
}

// ───────────── 게시물 (뉴스/인사이트/채용) ─────────────
export class PostQueryDto extends ContentQueryDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
}

export class CreatePostDto {
  @IsEnum(PostType) type: PostType;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string | null;
  /** 마크다운/일반 텍스트. HTML 은 렌더링되지 않고 텍스트로 취급된다 */
  @IsOptional() @IsString() @MaxLength(50_000) body?: string;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) coverImageUrl?: string | null;
  /** 유형별 부가정보 (채용: location, employmentType, deadline, team, applyUrl) */
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  /** 게시일 (게시 시 미지정이면 현재 시각) */
  @IsOptional() @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
}

export class UpdatePostDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(120) @Matches(SLUG_PATTERN, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string | null;
  @IsOptional() @IsString() @MaxLength(50_000) body?: string;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) coverImageUrl?: string | null;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsDateString() publishedAt?: string | null;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
}

// ───────────── 고정 페이지 ─────────────
export class SavePageDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) title?: string;
  /** 페이지 키별 구조 (서버에서 키별 스키마로 추가 검증) */
  @IsObject() content: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(500) seoDescription?: string | null;
  @IsOptional() @IsUrl(HTTP_URL) @MaxLength(1000) ogImageUrl?: string | null;
}

// ───────────── 문의 ─────────────
export class InquiryQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(InquiryStatus) status?: InquiryStatus;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

export class UpdateInquiryDto {
  @IsOptional() @IsEnum(InquiryStatus) status?: InquiryStatus;
  @IsOptional() @IsString() @MaxLength(5000) internalNote?: string | null;
}
