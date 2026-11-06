'use client';
import { PageHeader } from '@/components/admin/states';
import { BudgetsView } from '@/features/finance/budgets-view';
import { FinanceGate, FinanceNotice } from '@/features/finance/common';

export default function BudgetsPage() {
  return (
    <>
      <PageHeader title="예산 관리" description="예산 편성 → 승인 → 집행. 승인 금액과 집행(승인된 지출 배분) 금액은 별도로 관리됩니다." />
      <FinanceNotice />
      <FinanceGate><BudgetsView /></FinanceGate>
    </>
  );
}
