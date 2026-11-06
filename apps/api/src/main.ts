import './config/env-loader';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import { loadConfig } from './config/configuration';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.listen(cfg.port, '0.0.0.0');
  app.get(Logger).log(`OOGAM API listening on :${cfg.port} (${cfg.env})`);
}

void bootstrap();
