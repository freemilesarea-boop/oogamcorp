import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { SearchService } from './search.service';

class SearchQueryDto {
  @IsString() @MaxLength(100) q: string;
  /** 쉼표 구분: pages,projects,tasks,databases,rows,employees,announcements */
  @IsOptional() @IsString() @Matches(/^[a-z,]{1,120}$/) types?: string;
  /** 유형별 최대 결과 수 */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@ApiTags('Search')
@RequirePermissions('workspace.access')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** 권한 인지 통합 검색 (유형별 그룹 결과) */
  @Get()
  find(@CurrentUser() u: AuthContext, @Query() q: SearchQueryDto) {
    return this.search.search(u, q.q, q.types, q.limit);
  }
}

@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
