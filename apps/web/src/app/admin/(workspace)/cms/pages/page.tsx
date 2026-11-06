import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { PagesEditor } from '@/features/cms/pages-editor';

export const metadata: Metadata = { title: '고정 페이지 · CMS' };

export default function Page() {
  return <Suspense fallback={<LoadingRows />}><PagesEditor /></Suspense>;
}
