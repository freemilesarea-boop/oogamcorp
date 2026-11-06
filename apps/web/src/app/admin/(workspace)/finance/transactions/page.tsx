'use client';
import { Suspense } from 'react';
import { LoadingRows, PageHeader } from '@/components/admin/states';
import { FinanceGate, FinanceNotice } from '@/features/finance/common';
import { TransactionsView } from '@/features/finance/transactions-view';

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="수입·지출 거래" description="거래 등록, 부가세 자동 계산, 증빙 첨부, 예산 배분, 승인/반려 (등록자 본인 승인 불가)" />
      <FinanceNotice />
      <FinanceGate>
        <Suspense fallback={<LoadingRows />}><TransactionsView /></Suspense>
      </FinanceGate>
    </>
  );
}
