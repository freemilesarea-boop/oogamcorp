import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ActivityService } from '../../common/activity/activity.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { reqMeta } from '../../common/utils/request';
import { DocumentAccessService } from './document-access.service';
import { DocumentSharingService } from './document-sharing.service';
import { DocumentVersionsService } from './document-versions.service';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentDto, DocumentQueryDto, DuplicateDocumentDto, GrantDto, MoveDocumentDto, SaveContentDto, TreeQueryDto, UpdateDocumentDto, VisibilityDto,
} from './dto/document.dto';

@ApiTags('Documents')
@RequirePermissions('docs.read')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly versions: DocumentVersionsService,
    private readonly sharing: DocumentSharingService,
    private readonly docAccess: DocumentAccessService,
    private readonly activity: ActivityService,
  ) {}

  /** 문서 검색/목록 (제목+본문, 접근 가능한 문서만) */
  @Get()
  search(@CurrentUser() u: AuthContext, @Query() q: DocumentQueryDto) {
    return this.docs.search(u, q);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateDocumentDto) {
    return this.docs.create(u, dto);
  }

  @Get('tree')
  tree(@CurrentUser() u: AuthContext, @Query() q: TreeQueryDto) {
    return this.docs.tree(u, q);
  }

  @Get('templates')
  templates(@CurrentUser() u: AuthContext, @Query() q: DocumentQueryDto) {
    return this.docs.templates(u, q);
  }

  @Get('trash')
  trash(@CurrentUser() u: AuthContext, @Query() q: PaginationQueryDto) {
    return this.docs.trash(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(u, id);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.docs.update(u, id, dto);
  }

  /** 본문 자동 저장 (baseVersion 불일치 시 409) */
  @RequirePermissions('docs.read', 'docs.write')
  @Put(':id/content')
  saveContent(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveContentDto) {
    return this.docs.saveContent(u, id, dto);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @HttpCode(200)
  @Post(':id/move')
  move(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDocumentDto) {
    return this.docs.move(u, id, dto);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @Post(':id/duplicate')
  duplicate(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicateDocumentDto) {
    return this.docs.duplicate(u, id, dto);
  }

  /** 휴지통으로 이동 (하위 문서 포함) */
  @RequirePermissions('docs.read', 'docs.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.docs.remove(u, id, reqMeta(req));
  }

  @RequirePermissions('docs.read', 'docs.write')
  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.docs.restore(u, id, reqMeta(req));
  }

  /** 영구 삭제 (휴지통 문서, 작성자 또는 docs.manage) */
  @RequirePermissions('docs.read', 'docs.write')
  @Delete(':id/permanent')
  purge(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.docs.purge(u, id, reqMeta(req));
  }

  @Get(':id/activity')
  async activityLog(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.docAccess.require(u, id, 'view');
    return this.activity.list(u.organizationId, 'PAGE', id, 50);
  }

  // ───── 버전 ─────

  @Get(':id/versions')
  listVersions(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.versions.list(u, id, q);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @Post(':id/versions')
  createVersion(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.versions.create(u, id);
  }

  @Get(':id/versions/:sid')
  getVersion(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.versions.get(u, id, sid);
  }

  @RequirePermissions('docs.read', 'docs.write')
  @HttpCode(200)
  @Post(':id/versions/:sid/restore')
  restoreVersion(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('sid', ParseUUIDPipe) sid: string, @Req() req: Request) {
    return this.versions.restore(u, id, sid, reqMeta(req));
  }

  // ───── 공유/권한 ─────

  @Get(':id/access')
  listAccess(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.sharing.list(u, id);
  }

  @Post(':id/access/grants')
  addGrant(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantDto, @Req() req: Request) {
    return this.sharing.add(u, id, dto, reqMeta(req));
  }

  @Delete(':id/access/grants/:grantId')
  removeGrant(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('grantId', ParseUUIDPipe) grantId: string, @Req() req: Request) {
    return this.sharing.remove(u, id, grantId, reqMeta(req));
  }

  @Patch(':id/visibility')
  setVisibility(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VisibilityDto, @Req() req: Request) {
    return this.sharing.setVisibility(u, id, dto, reqMeta(req));
  }
}
