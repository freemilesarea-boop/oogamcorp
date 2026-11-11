import type { Metadata } from 'next';
import { BusinessAreasManager } from '@/features/cms/business-areas-manager';

export const metadata: Metadata = { title: '사업 영역 · CMS' };

export default function Page() {
  return <BusinessAreasManager />;
}
