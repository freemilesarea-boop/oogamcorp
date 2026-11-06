import { AlertTriangle, Construction, Inbox } from 'lucide-react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: React.ReactNode; icon?: typeof Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <Icon className="mb-3 size-8 text-muted-foreground" strokeWidth={1.5} />
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  const message = status === 403 ? '이 화면에 접근할 권한이 없습니다. 필요한 경우 관리자에게 권한을 요청하세요.' : status === 404 ? '요청한 항목을 찾을 수 없습니다.' : (error as Error)?.message ?? '알 수 없는 오류';
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{status === 403 ? '접근 권한 없음' : '불러오지 못했습니다'}</p>
        <p className="mt-0.5 opacity-80">{message}</p>
      </div>
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

/**
 * 개발 상태 표시. 미완성 기능을 완성된 것처럼 보이지 않도록 명시한다.
 */
export function DevStatus({ status, children, links }: { status: 'PARTIAL' | 'SCAFFOLDED' | 'NOT_STARTED'; children: React.ReactNode; links?: { href: string; label: string }[] }) {
  const label = { PARTIAL: '부분 구현', SCAFFOLDED: '골격만 구현', NOT_STARTED: '미착수' }[status];
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <Construction className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">개발 상태: {label} ({status})</p>
        <div className="opacity-90">{children}</div>
        {links && (
          <div className="flex flex-wrap gap-3 pt-1">
            {links.map((l) => <Link key={l.href} href={l.href} className="underline underline-offset-2">{l.label}</Link>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <button className="rounded-md border border-border px-2.5 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onChange(page - 1)}>이전</button>
      <span className="tabular-nums text-muted-foreground">{page} / {totalPages}</span>
      <button className="rounded-md border border-border px-2.5 py-1 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>다음</button>
    </div>
  );
}
