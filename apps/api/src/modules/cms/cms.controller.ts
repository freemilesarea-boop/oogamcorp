import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { reqMeta } from '../../common/utils/request';
import { BrandsService } from './brands.service';
import {
  ContentQueryDto, CreateBrandDto, CreatePortfolioDto, CreatePostDto, InquiryQueryDto, PortfolioQueryDto, PostQueryDto, ReorderDto,
  SavePageDto, StatusChangeDto, UpdateBrandDto, UpdateInquiryDto, UpdatePortfolioDto, UpdatePostDto,
} from './dto/cms.dto';
import { InquiriesService } from './inquiries.service';
import { OverviewService } from './overview.service';
import { PagesService } from './pages.service';
import { PortfolioService } from './portfolio.service';
import { PostsService } from './posts.service';
import { RevisionsService } from './revisions.service';

/**
 * 홈페이지 CMS (관리자).
 * 권한: 열람 cms.read / 편집 cms.write (DRAFT↔REVIEW) / 게시·중단·보관 cms.publish / 문의 cms.inquiries
 * 메서드 단위 @RequirePermissions 는 클래스 단위를 대체하므로 항상 cms.read 를 함께 명시한다.
 */
@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms')
export class CmsOverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  get(@CurrentUser() u: AuthContext) {
    return this.overview.get(u);
  }
}

@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/brands')
export class CmsBrandsController {
  constructor(
    private readonly brands: BrandsService,
    private readonly revisions: RevisionsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: ContentQueryDto) {
    return this.brands.list(u, q);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post()
  async create(@CurrentUser() u: AuthContext, @Body() dto: CreateBrandDto) {
    const r = await this.brands.create(u, dto);
    await this.revisions.record(u, 'brand', r.id, 'created', r);
    return r;
  }

  /** 정렬 순서 일괄 변경 (ids 순서대로 sortOrder = 0..n) */
  @RequirePermissions('cms.read', 'cms.write')
  @Put('order')
  reorder(@CurrentUser() u: AuthContext, @Body() dto: ReorderDto) {
    return this.brands.reorder(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.brands.get(u, id);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Patch(':id')
  async update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) {
    const r = await this.brands.update(u, id, dto);
    await this.revisions.record(u, 'brand', id, 'updated', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post(':id/status')
  @HttpCode(200)
  async status(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto) {
    const r = await this.brands.changeStatus(u, id, dto);
    await this.revisions.record(u, 'brand', id, `status:${dto.status}`, r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.brands.remove(u, id);
  }
}

@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/portfolio')
export class CmsPortfolioController {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly revisions: RevisionsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: PortfolioQueryDto) {
    return this.portfolio.list(u, q);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post()
  async create(@CurrentUser() u: AuthContext, @Body() dto: CreatePortfolioDto) {
    const r = await this.portfolio.create(u, dto);
    await this.revisions.record(u, 'portfolio', r.id, 'created', r);
    return r;
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portfolio.get(u, id);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Patch(':id')
  async update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePortfolioDto) {
    const r = await this.portfolio.update(u, id, dto);
    await this.revisions.record(u, 'portfolio', id, 'updated', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post(':id/status')
  @HttpCode(200)
  async status(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto) {
    const r = await this.portfolio.changeStatus(u, id, dto);
    await this.revisions.record(u, 'portfolio', id, `status:${dto.status}`, r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portfolio.remove(u, id);
  }
}

@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/posts')
export class CmsPostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly revisions: RevisionsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: PostQueryDto) {
    return this.posts.list(u, q);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post()
  async create(@CurrentUser() u: AuthContext, @Body() dto: CreatePostDto) {
    const r = await this.posts.create(u, dto);
    await this.revisions.record(u, 'post', r.id, 'created', r);
    return r;
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.get(u, id);
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Patch(':id')
  async update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    const r = await this.posts.update(u, id, dto);
    await this.revisions.record(u, 'post', id, 'updated', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post(':id/status')
  @HttpCode(200)
  async status(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto) {
    const r = await this.posts.changeStatus(u, id, dto);
    await this.revisions.record(u, 'post', id, `status:${dto.status}`, r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.remove(u, id);
  }
}

@ApiTags('CMS')
@RequirePermissions('cms.read')
@Controller('cms/pages')
export class CmsPagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly revisions: RevisionsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthContext) {
    return this.pages.list(u);
  }

  @Get(':key')
  get(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    return this.pages.get(u, key);
  }

  /** 초안(content) 미리보기 — 인증 필요, 공개 사이트에는 노출되지 않음 */
  @Get(':key/preview')
  preview(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    return this.pages.preview(u, key);
  }

  /** 초안 저장 (공개본에는 영향 없음) */
  @RequirePermissions('cms.read', 'cms.write')
  @Put(':key')
  async save(@CurrentUser() u: AuthContext, @Param('key') key: string, @Body() dto: SavePageDto) {
    const r = await this.pages.save(u, key, dto);
    await this.revisions.record(u, 'page', key, 'draft_saved', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.write')
  @Post(':key/discard')
  @HttpCode(200)
  async discard(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    const r = await this.pages.discardDraft(u, key);
    await this.revisions.record(u, 'page', key, 'draft_discarded', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.publish')
  @Post(':key/publish')
  @HttpCode(200)
  async publish(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    const r = await this.pages.publish(u, key);
    await this.revisions.record(u, 'page', key, 'published', r);
    return r;
  }

  @RequirePermissions('cms.read', 'cms.publish')
  @Post(':key/unpublish')
  @HttpCode(200)
  async unpublish(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    const r = await this.pages.unpublish(u, key);
    await this.revisions.record(u, 'page', key, 'unpublished', r);
    return r;
  }
}

@ApiTags('CMS')
@RequirePermissions('cms.inquiries')
@Controller('cms/inquiries')
export class CmsInquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: InquiryQueryDto) {
    return this.inquiries.list(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inquiries.get(u, id, reqMeta(req));
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInquiryDto, @Req() req: Request) {
    return this.inquiries.update(u, id, dto, reqMeta(req));
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.inquiries.remove(u, id, reqMeta(req));
  }
}
