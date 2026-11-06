import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PostType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const INQUIRY_CATEGORIES = ['PROJECT', 'PARTNERSHIP', 'CAREER', 'PRESS', 'GENERAL'] as const;

/** 공개 문의 폼. 개인정보 수집·이용 동의(privacyConsent=true) 필수 */
export class CreateInquiryDto {
  @Transform(trim) @IsString() @MinLength(1, { message: '이름을 입력하세요.' }) @MaxLength(100) name: string;
  @Transform(trim) @IsEmail({}, { message: '올바른 이메일 주소를 입력하세요.' }) @MaxLength(254) email: string;
  @IsOptional() @Transform(trim) @IsString() @Matches(/^$|^[0-9+()\-\s]{7,20}$/, { message: '올바른 전화번호를 입력하세요.' }) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsIn(INQUIRY_CATEGORIES) category?: (typeof INQUIRY_CATEGORIES)[number];
  @Transform(trim) @IsString() @MinLength(10, { message: '문의 내용을 10자 이상 입력하세요.' }) @MaxLength(5000) message: string;
  @IsBoolean() @Equals(true, { message: '개인정보 수집·이용에 동의해야 문의를 접수할 수 있습니다.' }) privacyConsent: boolean;
  /** 허니팟 — 사람에게는 보이지 않는 필드. 값이 있으면 스팸으로 간주해 조용히 폐기 */
  @IsOptional() @IsString() @MaxLength(2000) website?: string;
}

export class PublicPostsQueryDto {
  @IsOptional() @IsEnum(PostType) type?: PostType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class PublicPortfolioQueryDto {
  @IsOptional() @IsString() @MaxLength(120) brand?: string;
  @IsOptional() @IsIn(['true', 'false']) featured?: 'true' | 'false';
}
