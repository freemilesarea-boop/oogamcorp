'use client';
import { Suspense } from 'react';
import { LoadingRows, PageHeader } from '@/components/admin/states';
import { ApprovalsView } from '@/features/approvals/approvals-view';

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader title="전자결재" description="품의·지출 결의·예산 승인 등 결재 요청과 처리. 결재선 순서대로 진행됩니다." />
      <Suspense fallback={<LoadingRows />}><ApprovalsView /></Suspense>
    </>
  );
}
