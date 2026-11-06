import {
  BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { memoryStorage, MulterError } from 'multer';
import { Observable } from 'rxjs';
import { loadConfig } from '../../config/configuration';

/** 업로드 최대 크기(바이트) — 호출 시점 설정 기준 */
export function maxUploadBytes(): number {
  return Math.floor(loadConfig().storage.maxUploadMb * 1024 * 1024);
}

export function tooLargeMessage(): string {
  return `파일 크기가 허용 한도(${loadConfig().storage.maxUploadMb}MB)를 초과했습니다.`;
}

/**
 * 단일 파일(`file` 필드) multipart 업로드 인터셉터.
 * FileInterceptor 는 데코레이터 평가 시점에 한도가 고정되므로, 요청마다 현재 설정으로 multer 를 구성한다.
 * multer 오류는 한국어 메시지의 HTTP 예외로 변환한다 (크기 초과 → 413).
 */
@Injectable()
export class SingleFileUploadInterceptor implements NestInterceptor {
  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const handler = multer({
      storage: memoryStorage(),
      limits: { fileSize: maxUploadBytes(), files: 1, fields: 10, fieldSize: 1024, parts: 12 },
      // 한글 파일명을 UTF-8 로 해석
      defParamCharset: 'utf8',
    }).single('file');
    await new Promise<void>((resolve, reject) => {
      handler(req, res, (err: unknown) => {
        if (!err) return resolve();
        if (err instanceof MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') return reject(new PayloadTooLargeException(tooLargeMessage()));
          if (err.code === 'LIMIT_UNEXPECTED_FILE') return reject(new BadRequestException('파일은 file 필드로 1개만 업로드할 수 있습니다.'));
          return reject(new BadRequestException(`업로드 요청 형식이 올바르지 않습니다. (${err.code})`));
        }
        reject(new BadRequestException('업로드 요청을 처리할 수 없습니다.'));
      });
    });
    return next.handle();
  }
}
