import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { INLINE_TYPES, contentDisposition } from './file-policy';
import { FileQueryDto, UploadFileDto } from './files.dto';
import { FilesService } from './files.service';
import { SingleFileUploadInterceptor } from './upload.interceptor';

@ApiTags('Files')
@RequirePermissions('files.read')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @RequirePermissions('files.read', 'files.write')
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(SingleFileUploadInterceptor)
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
    // Content-Type 은 클라이언트 선언값이 아니라 업로드 시 판별한 실제 형식을 사용
    // (판별값이 없는 기존 파일은 업로드 시 매직 바이트를 확인했던 이미지/PDF 만 선언값 사용)
    const type = file.detectedMime ?? (INLINE_TYPES.has(file.mimeType) ? file.mimeType : 'application/octet-stream');
    const inline = INLINE_TYPES.has(type);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.originalName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    // 업로드 콘텐츠는 어떤 경우에도 스크립트 실행·외부 리소스 로드를 허용하지 않는다
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  /** 악성코드 재검사 (엔진 오류로 다운로드가 차단된 파일). 업로더 본인 또는 settings.manage */
  @RequirePermissions('files.read', 'files.write')
  @Post(':id/rescan')
  rescan(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.rescan(u, id);
  }

  @RequirePermissions('files.read', 'files.write')
  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.remove(u, id);
  }
}
