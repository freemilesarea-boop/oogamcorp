import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';

export interface AuditEntry {
  action: string;
  organizationId?: string | null;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/** 보안·운영 감사 로그. 실패해도 본 요청을 깨뜨리지 않는다(로그만 남김). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          action: entry.action,
          organizationId: entry.organizationId ?? null,
          actorId: entry.actorId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: entry.ip,
          userAgent: entry.userAgent?.slice(0, 255),
        },
      });
    } catch (e) {
      this.logger.error(`감사 로그 기록 실패: ${(e as Error).message}`);
    }
  }

  forUser(auth: AuthContext, action: string, extra: Omit<AuditEntry, 'action' | 'organizationId' | 'actorId'> = {}, tx?: Prisma.TransactionClient) {
    return this.log({ action, organizationId: auth.organizationId, actorId: auth.userId, ...extra }, tx);
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
