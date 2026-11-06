import type { Metadata } from 'next';
import { AdminProviders } from '@/components/providers';

/** 요청별 CSP nonce 적용을 위해 관리자 영역은 동적 렌더링 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'OOGAM Workspace', template: '%s · OOGAM Workspace' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminProviders>{children}</AdminProviders>;
}
