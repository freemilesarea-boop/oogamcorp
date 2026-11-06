import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { DatabasesService } from './databases.service';
import {
  CreateDatabaseDto, CreatePropertyDto, CreateRowDto, CreateViewDto, DatabaseQueryDto, ExportQueryDto, ImportDto, ReorderDto, RowQueryDto,
  UpdateDatabaseDto, UpdatePropertyDto, UpdateRowDto, UpdateViewDto, ViewPreferenceDto,
} from './dto/database.dto';
import { RowsService } from './rows.service';

const UUID = new ParseUUIDPipe();

@ApiTags('Databases')
@RequirePermissions('databases.read')
@Controller('databases')
export class DatabasesController {
  constructor(
    private readonly dbs: DatabasesService,
    private readonly rows: RowsService,
  ) {}

  // ───────────── Databases ─────────────
  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: DatabaseQueryDto) {
    return this.dbs.list(u, q);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateDatabaseDto) {
    return this.dbs.create(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string) {
    return this.dbs.get(u, id);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: UpdateDatabaseDto) {
    return this.dbs.update(u, id, dto);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string) {
    return this.dbs.remove(u, id);
  }

  @Get(':id/activity')
  activity(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string) {
    return this.dbs.activityLog(u, id);
  }

  // ───────────── Properties ─────────────
  @RequirePermissions('databases.read', 'databases.write')
  @Post(':id/properties')
  createProperty(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: CreatePropertyDto) {
    return this.dbs.createProperty(u, id, dto);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Post(':id/properties/reorder')
  reorderProperties(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReorderDto) {
    return this.dbs.reorderProperties(u, id, dto.orderedIds);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Patch(':id/properties/:pid')
  updateProperty(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('pid', UUID) pid: string, @Body() dto: UpdatePropertyDto) {
    return this.dbs.updateProperty(u, id, pid, dto);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Delete(':id/properties/:pid')
  removeProperty(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('pid', UUID) pid: string) {
    return this.dbs.removeProperty(u, id, pid);
  }

  // ───────────── Rows ─────────────
  @Get(':id/rows')
  listRows(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Query() q: RowQueryDto) {
    return this.rows.list(u, id, q);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Post(':id/rows')
  createRow(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: CreateRowDto) {
    return this.rows.create(u, id, dto);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Post(':id/rows/reorder')
  reorderRows(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: ReorderDto) {
    return this.rows.reorder(u, id, dto.orderedIds);
  }

  @Get(':id/rows/:rowId')
  getRow(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('rowId', UUID) rowId: string) {
    return this.rows.get(u, id, rowId);
  }

  @Get(':id/rows/:rowId/activity')
  rowActivity(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('rowId', UUID) rowId: string) {
    return this.rows.rowActivity(u, id, rowId);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Patch(':id/rows/:rowId')
  updateRow(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('rowId', UUID) rowId: string, @Body() dto: UpdateRowDto) {
    return this.rows.update(u, id, rowId, dto);
  }

  @RequirePermissions('databases.read', 'databases.write')
  @Delete(':id/rows/:rowId')
  removeRow(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('rowId', UUID) rowId: string) {
    return this.rows.remove(u, id, rowId);
  }

  // ───────────── Views ─────────────
  @Get(':id/views')
  listViews(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string) {
    return this.dbs.listViews(u, id);
  }

  /** 공유 뷰는 databases.write + 편집 권한, 개인 뷰(personal=true)는 열람 권한만 필요 */
  @Post(':id/views')
  createView(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Body() dto: CreateViewDto) {
    return this.dbs.createView(u, id, dto);
  }

  @Patch(':id/views/:viewId')
  updateView(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('viewId', UUID) viewId: string, @Body() dto: UpdateViewDto) {
    return this.dbs.updateView(u, id, viewId, dto);
  }

  @Delete(':id/views/:viewId')
  removeView(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('viewId', UUID) viewId: string) {
    return this.dbs.removeView(u, id, viewId);
  }

  @Put(':id/views/:viewId/preference')
  putPreference(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('viewId', UUID) viewId: string, @Body() dto: ViewPreferenceDto) {
    return this.dbs.upsertPreference(u, id, viewId, dto);
  }

  @Delete(':id/views/:viewId/preference')
  clearPreference(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Param('viewId', UUID) viewId: string) {
    return this.dbs.clearPreference(u, id, viewId);
  }

  // ───────────── CSV ─────────────
  @Get(':id/export.csv')
  async exportCsv(@CurrentUser() u: AuthContext, @Param('id', UUID) id: string, @Query() q: ExportQueryDto, @Res({ passthrough: true }) res: Response) {
    const { filename, body } = await this.rows.exportCsv(u, id, q.viewId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }

  /** multipart(file 필드) 또는 JSON { csv } (JSON 본문은 서버 본문 크기 제한을 받으므로 대용량은 multipart 사용) */
  @RequirePermissions('databases.read', 'databases.write')
  @Post(':id/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  importCsv(
    @CurrentUser() u: AuthContext,
    @Param('id', UUID) id: string,
    @Body() dto: ImportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const text = file ? file.buffer.toString('utf8') : dto.csv;
    if (!text) throw new BadRequestException('CSV 파일(file) 또는 csv 텍스트가 필요합니다.');
    const createMissing = dto.createMissing === true || dto.createMissing === 'true';
    return this.rows.importCsv(u, id, text, createMissing);
  }
}
