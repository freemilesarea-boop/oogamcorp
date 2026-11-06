import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config/configuration';
import { ActivityModule } from './common/activity/activity.service';
import { AuditModule } from './common/audit/audit.service';
import { AuthCoreModule } from './common/auth/auth-core.module';
import { AuthGuard } from './common/auth/auth.guard';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { NotifyModule } from './common/notify/notify.service';
import { PrismaModule } from './common/prisma/prisma.service';
import { QueueModule } from './common/queue/queue.service';
import { RedisModule } from './common/redis/redis.service';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CmsModule } from './modules/cms/cms.module';
import { CommentsModule } from './modules/comments/comments.module';
import { EntityAccessModule } from './modules/access/entity-access.service';
import { DirectoryModule } from './modules/directory/directory.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DatabasesModule } from './modules/databases/databases.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { FilesModule } from './modules/files/files.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PublicSiteModule } from './modules/public-site/public-site.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TeamsModule } from './modules/teams/teams.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

const cfg = loadConfig();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: cfg.logLevel,
        genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
        redact: { paths: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers.authorization', 'res.headers["set-cookie"]'], remove: true },
        autoLogging: { ignore: (req) => (req.url ?? '').includes('/health') },
        transport: cfg.env === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        quietReqLogger: true,
        enabled: cfg.env !== 'test',
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: cfg.env === 'test' ? 10_000 : 300 }]),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthCoreModule,
    AuditModule,
    ActivityModule,
    NotifyModule,
    HealthModule,
    AuthModule,
    EntityAccessModule,
    DirectoryModule,
    EmployeesModule,
    TeamsModule,
    WorkspacesModule,
    DocumentsModule,
    CommentsModule,
    FilesModule,
    NotificationsModule,
    AnnouncementsModule,
    DatabasesModule,
    ProjectsModule,
    CalendarModule,
    ApprovalsModule,
    FinanceModule,
    CmsModule,
    PublicSiteModule,
    AuditLogsModule,
    SettingsModule,
    SearchModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
