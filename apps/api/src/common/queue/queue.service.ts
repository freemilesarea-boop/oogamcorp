import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { loadConfig } from '../../config/configuration';

export const QUEUE_NAMES = {
  notifications: 'oogam-notifications',
  maintenance: 'oogam-maintenance',
} as const;

export type NotificationJob =
  | { kind: 'email'; notificationId: string }
  | { kind: 'due-reminders' };

/** BullMQ 생산자. Redis 장애 시 큐잉 실패를 로그로만 남기고 요청은 계속 처리한다 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection = new IORedis(loadConfig().redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  readonly notifications = new Queue<NotificationJob>(QUEUE_NAMES.notifications, { connection: this.connection });

  constructor() {
    this.connection.on('error', (e) => this.logger.warn(`Queue Redis 오류: ${e.message}`));
  }

  async enqueueEmail(notificationId: string): Promise<void> {
    if (!loadConfig().smtp.enabled) return; // SMTP 설정 이후에만 이메일 발송
    try {
      await this.notifications.add('email', { kind: 'email', notificationId }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 });
    } catch (e) {
      this.logger.warn(`이메일 작업 큐잉 실패: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.notifications.close().catch(() => undefined);
    this.connection.disconnect();
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
