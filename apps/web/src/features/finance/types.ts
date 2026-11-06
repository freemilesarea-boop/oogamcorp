export type BudgetStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED';
export type BudgetPeriod = 'ANNUAL' | 'QUARTERLY';
export type TxType = 'REVENUE' | 'EXPENSE';
export type TxStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Ref { id: string; name: string }
export interface UserRef { id: string; name: string; email: string }

export interface BusinessUnit {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  _count?: { budgets: number; transactions: number };
}

export interface BudgetLine {
  id: string;
  category: string;
  description: string | null;
  position: number;
  plannedAmount: string;
  approvedAmount: string;
  executedAmount: string;
  remainingAmount: string;
  executionRate: number;
}

export interface Budget {
  id: string;
  name: string;
  fiscalYear: number;
  period: BudgetPeriod;
  quarter: number | null;
  status: BudgetStatus;
  notes: string | null;
  departmentId: string | null;
  department: Ref | null;
  projectId: string | null;
  project?: { id: string; key: string; name: string } | null;
  businessUnitId: string | null;
  businessUnit: (Ref & { code: string }) | null;
  plannedAmount: string;
  approvedAmount: string;
  executedAmount: string;
  remainingAmount: string;
  executionRate: number;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: BudgetLine[];
  createdBy?: UserRef | null;
  approvedBy?: UserRef | null;
}

export interface Allocation {
  id: string;
  budgetLineId: string;
  amount: string;
  budgetLine: { id: string; category: string; budget: { id: string; name: string; fiscalYear: number } };
}

export interface Transaction {
  id: string;
  txDate: string;
  type: TxType;
  status: TxStatus;
  businessUnitId: string | null;
  businessUnit: (Ref & { code: string }) | null;
  projectId: string | null;
  project: { id: string; key: string; name: string } | null;
  departmentId: string | null;
  department: Ref | null;
  counterparty: string | null;
  description: string;
  supplyAmount: string;
  vatAmount: string;
  totalAmount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  evidenceFileId: string | null;
  evidenceFile?: { id: string; originalName: string; mimeType: string; size: number } | null;
  approvalRequestId: string | null;
  createdById: string;
  createdBy: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  canApprove: boolean;
  allocations: Allocation[];
}

export interface BudgetLineOption {
  id: string;
  category: string;
  budget: { id: string; name: string; fiscalYear: number; period: BudgetPeriod; quarter: number | null };
  approvedAmount: string;
  executedAmount: string;
  remainingAmount: string;
}

export interface FinanceDashboard {
  year: number;
  basis: string;
  totals: { revenue: string; expense: string; profit: string; pendingExpenseCount: number; pendingExpenseAmount: string };
  budget: { count: number; planned: string; approved: string; executed: string; remaining: string; executionRate: number };
  monthly: { month: number; revenue: string; expense: string }[];
  byBusinessUnit: { id: string | null; name: string; code: string | null; revenue: string; expense: string; profit: string }[];
  byProject: { id: string; name: string; key: string | null; cost: string; count: number; budgetApproved: string | null; budgetExecuted: string | null }[];
  pendingExpenses: { id: string; txDate: string; description: string; counterparty: string | null; totalAmount: string; businessUnit: Ref | null; createdBy: UserRef | null }[];
}

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  DRAFT: '작성 중', PENDING_APPROVAL: '승인 대기', APPROVED: '승인', CLOSED: '마감',
};
export const TX_STATUS_LABELS: Record<TxStatus, string> = { DRAFT: '작성 중', PENDING: '승인 대기', APPROVED: '승인', REJECTED: '반려' };
export const TX_TYPE_LABELS: Record<TxType, string> = { REVENUE: '수입', EXPENSE: '지출' };
