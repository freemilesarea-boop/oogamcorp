import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import { ApprovalStatus, ApprovalType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AMOUNT_REGEX } from '../../finance/dto/finance.dto';

const AMOUNT_MSG = { message: '금액은 소수점 2자리까지의 숫자 문자열이어야 합니다.' };
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const APPROVAL_BOXES = ['mine', 'todo', 'done', 'all', 'involved'] as const;
export type ApprovalBox = (typeof APPROVAL_BOXES)[number];

export class ApprovalQueryDto extends PaginationQueryDto {
  /** mine: 내가 올린 / todo: 결재 대기 / done: 내가 처리한 / all: 전체(approvals.read_all) / involved: 관련 전체(기본) */
  @IsOptional() @IsIn(APPROVAL_BOXES) box?: ApprovalBox;
  @IsOptional() @IsEnum(ApprovalStatus) status?: ApprovalStatus;
  @IsOptional() @IsEnum(ApprovalType) type?: ApprovalType;
}

export class CreateApprovalDto {
  @IsOptional() @IsEnum(ApprovalType) type?: ApprovalType;
  @Transform(trim) @IsString() @MinLength(1, { message: '제목을 입력하세요.' }) @MaxLength(200) title: string;
  @IsString() @MaxLength(20_000) content: string;
  @IsOptional() @Matches(AMOUNT_REGEX, AMOUNT_MSG) amount?: string | null;
  /** 결재선: 순서대로 결재할 사용자 ID (1~10명, 중복 불가, 기안자 제외) */
  @IsArray() @ArrayMinSize(1, { message: '결재자를 1명 이상 지정하세요.' }) @ArrayMaxSize(10, { message: '결재자는 최대 10명입니다.' })
  @ArrayUnique({ message: '결재자가 중복되었습니다.' }) @IsUUID('all', { each: true })
  approverIds: string[];
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() budgetId?: string | null;
  @IsOptional() @IsUUID() transactionId?: string | null;
  /** true 이면 저장과 동시에 상신 */
  @IsOptional() @IsBoolean() submit?: boolean;
}

export class UpdateApprovalDto {
  @IsOptional() @IsInt() @Min(0) version?: number;
  @IsOptional() @IsEnum(ApprovalType) type?: ApprovalType;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(20_000) content?: string;
  @IsOptional() @Matches(AMOUNT_REGEX, AMOUNT_MSG) amount?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique({ message: '결재자가 중복되었습니다.' }) @IsUUID('all', { each: true })
  approverIds?: string[];
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() budgetId?: string | null;
  @IsOptional() @IsUUID() transactionId?: string | null;
}

/** 결재 처리 공통 본문. version 은 클라이언트가 본 문서 버전(낙관적 잠금) */
export class ApprovalActionDto {
  @IsOptional() @IsInt() @Min(0) version?: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class RequiredCommentActionDto {
  @IsOptional() @IsInt() @Min(0) version?: number;
  @Transform(trim) @IsString() @MinLength(1, { message: '의견을 입력하세요.' }) @MaxLength(2000) comment: string;
}

export class ApprovalCommentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) comment: string;
}
