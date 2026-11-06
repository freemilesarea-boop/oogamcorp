import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** 공지사항: 전사/부서/프로젝트 범위, 고정, 읽음 상태, 대상자 알림 */
@Module({ controllers: [AnnouncementsController], providers: [AnnouncementsService], exports: [AnnouncementsService] })
export class AnnouncementsModule {}
