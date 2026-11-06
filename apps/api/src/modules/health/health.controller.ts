import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 프로세스 생존 확인 (liveness) */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** DB/Redis 연결 확인 (readiness) */
  @Public()
  @Get()
  async ready(@Res({ passthrough: true }) res: Response) {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const redis = await this.redis.ping();
    const ok = db && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database: db ? 'up' : 'down', redis: redis ? 'up' : 'down' } };
  }
}
