import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/** 파일 업로드/다운로드 (local / S3 호환 스토리지). 다운로드마다 접근 권한을 확인한다 */
@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
