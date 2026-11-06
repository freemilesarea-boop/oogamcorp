'use client';
import { formatKRW } from '@oogam/shared';
import { Info } from 'lucide-react';
import { ErrorState } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BUDGET_STATUS_LABELS, TX_STATUS_LABELS, TX_TYPE_LABELS, type BudgetStatus, type TxStatus, type TxType } from './types';

/** 금액 문자열 → ₩ 표기 (형식 오류 시 원문 표시) */
export function krw(amount: string | null | undefined): string {
  if (amount == null) return '-';
  try {
    return formatKRW(amount);
  } catch {
    return amount;
  }
}

export function Money({ value, className, signed }: { value: string | null | undefined; className?: string; signed?: boolean }) {
  const neg = !!value && value.startsWith('-');
  return <span className={cn('tabular-nums', signed && neg && 'text-danger', className)}>{krw(value)}</span>;
}

/** 재무 화면 공통 고지 */
export function FinanceNotice() {
  return (
    <p className="mb-5 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" aria-hidden />
      내부 관리용 — 법정 회계·세무 시스템을 대체하지 않습니다.
    </p>
  );
}

/** finance.read 없는 사용자에게는 권한 안내만 표시 (서버도 403 으로 강제) */
export function FinanceGate({ children }: { children: React.ReactNode }) {
  const can = useCan();
  if (!can('finance.read')) return <ErrorState error={new ApiError(403, '재무 정보 열람 권한이 없습니다.')} />;
  return <>{children}</>;
}

export function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  const v = { DRAFT: 'muted', PENDING_APPROVAL: 'warning', APPROVED: 'success', CLOSED: 'outline' } as const;
  return <Badge variant={v[status]}>{BUDGET_STATUS_LABELS[status]}</Badge>;
}

export function TxStatusBadge({ status }: { status: TxStatus }) {
  const v = { DRAFT: 'muted', PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;
  return <Badge variant={v[status]}>{TX_STATUS_LABELS[status]}</Badge>;
}

export function TxTypeBadge({ type }: { type: TxType }) {
  return <Badge variant={type === 'REVENUE' ? 'default' : 'outline'}>{TX_TYPE_LABELS[type]}</Badge>;
}

/** 승인 금액 대비 집행 막대 (100% 초과 시 경고 표시) */
export function ExecutionBar({ executed, approved, rate, className }: { executed: string; approved: string; rate: number; className?: string }) {
  const over = rate > 100;
  return (
    <div className={cn('space-y-1', className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={rate}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`집행률 ${rate}%`}
      >
        <div className={cn('h-full rounded-full', over ? 'bg-danger' : 'bg-foreground')} style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>집행 {krw(executed)}</span>
        <span className={cn(over && 'font-medium text-danger')}>{rate}% / {krw(approved)}</span>
      </div>
    </div>
  );
}

export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;

/** 입력값 정리: 콤마 제거 */
export const cleanAmount = (s: string) => s.replace(/,/g, '').trim();
