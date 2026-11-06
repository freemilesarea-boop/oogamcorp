import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function StatCard({ label, value, hint, icon: Icon, href, tone }: { label: string; value: number | string; hint?: string; icon: LucideIcon; href?: string; tone?: 'danger' | 'default' }) {
  const body = (
    <Card className={cn('group h-full p-4 transition-colors', href && 'hover:border-foreground/30')}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs font-medium">{label}</span>
        <Icon className="size-4" strokeWidth={1.75} />
      </div>
      <p className={cn('mt-2 text-3xl font-semibold tracking-tight tabular-nums', tone === 'danger' && Number(value) > 0 && 'text-danger')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 rounded-lg">{body}</Link> : body;
}

export function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="flex-1 px-2 pb-3">{children}</div>
    </Card>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

const krw = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

/** Decimal 문자열 → 원 단위 표시 (표시 목적 변환만, 계산은 서버 Decimal) */
export function formatKrw(v: string): string {
  const neg = v.startsWith('-');
  const int = v.replace('-', '').split('.')[0];
  return `${neg ? '-' : ''}₩${krw.format(BigInt(int || "0"))}`;
}

export function MoneyCard({ label, value, previous, invert }: { label: string; value: string; previous: string; invert?: boolean }) {
  const cur = Number(value);
  const prev = Number(previous);
  const diff = prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;
  const up = diff !== null && diff >= 0;
  const good = invert ? !up : up;
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{formatKrw(value)}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {diff === null ? '전월 데이터 없음' : (
          <>
            <span className={cn('inline-flex items-center', good ? 'text-success' : 'text-danger')}>
              {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(diff).toFixed(1)}%
            </span>
            전월 대비 ({formatKrw(previous)})
          </>
        )}
      </p>
    </Card>
  );
}
