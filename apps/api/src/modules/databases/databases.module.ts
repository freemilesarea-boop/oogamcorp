import { Module } from '@nestjs/common';
import { DatabasesController } from './databases.controller';
import { DatabasesService } from './databases.service';
import { RowsService } from './rows.service';

/** Notion 형 사용자 정의 데이터베이스 (속성·행·뷰·CSV) */
@Module({
  controllers: [DatabasesController],
  providers: [DatabasesService, RowsService],
  exports: [DatabasesService],
})
export class DatabasesModule {}
