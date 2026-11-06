import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AdminProviders } from '@/components/providers';

/** 요청별 CSP nonce 적용을 위해 관리자 영역은 동적 렌더링 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'OOGAM Workspace', template: '%s · OOGAM Workspace' },
  robots: { index: false, follow: false },
};

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // 미들웨어가 생성한 CSP nonce — next-themes 의 깜빡임 방지 인라인 스크립트에 부여
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <AdminProviders nonce={nonce}>{children}</AdminProviders>;
}
