import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** 역할·권한 정책, 모듈 권한 명시 부여, 시스템 설정 */
@Module({ controllers: [SettingsController], providers: [SettingsService] })
export class SettingsModule {}
