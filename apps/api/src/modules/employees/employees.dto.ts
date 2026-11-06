import { EmploymentStatus, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class EmployeeQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() departmentId?: string;
  /** 역할 키 (OWNER, EXECUTIVE ...) */
  @IsOptional() @IsString() @MaxLength(40) role?: string;
  /** 재직 상태 */
  @IsOptional() @IsEnum(EmploymentStatus) status?: EmploymentStatus;
  /** 계정 상태 */
  @IsOptional() @IsEnum(UserStatus) accountStatus?: UserStatus;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(100) title?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsDateString() hireDate?: string | null;
  @IsOptional() @IsString() @MaxLength(40) employeeNumber?: string | null;
  @IsOptional() @Matches(/^[0-9+\-() ]{0,30}$/, { message: '전화번호 형식이 올바르지 않습니다.' }) phone?: string | null;
  @IsOptional() @IsEnum(EmploymentStatus) employmentStatus?: EmploymentStatus;
}

export class ChangeRoleDto {
  @IsUUID() roleId: string;
}

export class DeactivateDto {
  /** true 면 퇴사 처리(재직 상태 RESIGNED) */
  @IsOptional() @IsBoolean() resign?: boolean;
}

export class CreateInvitationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: '올바른 이메일을 입력하세요.' }) @MaxLength(254)
  email: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsUUID() roleId: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(100) title?: string;
}

export class InvitationQueryDto {
  @IsOptional() @IsIn(['pending', 'all']) status?: 'pending' | 'all';
}

export class UpdateHrRecordDto {
  /** 연봉 (원, 소수 둘째 자리까지 문자열). null 이면 삭제 */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{1,16}(\.\d{1,2})?$/, { message: '연봉은 0 이상의 숫자(소수 둘째 자리까지)로 입력하세요.' })
  annualSalary?: string | null;

  @IsOptional() @IsString() @MaxLength(2000) salaryNote?: string | null;
  @IsOptional() @IsString() @MaxLength(200) bankAccount?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) emergencyInfo?: string | null;
}
