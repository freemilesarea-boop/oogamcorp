import { AdminShell } from '@/components/admin/shell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
