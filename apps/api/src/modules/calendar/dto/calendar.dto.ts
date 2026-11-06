import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength,
} from 'class-validator';
import { AttendeeResponse } from '@prisma/client';

/** RRULE (RFC 5545) 형태만 저장 — 반복 전개는 후속 구현 */
const RRULE = /^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,+\-:]+)*$/;

export class EventRangeQueryDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
  /** 'tasks' 지정 시 내 업무 마감일을 읽기 전용 항목으로 함께 반환 */
  @IsOptional() @IsIn(['tasks']) include?: 'tasks';
  /** mine: 내 담당/개인 업무(기본), visible: 열람 가능한 프로젝트 업무 전체 */
  @IsOptional() @IsIn(['mine', 'visible']) taskScope?: 'mine' | 'visible';
  /** true 면 내가 만들었거나 참석하는 일정만 */
  @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}

export class CreateEventDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsDateString() startAt: string;
  @IsDateString() endAt: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsBoolean() isPrivate?: boolean;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(500) @Matches(RRULE, { message: 'recurrence 는 RRULE 형식이어야 합니다(예: FREQ=WEEKLY;BYDAY=MO).' }) recurrence?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) attendeeIds?: string[];
}

export class UpdateEventDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsBoolean() isPrivate?: boolean;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() departmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) @Matches(RRULE, { message: 'recurrence 는 RRULE 형식이어야 합니다(예: FREQ=WEEKLY;BYDAY=MO).' }) recurrence?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) attendeeIds?: string[];
}

export class RespondDto {
  @IsEnum(AttendeeResponse) @IsIn(['ACCEPTED', 'DECLINED', 'TENTATIVE']) response: AttendeeResponse;
}
