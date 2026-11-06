import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

/** 일정·참석자·응답 + 업무 마감일 오버레이. 반복 일정(RRULE)은 저장만 하며 전개는 후속 구현 */
@Module({
  imports: [ProjectsModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
