import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsService } from './approvals.service';

/** 전자결재: 결재 요청·결재선·승인/반려/보완 요청·재상신·취소 (지출 결의·예산 승인 연동) */
@Module({
  imports: [FinanceModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsRepository, ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
