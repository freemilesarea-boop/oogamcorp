import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BusinessUnitsService } from './business-units.service';
import { FinanceDashboardService } from './dashboard.service';
import { FinanceController } from './finance.controller';
import { FinanceRepository } from './finance.repository';
import { TransactionsService } from './transactions.service';

/** 재무 관리: 사업 구분, 예산(편성·승인·집행), 거래(수입·지출), 대시보드 */
@Module({
  controllers: [FinanceController],
  providers: [FinanceRepository, BusinessUnitsService, BudgetsService, TransactionsService, FinanceDashboardService],
  exports: [BudgetsService, TransactionsService],
})
export class FinanceModule {}
