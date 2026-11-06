import { Module } from '@nestjs/common';
import { DocumentAccessService } from './document-access.service';
import { DocumentSharingService } from './document-sharing.service';
import { DocumentVersionsService } from './document-versions.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/** 문서(위키) — 페이지 트리, 자동 저장, 버전, 휴지통, 공유. 실시간 협업은 src/collab.ts (별도 프로세스) */
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentVersionsService, DocumentSharingService, DocumentAccessService],
  exports: [DocumentAccessService],
})
export class DocumentsModule {}
