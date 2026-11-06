import { Module } from '@nestjs/common';
import { NotificationsController, NotificationsService } from './notifications.controller';

/** 인앱 알림 (생성은 common/notify 의 NotifyService, 이메일 발송은 워커) */
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
