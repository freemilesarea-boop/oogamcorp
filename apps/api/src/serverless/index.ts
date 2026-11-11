/**
 * 서버리스(Vercel) 전용 "홈페이지 CMS" 백엔드 진입점.
 *
 * 전체 사내 플랫폼(재무·직원·결재·문서·협업 등)은 포함하지 않고, 아래 모듈만 같은 코드로 구동한다.
 *   - 인증(로그인·MFA·세션·CSRF·권한) : AuthModule + 전역 AuthGuard (기존 로직 그대로)
 *   - 홈페이지 CMS                     : CmsModule (사업 영역·이미지·변경 이력 포함)
 *   - 공개 홈페이지 API                : PublicSiteModule
 *   - 인앱 알림                        : NotificationsModule (문의 접수 알림)
 * 포함되지 않은 모듈의 API 는 이 배포에 라우트 자체가 존재하지 않는다(404).
 *
 * Redis·BullMQ 는 사용하지 않는다: 이메일 큐는 비활성(No-op) — SMTP 도입 시 별도 워커로 확장.
 */
import 'reflect-metadata';
import { Global, Injectable, Logger, Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { IncomingMessage, ServerResponse } from 'node:http';
import helmet from 'helmet';

// Redis 미사용 배포 — 설정 로더의 필수값 검사를 통과시키기 위한 자리표시자 (연결하지 않음)
process.env.REDIS_URL ||= 'redis://redis-not-used.invalid:6379';

import { AuditModule } from '../common/audit/audit.service';
import { AuthCoreModule } from '../common/auth/auth-core.module';
import { AuthGuard } from '../common/auth/auth.guard';
import type { AuthContext } from '../common/auth/auth.types';
import { SessionService } from '../common/auth/session.service';
import { PrismaExceptionFilter } from '../common/filters/prisma-exception.filter';
import { NotifyModule } from '../common/notify/notify.service';
import { PrismaModule } from '../common/prisma/prisma.service';
import { QueueService } from '../common/queue/queue.service';
import { loadConfig } from '../config/configuration';
import { AuthModule } from '../modules/auth/auth.module';
import { CmsModule } from '../modules/cms/cms.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PublicSiteModule } from '../modules/public-site/public-site.module';
import { PublicSiteService, type ReadOpts } from '../modules/public-site/public-site.service';

/** 큐 없음: 이메일 작업은 기록만 생략 (인앱 알림은 DB 에 정상 저장) */
@Injectable()
class NoopQueueService {
  async enqueueEmail(): Promise<void> {}
  async enqueueInvitationEmail(): Promise<void> {}
  async onModuleDestroy(): Promise<void> {}
}

@Global()
@Module({ providers: [{ provide: QueueService, useClass: NoopQueueService }], exports: [QueueService] })
class NoQueueModule {}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      errorMessage: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
    }),
    PrismaModule,
    NoQueueModule,
    AuthCoreModule,
    AuditModule,
    NotifyModule,
    AuthModule,
    CmsModule,
    PublicSiteModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class SiteCmsModule {}

function configure(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
  });
  app.use(cookieParser());
  (app as unknown as { useBodyParser: (t: string, o: object) => void }).useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
}

let appPromise: Promise<INestApplication> | null = null;

/** 콜드 스타트 시 1회 생성 후 재사용 */
export function getApp(): Promise<INestApplication> {
  appPromise ??= (async () => {
    loadConfig(); // 필수 환경변수 검증 (누락 시 즉시 실패)
    const app = await NestFactory.create(SiteCmsModule, { logger: ['error', 'warn', 'log'], bodyParser: true });
    configure(app);
    await app.init();
    new Logger('SiteCms').log('홈페이지 CMS 백엔드 준비 완료');
    return app;
  })().catch((e: unknown) => {
    appPromise = null; // 다음 요청에서 재시도
    throw e;
  });
  return appPromise;
}

/** Node req/res 를 Nest(Express)로 전달 — Next.js pages/api 라우트에서 사용 */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  const express = app.getHttpAdapter().getInstance() as (q: IncomingMessage, s: ServerResponse) => void;
  await new Promise<void>((resolve) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    express(req, res);
  });
}

/** 공개 홈페이지 데이터 (서버 컴포넌트에서 HTTP 없이 직접 호출) */
export async function publicSite(): Promise<PublicSiteService> {
  return (await getApp()).get(PublicSiteService);
}

/** 세션 쿠키 → 인증 컨텍스트 (만료·비활성·MFA 미완료 판정 포함). 미리보기 권한 확인용 */
export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  return (await getApp()).get(SessionService).resolve(token);
}

export function sessionCookieName(): string {
  return loadConfig().cookie.sessionName;
}

export type { AuthContext, ReadOpts };
