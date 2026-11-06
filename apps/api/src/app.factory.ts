import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadConfig } from './config/configuration';

/** main.ts 와 통합 테스트가 동일한 설정을 사용하도록 공통화 */
export function configureApp(app: INestApplication): void {
  const cfg = loadConfig();
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: cfg.webOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  if (cfg.swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle('OOGAM Platform API')
      .setDescription('OOGAM 기업 홈페이지 + 사내 워크스페이스 REST API (/api/v1). 쿠키 세션 인증 + X-CSRF-Token 헤더 필요')
      .setVersion('0.1.0')
      .addCookieAuth('oogam_session')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: 'api/docs/openapi.json',
    });
  }
}
