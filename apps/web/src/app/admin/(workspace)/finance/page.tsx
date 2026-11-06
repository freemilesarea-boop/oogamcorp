'use client';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { FinanceGate, FinanceNotice } from '@/features/finance/common';
import { FinanceDashboardView } from '@/features/finance/dashboard';

export default function FinanceDashboardPage() {
  return (
    <>
      <PageHeader
        title="재무 대시보드"
        description="수입·지출 실적, 예산 집행률, 사업 구분·프로젝트별 현황"
        actions={
          <>
            <Button variant="outline" asChild><Link href="/admin/finance/budgets">예산</Link></Button>
            <Button variant="outline" asChild><Link href="/admin/finance/transactions">거래</Link></Button>
          </>
        }
      />
      <FinanceNotice />
      <FinanceGate><FinanceDashboardView /></FinanceGate>
    </>
  );
}
