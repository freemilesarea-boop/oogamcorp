import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/** 부서(팀) 관리: 계층 구조, 부서장, 구성원 배치 */
@Module({ controllers: [TeamsController], providers: [TeamsService] })
export class TeamsModule {}
