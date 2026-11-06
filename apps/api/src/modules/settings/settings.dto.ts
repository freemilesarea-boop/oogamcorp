import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SetRolePermissionsDto {
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(60, { each: true }) permissions: string[];
}

export class CreateRoleDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,30}$/, { message: '역할 키는 영문 대문자로 시작하는 2~31자(대문자·숫자·_)여야 합니다.' }) key: string;
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(99) rank: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(60, { each: true }) permissions?: string[];
}

export class GrantQueryDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class CreateGrantDto {
  @IsString() @MaxLength(60) permission: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class SystemSettingDto {
  @IsObject() value: Record<string, unknown>;
}

// ───── 시스템 설정 값 스키마 (키별 허용 목록) ─────
export class CompanyInfoValue {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) legalName?: string;
  @IsOptional() @IsString() @MaxLength(50) ceo?: string;
  @IsOptional() @Matches(/^[0-9-]{0,20}$/, { message: '사업자등록번호 형식이 올바르지 않습니다.' }) businessNumber?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Matches(/^[0-9+\-() ]{0,30}$/) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}

export class NotificationEmailValue {
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsBoolean() taskDueReminders?: boolean;
  @IsOptional() @IsBoolean() approvalUpdates?: boolean;
  @IsOptional() @IsBoolean() announcements?: boolean;
}
