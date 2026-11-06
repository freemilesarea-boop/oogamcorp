import type { Metadata } from 'next';
import { AdminProviders } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'OOGAM Workspace', template: '%s · OOGAM Workspace' },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminProviders>{children}</AdminProviders>;
}
