import { Module } from '@nestjs/common';
import { AuditLogsController, AuditLogsService } from './audit-logs.controller';

/** 감사 로그 조회 (audit.read) — 기록은 common/audit 의 AuditService */
@Module({ controllers: [AuditLogsController], providers: [AuditLogsService] })
export class AuditLogsModule {}
