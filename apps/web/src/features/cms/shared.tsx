'use client';
import { CONTENT_STATUS_LABELS, type ContentStatus } from '@oogam/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function useCmsPerms() {
  const can = useCan();
  return { canRead: can('cms.read'), canWrite: can('cms.write'), canPublish: can('cms.publish'), canInquiries: can('cms.inquiries') };
}

const STATUS_VARIANT: Record<ContentStatus, 'muted' | 'warning' | 'success' | 'outline'> = {
  DRAFT: 'muted', REVIEW: 'warning', PUBLISHED: 'success', ARCHIVED: 'outline',
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{CONTENT_STATUS_LABELS[status]}</Badge>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status === 403 ? `권한이 없습니다. ${e.message}` : e.message;
  return (e as Error)?.message ?? '요청에 실패했습니다.';
}

/** CMS 변경 공통: 성공 시 cms 쿼리 무효화 + 토스트 */
export function useCmsMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, success?: string | ((r: TRes) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['cms'] });
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

interface Action {
  to: ContentStatus;
  label: string;
  perm: 'write' | 'publish';
  variant?: 'default' | 'outline' | 'ghost';
}

/** 상태 워크플로 (서버 규칙과 동일): 편집자 DRAFT↔REVIEW, 게시 승인자 게시/중단/보관 */
const ACTIONS: Record<ContentStatus, Action[]> = {
  DRAFT: [
    { to: 'REVIEW', label: '검토 요청', perm: 'write', variant: 'outline' },
    { to: 'PUBLISHED', label: '게시', perm: 'publish', variant: 'default' },
    { to: 'ARCHIVED', label: '보관', perm: 'publish', variant: 'ghost' },
  ],
  REVIEW: [
    { to: 'PUBLISHED', label: '승인·게시', perm: 'publish', variant: 'default' },
    { to: 'DRAFT', label: '초안으로', perm: 'write', variant: 'outline' },
    { to: 'ARCHIVED', label: '보관', perm: 'publish', variant: 'ghost' },
  ],
  PUBLISHED: [
    { to: 'DRAFT', label: '게시 중단', perm: 'publish', variant: 'outline' },
    { to: 'ARCHIVED', label: '보관', perm: 'publish', variant: 'ghost' },
  ],
  ARCHIVED: [{ to: 'DRAFT', label: '보관 해제', perm: 'publish', variant: 'outline' }],
};

export function WorkflowActions({
  status, onChange, pending, size = 'sm', className,
}: { status: ContentStatus; onChange: (to: ContentStatus) => void; pending?: boolean; size?: 'sm' | 'default'; className?: string }) {
  const { canWrite, canPublish } = useCmsPerms();
  const actions = ACTIONS[status].filter((a) => (a.perm === 'write' ? canWrite : canPublish));
  if (!actions.length) {
    return status === 'REVIEW' || status === 'PUBLISHED'
      ? <span className={cn('text-xs text-muted-foreground', className)}>{status === 'REVIEW' ? '게시 승인 대기' : '게시 권한자만 변경 가능'}</span>
      : null;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {actions.map((a) => (
        <Button key={a.to} type="button" size={size} variant={a.variant} disabled={pending} onClick={() => onChange(a.to)}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}

export function WarningBanner({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={cn('flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100', className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 빈 문자열 → null (선택 필드 초기화) */
export const nn = (v: string | undefined | null) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());

/** 게시 중인 항목을 편집자가 수정하려 할 때 안내 */
export function PublishedLockNotice({ status }: { status: ContentStatus }) {
  const { canPublish } = useCmsPerms();
  if (status !== 'PUBLISHED' || canPublish) return null;
  return (
    <WarningBanner title="게시 중인 콘텐츠입니다">
      게시 중인 콘텐츠는 게시 승인 권한(cms.publish)이 있어야 수정할 수 있습니다. 수정이 필요하면 게시 승인자에게 게시 중단을 요청하세요.
    </WarningBanner>
  );
}
