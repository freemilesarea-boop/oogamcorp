import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { BudgetsService } from './budgets.service';
import { BusinessUnitsService } from './business-units.service';
import { FinanceDashboardService } from './dashboard.service';
import {
  ApproveBudgetDto, BudgetLineOptionsQueryDto, BudgetQueryDto, BusinessUnitQueryDto, CreateBudgetDto, CreateBusinessUnitDto,
  CreateTransactionDto, DashboardQueryDto, ReasonDto, SetAllocationsDto, TransactionQueryDto, UpdateBudgetDto, UpdateBusinessUnitDto,
  UpdateTransactionDto,
} from './dto/finance.dto';
import { TransactionsService } from './transactions.service';

/**
 * 재무 관리 API (내부 관리용 — 법정 회계·세무 시스템을 대체하지 않음).
 * 모든 엔드포인트는 finance.read 이상이 필요하며, 등록/수정은 finance.write, 승인은 finance.approve.
 * 메서드 단위 @RequirePermissions 는 클래스 단위를 대체하므로 finance.read 를 함께 명시한다.
 */
@ApiTags('Finance')
@RequirePermissions('finance.read')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly units: BusinessUnitsService,
    private readonly budgets: BudgetsService,
    private readonly txs: TransactionsService,
    private readonly dashboard: FinanceDashboardService,
  ) {}

  // ───────────── 대시보드 ─────────────
  @Get('dashboard')
  getDashboard(@CurrentUser() u: AuthContext, @Query() q: DashboardQueryDto) {
    return this.dashboard.get(u, q.year);
  }

  // ───────────── 사업 구분 ─────────────
  @Get('business-units')
  listUnits(@CurrentUser() u: AuthContext, @Query() q: BusinessUnitQueryDto) {
    return this.units.list(u, q);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Post('business-units')
  createUnit(@CurrentUser() u: AuthContext, @Body() dto: CreateBusinessUnitDto) {
    return this.units.create(u, dto);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Patch('business-units/:id')
  updateUnit(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBusinessUnitDto) {
    return this.units.update(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Delete('business-units/:id')
  removeUnit(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.units.remove(u, id);
  }

  // ───────────── 예산 ─────────────
  @Get('budgets')
  listBudgets(@CurrentUser() u: AuthContext, @Query() q: BudgetQueryDto) {
    return this.budgets.list(u, q);
  }

  @Get('budget-lines')
  budgetLines(@CurrentUser() u: AuthContext, @Query() q: BudgetLineOptionsQueryDto) {
    return this.budgets.lineOptions(u, q);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Post('budgets')
  createBudget(@CurrentUser() u: AuthContext, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(u, dto);
  }

  @Get('budgets/:id')
  getBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.get(u, id);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Patch('budgets/:id')
  updateBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Delete('budgets/:id')
  removeBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.remove(u, id);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Post('budgets/:id/submit')
  submitBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.submit(u, id);
  }

  @RequirePermissions('finance.read', 'finance.approve')
  @Post('budgets/:id/approve')
  approveBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveBudgetDto) {
    return this.budgets.approve(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.approve')
  @Post('budgets/:id/return')
  returnBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.budgets.returnToDraft(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.approve')
  @Post('budgets/:id/close')
  closeBudget(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.close(u, id);
  }

  // ───────────── 거래 ─────────────
  @Get('transactions')
  listTransactions(@CurrentUser() u: AuthContext, @Query() q: TransactionQueryDto) {
    return this.txs.list(u, q);
  }

  @Get('transactions/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="oogam-transactions.csv"')
  @Header('Cache-Control', 'no-store')
  exportTransactions(@CurrentUser() u: AuthContext, @Query() q: TransactionQueryDto) {
    return this.txs.exportCsv(u, q);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Post('transactions')
  createTransaction(@CurrentUser() u: AuthContext, @Body() dto: CreateTransactionDto) {
    return this.txs.create(u, dto);
  }

  @Get('transactions/:id')
  getTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.txs.get(u, id);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Patch('transactions/:id')
  updateTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransactionDto) {
    return this.txs.update(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Delete('transactions/:id')
  removeTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.txs.remove(u, id);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Put('transactions/:id/allocations')
  setAllocations(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAllocationsDto) {
    return this.txs.setAllocations(u, id, dto);
  }

  @RequirePermissions('finance.read', 'finance.write')
  @Post('transactions/:id/submit')
  submitTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.txs.submit(u, id);
  }

  @RequirePermissions('finance.read', 'finance.approve')
  @Post('transactions/:id/approve')
  approveTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.txs.approve(u, id);
  }

  @RequirePermissions('finance.read', 'finance.approve')
  @Post('transactions/:id/reject')
  rejectTransaction(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.txs.reject(u, id, dto);
  }
}
