import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { PostsManager } from '@/features/cms/posts-manager';

export const metadata: Metadata = { title: '뉴스·채용 · CMS' };

export default function Page() {
  return <Suspense fallback={<LoadingRows />}><PostsManager /></Suspense>;
}
