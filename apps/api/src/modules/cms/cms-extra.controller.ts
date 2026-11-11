import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { BusinessAreasService } from './business-areas.service';
import {
  ContentQueryDto, CreateBusinessAreaDto, MediaQueryDto, ReorderDto, RevisionQueryDto, StatusChangeDto, UpdateBusinessAreaDto, UploadMediaDto,
} from './dto/cms.dto';
import { MediaService, type UploadedImage } from './media.service';
import { MediaUploadInterceptor } from './media-upload.interceptor';
import { RevisionsService } from './revisions.service';

@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/business-areas')
export class CmsBusinessAreasController {
  constructor(
    private readonly areas: BusinessAreasService,
    private readonly revisions: RevisionsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: ContentQueryDto) {
    return this.areas.list(u, q);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post()
  async create(@CurrentUser() u: AuthContext, @Body() dto: CreateBusinessAreaDto) {
    const r = await this.areas.create(u, dto);
    await this.revisions.record(u, 'business_area', r.id, 'created', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Put('order')
  reorder(@CurrentUser() u: AuthContext, @Body() dto: ReorderDto) {
    return this.areas.reorder(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.areas.get(u, id);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Patch(':id')
  async update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessAreaDto) {
    const r = await this.areas.update(u, id, dto);
    await this.revisions.record(u, 'business_area', id, 'updated', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post(':id/status')
  @HttpCode(200)
  async status(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto) {
    const r = await this.areas.changeStatus(u, id, dto);
    await this.revisions.record(u, 'business_area', id, `status:${dto.status}`, r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.areas.remove(u, id);
  }
}

/** 변경 이력 조회·복구 */
@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/revisions')
export class CmsRevisionsController {
  constructor(private readonly revisions: RevisionsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: RevisionQueryDto) {
    return this.revisions.list(u, q.entityType, q.entityId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.revisions.get(u, id);
  }

  /** 이전 버전을 초안으로 복구 (게시 중 항목의 수정은 cms.publish 필요 — 서비스 규칙 적용) */
  @RequirePermissions('cms.read', 'cms.write')
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.revisions.restore(u, id);
  }
}

/** 홈페이지 이미지 라이브러리 */
@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/media')
export class CmsMediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: MediaQueryDto) {
    return this.media.list(u, q);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post()
  @UseInterceptors(MediaUploadInterceptor)
  upload(@CurrentUser() u: AuthContext, @UploadedFile() file: UploadedImage | undefined, @Body() dto: UploadMediaDto) {
    return this.media.upload(u, file, dto.alt);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(u, id);
  }
}
