import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { BudgetPeriod, BudgetStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** 금액은 문자열(최대 16자리 정수 + 소수점 2자리)로만 받는다 — 부동소수점 오차 방지 */
export const AMOUNT_REGEX = /^-?\d{1,16}(\.\d{1,2})?$/;
const AMOUNT_MSG = { message: '금액은 소수점 2자리까지의 숫자 문자열이어야 합니다. (예: "15000" 또는 "1234.50")' };

// ───────────── 사업 구분 ─────────────
export class BusinessUnitQueryDto {
  @IsOptional() @IsIn(['true', 'false']) includeInactive?: 'true' | 'false';
}

export class CreateBusinessUnitDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @Matches(/^[A-Z0-9_-]{2,20}$/, { message: '코드는 영문 대문자/숫자/-/_ 2~20자여야 합니다.' }) code: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBusinessUnitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @Matches(/^[A-Z0-9_-]{2,20}$/, { message: '코드는 영문 대문자/숫자/-/_ 2~20자여야 합니다.' }) code?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ───────────── 예산 ─────────────
export class BudgetQueryDto extends PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fiscalYear?: number;
  @IsOptional() @IsEnum(BudgetStatus) status?: BudgetStatus;
  @IsOptional() @IsEnum(BudgetPeriod) period?: BudgetPeriod;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
}

export class BudgetLineDto {
  @IsString() @MinLength(1) @MaxLength(100) category: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Matches(AMOUNT_REGEX, AMOUNT_MSG) plannedAmount: string;
}

export class CreateBudgetDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsInt() @Min(2000) @Max(2100) fiscalYear: number;
  @IsOptional() @IsEnum(BudgetPeriod) period?: BudgetPeriod;
  @IsOptional() @IsInt() @Min(1) @Max(4) quarter?: number | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() businessUnitId?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

export class UpdateBudgetDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) fiscalYear?: number;
  @IsOptional() @IsEnum(BudgetPeriod) period?: BudgetPeriod;
  @IsOptional() @IsInt() @Min(1) @Max(4) quarter?: number | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() businessUnitId?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => BudgetLineDto)
  lines?: BudgetLineDto[];
}

export class ApproveBudgetLineDto {
  @IsUUID() lineId: string;
  @Matches(AMOUNT_REGEX, AMOUNT_MSG) approvedAmount: string;
}

export class ApproveBudgetDto {
  /** 항목별 승인 금액. 생략한 항목은 편성 금액 그대로 승인 */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ApproveBudgetLineDto)
  lines?: ApproveBudgetLineDto[];
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class ReasonDto {
  @IsString() @MinLength(1, { message: '사유를 입력하세요.' }) @MaxLength(1000) reason: string;
}

export class BudgetLineOptionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) fiscalYear?: number;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

// ───────────── 거래 ─────────────
export class TransactionQueryDto extends PaginationQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(TransactionType) type?: TransactionType;
  @IsOptional() @IsEnum(TransactionStatus) status?: TransactionStatus;
  @IsOptional() @IsUUID() businessUnitId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

export class AllocationDto {
  @IsUUID() budgetLineId: string;
  @Matches(AMOUNT_REGEX, AMOUNT_MSG) amount: string;
}

export class CreateTransactionDto {
  @IsDateString() txDate: string;
  @IsEnum(TransactionType) type: TransactionType;
  @IsOptional() @IsUUID() businessUnitId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) counterparty?: string | null;
  @IsString() @MinLength(1) @MaxLength(1000) description: string;
  @Matches(AMOUNT_REGEX, AMOUNT_MSG) supplyAmount: string;
  @IsOptional() @Matches(AMOUNT_REGEX, AMOUNT_MSG) vatAmount?: string;
  /** true 이면 부가세를 공급가액의 10%(원 단위 절사)로 자동 계산 */
  @IsOptional() @IsBoolean() autoVat?: boolean;
  @IsOptional() @IsUUID() evidenceFileId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations?: AllocationDto[];
  /** true 이면 등록과 동시에 승인 요청(PENDING) */
  @IsOptional() @IsBoolean() submit?: boolean;
}

export class UpdateTransactionDto {
  @IsOptional() @IsDateString() txDate?: string;
  @IsOptional() @IsEnum(TransactionType) type?: TransactionType;
  @IsOptional() @IsUUID() businessUnitId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) counterparty?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) description?: string;
  @IsOptional() @Matches(AMOUNT_REGEX, AMOUNT_MSG) supplyAmount?: string;
  @IsOptional() @Matches(AMOUNT_REGEX, AMOUNT_MSG) vatAmount?: string;
  @IsOptional() @IsBoolean() autoVat?: boolean;
  @IsOptional() @IsUUID() evidenceFileId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations?: AllocationDto[];
}

export class SetAllocationsDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations: AllocationDto[];
}

export class DashboardQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}
