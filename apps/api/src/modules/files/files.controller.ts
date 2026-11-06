import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { loadConfig } from '../../config/configuration';
import { INLINE_TYPES, contentDisposition } from './file-policy';
import { FileQueryDto, UploadFileDto } from './files.dto';
import { FilesService } from './files.service';

const uploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: loadConfig().storage.maxUploadMb * 1024 * 1024, files: 1, fields: 10, fieldSize: 1024 },
  // 한글 파일명을 UTF-8 로 해석
  defParamCharset: 'utf8',
};

@ApiTags('Files')
@RequirePermissions('files.read')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @RequirePermissions('files.read', 'files.write')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  upload(@CurrentUser() u: AuthContext, @UploadedFile() file: Express.Multer.File | undefined, @Body() dto: UploadFileDto) {
    return this.files.upload(u, file, dto);
  }

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: FileQueryDto) {
    return this.files.list(u, q);
  }

  @Get(':id')
  meta(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.meta(u, id);
  }

  /** 다운로드 — 요청마다 서버가 접근 권한을 확인한다 */
  @Get(':id/download')
  async download(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { file, stream } = await this.files.open(u, id);
    const inline = INLINE_TYPES.has(file.mimeType);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.originalName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    // PDF 는 브라우저 내장 뷰어가 sandbox CSP 에서 동작하지 않으므로 제외
    if (file.mimeType !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  @RequirePermissions('files.read', 'files.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.remove(u, id);
  }
}
