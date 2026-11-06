import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CommentTarget } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CommentQueryDto extends PaginationQueryDto {
  @IsEnum(CommentTarget) targetType: CommentTarget;
  @IsUUID() targetId: string;
}

export class CreateCommentDto {
  @IsEnum(CommentTarget) targetType: CommentTarget;
  @IsUUID() targetId: string;
  /** 평문 (HTML 미허용 — 렌더링 시 텍스트로만 표시) */
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) mentions?: string[];
}

export class UpdateCommentDto {
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) mentions?: string[];
}

export class ResolveCommentDto {
  /** false 면 해결 취소 (기본 true) */
  @IsOptional() @IsBoolean() resolved?: boolean;
}
