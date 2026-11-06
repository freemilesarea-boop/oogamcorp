import { Global, Injectable, Module } from '@nestjs/common';
import { EntityType, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: EntityType;
  entityId?: string;
  /** 알림을 유발한 사용자 (본인에게는 알림을 보내지 않는다) */
  actorId?: string;
}

/** 인앱 알림 생성 공통 서비스. 이메일은 SMTP 활성화 시 워커가 발송 */
@Injectable()
export class NotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async send(input: NotifyInput, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
    if (recipients.length === 0) return;
    const created = await Promise.all(
      recipients.map((userId) =>
        tx.notification.create({
          data: {
            organizationId: input.organizationId,
            userId,
            type: input.type,
            title: input.title.slice(0, 200),
            body: input.body?.slice(0, 1000),
            link: input.link,
            entityType: input.entityType,
            entityId: input.entityId,
          },
          select: { id: true },
        }),
      ),
    );
    for (const n of created) void this.queue.enqueueEmail(n.id);
  }
}

@Global()
@Module({ providers: [NotifyService], exports: [NotifyService] })
export class NotifyModule {}
