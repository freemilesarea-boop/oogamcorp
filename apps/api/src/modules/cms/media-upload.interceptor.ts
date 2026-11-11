import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { memoryStorage, MulterError } from 'multer';
import { Observable } from 'rxjs';
import { MediaService } from './media.service';

/** 이미지 1개(`file` 필드) 업로드. 크기 초과는 스트림 단계에서 즉시 413 */
@Injectable()
export class MediaUploadInterceptor implements NestInterceptor {
  constructor(private readonly media: MediaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const max = this.media.maxBytes();
    const handler = multer({
      storage: memoryStorage(),
      limits: { fileSize: max, files: 1, fields: 3, fieldSize: 1024, parts: 5 },
      defParamCharset: 'utf8',
    }).single('file');
    await new Promise<void>((resolve, reject) => {
      handler(req, res, (err: unknown) => {
        if (!err) return resolve();
        if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return reject(new PayloadTooLargeException(`이미지는 ${Math.round(max / 1024 / 1024)}MB 이하만 업로드할 수 있습니다.`));
        }
        reject(new BadRequestException('이미지 업로드 요청 형식이 올바르지 않습니다.'));
      });
    });
    return next.handle();
  }
}
