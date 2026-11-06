import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { BrandsManager } from '@/features/cms/brands-manager';

export const metadata: Metadata = { title: '브랜드 · CMS' };

export default function Page() {
  return <Suspense fallback={<LoadingRows />}><BrandsManager /></Suspense>;
}
