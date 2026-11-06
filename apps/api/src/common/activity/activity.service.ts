import { Global, Injectable, Module } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 업무 도메인 활동/변경 이력 (프로젝트 활동 로그, 업무 변경 이력 등) */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    params: {
      organizationId: string;
      entityType: EntityType;
      entityId: string;
      action: string;
      actorId?: string | null;
      changes?: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    return tx.activityLog.create({
      data: { ...params, changes: (params.changes ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }

  list(organizationId: string, entityType: EntityType, entityId: string, take = 50) {
    return this.prisma.activityLog.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** 두 객체 간 변경 필드만 추출 */
  static diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const prev = before[k];
      const a = prev instanceof Date ? prev.toISOString() : prev;
      const b = v instanceof Date ? (v as Date).toISOString() : v;
      if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a ?? null, to: b ?? null };
    }
    return out;
  }
}

@Global()
@Module({ providers: [ActivityService], exports: [ActivityService] })
export class ActivityModule {}
