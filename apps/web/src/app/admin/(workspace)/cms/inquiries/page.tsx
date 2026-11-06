import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { InquiriesManager } from '@/features/cms/inquiries-manager';

export const metadata: Metadata = { title: '문의 접수 · CMS' };

export default function Page() {
  return <Suspense fallback={<LoadingRows />}><InquiriesManager /></Suspense>;
}
