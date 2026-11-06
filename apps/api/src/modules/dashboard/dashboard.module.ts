import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/decorators';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** 개인 대시보드. 재무 KPI 는 finance.read 보유자에게만 포함된다 */
  @Get()
  get(@CurrentUser() u: AuthContext) {
    return this.dashboard.get(u);
  }
}

@Module({ imports: [AnnouncementsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
