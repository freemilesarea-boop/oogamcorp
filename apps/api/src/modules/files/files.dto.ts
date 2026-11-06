import { EntityType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** 파일을 연결할 대상 (선택). targetType 과 targetId 는 함께 지정해야 한다 */
export class UploadFileDto {
  @ValidateIf((o: UploadFileDto) => o.targetId !== undefined || o.targetType !== undefined) @IsEnum(EntityType) targetType?: EntityType;
  @ValidateIf((o: UploadFileDto) => o.targetId !== undefined || o.targetType !== undefined) @IsUUID() targetId?: string;
}

export class FileQueryDto extends PaginationQueryDto {
  @ValidateIf((o: FileQueryDto) => o.targetId !== undefined || o.targetType !== undefined) @IsEnum(EntityType) targetType?: EntityType;
  @ValidateIf((o: FileQueryDto) => o.targetId !== undefined || o.targetType !== undefined) @IsUUID() targetId?: string;
  @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}
