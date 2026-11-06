import type { Metadata } from 'next';
import { CmsOverview } from '@/features/cms/overview';

export const metadata: Metadata = { title: '홈페이지 CMS' };

export default function Page() {
  return <CmsOverview />;
}
