import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Prisma 오류를 의미 있는 HTTP 응답으로 변환 (내부 SQL/스택 노출 방지) */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '데이터 처리 중 오류가 발생했습니다.';
    switch (exception.code) {
      case 'P2002':
        status = HttpStatus.CONFLICT;
        message = '이미 존재하는 값입니다.';
        break;
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = '대상을 찾을 수 없습니다.';
        break;
      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        message = '참조하는 데이터가 올바르지 않습니다.';
        break;
      default:
        this.logger.error(`${exception.code}: ${exception.message}`);
    }
    res.status(status).json({ statusCode: status, message, code: exception.code });
  }
}
