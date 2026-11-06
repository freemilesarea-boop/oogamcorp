'use client';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/admin/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { useFinanceDashboard } from './api';
import { ExecutionBar, krw, Money } from './common';

const FG = 'var(--fg)';
const MUTED = 'var(--muted-fg)';

/** 축 눈금: 만/억 단위 축약 (표시 전용) */
function shortKRW(v: number) {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1).replace(/\.0$/, '')}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
  return v.toLocaleString('ko-KR');
}

function ChartTooltip({ active, payload, label, labelSuffix = '' }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: Record<string, string> }[]; label?: string | number; labelSuffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{label}{labelSuffix}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 tabular-nums">
          <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium">{krw(p.payload[p.name === '수입' ? 'revenueRaw' : p.name === '지출' ? 'expenseRaw' : 'costRaw'])}</span>
        </p>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub, signed }: { label: string; value: string; sub?: React.ReactNode; signed?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight"><Money value={value} signed={signed} /></p>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function FinanceDashboardView() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, isLoading, error } = useFinanceDashboard(year);
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);

  const monthly = (data?.monthly ?? []).map((m) => ({
    label: `${m.month}월`,
    수입: Number(m.revenue),
    지출: Number(m.expense),
    revenueRaw: m.revenue,
    expenseRaw: m.expense,
  }));
  const hasMonthly = monthly.some((m) => m.수입 !== 0 || m.지출 !== 0);
  const units = (data?.byBusinessUnit ?? []).map((u) => ({ label: u.name, 수입: Number(u.revenue), 지출: Number(u.expense), revenueRaw: u.revenue, expenseRaw: u.expense }));
  const hasUnits = units.some((u) => u.수입 !== 0 || u.지출 !== 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{data?.basis ?? '승인된 거래, 부가세 포함 합계 기준'}</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">회계연도</span>
          <NativeSelect value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" aria-label="회계연도">
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </NativeSelect>
        </label>
      </div>

      {error ? <ErrorState error={error} /> : isLoading || !data ? <LoadingRows rows={6} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="총 수입" value={data.totals.revenue} />
            <Kpi label="총 지출" value={data.totals.expense} />
            <Kpi label="수지" value={data.totals.profit} signed />
            <Kpi
              label="승인 대기 지출"
              value={data.totals.pendingExpenseAmount}
              sub={<>{data.totals.pendingExpenseCount}건 · <Link href="/admin/finance/transactions?status=PENDING&type=EXPENSE" className="underline underline-offset-2">확인하기</Link></>}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>예산 집행률</CardTitle>
              <CardDescription>
                {data.year}년 승인 예산 {data.budget.count}건 · 편성 {krw(data.budget.planned)} · 잔액 {krw(data.budget.remaining)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.budget.count === 0
                ? <p className="text-sm text-muted-foreground">승인된 예산이 없습니다. <Link href="/admin/finance/budgets" className="underline underline-offset-2">예산 편성하기</Link></p>
                : <ExecutionBar executed={data.budget.executed} approved={data.budget.approved} rate={data.budget.executionRate} />}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>월별 수입·지출</CardTitle>
                <CardDescription>{data.year}년 1~12월</CardDescription>
              </CardHeader>
              <CardContent>
                {hasMonthly ? (
                  <div className="h-72" role="img" aria-label={`${data.year}년 월별 수입과 지출 막대 차트`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthly} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={MUTED} />
                        <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={MUTED} tickFormatter={shortKRW} width={56} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)' }} />
                        <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="수입" fill={FG} radius={[4, 4, 0, 0]} maxBarSize={14} />
                        <Bar dataKey="지출" fill={MUTED} radius={[4, 4, 0, 0]} maxBarSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="승인된 거래가 없습니다" description="거래가 승인되면 월별 추이가 표시됩니다." />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>사업 구분별 실적</CardTitle>
                <CardDescription>수입·지출·수지</CardDescription>
              </CardHeader>
              <CardContent>
                {hasUnits ? (
                  <>
                    <div className="h-56" role="img" aria-label="사업 구분별 수입과 지출 막대 차트">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={units} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke={MUTED} interval={0} />
                          <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={MUTED} tickFormatter={shortKRW} width={56} />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)' }} />
                          <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="수입" fill={FG} radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="지출" fill={MUTED} radius={[4, 4, 0, 0]} maxBarSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <Table className="mt-3">
                      <THead><TR><TH>사업 구분</TH><TH className="text-right">수입</TH><TH className="text-right">지출</TH><TH className="text-right">수지</TH></TR></THead>
                      <TBody>
                        {data.byBusinessUnit.map((u) => (
                          <TR key={u.id ?? 'none'}>
                            <TD>{u.name}</TD>
                            <TD className="text-right"><Money value={u.revenue} /></TD>
                            <TD className="text-right"><Money value={u.expense} /></TD>
                            <TD className="text-right font-medium"><Money value={u.profit} signed /></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </>
                ) : <EmptyState title="집계할 실적이 없습니다" />}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>프로젝트별 비용</CardTitle>
                <CardDescription>승인된 지출 상위 10개 · 연결 예산 대비</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byProject.length === 0 ? <EmptyState title="프로젝트에 연결된 지출이 없습니다" /> : (
                  <ul className="space-y-4">
                    {data.byProject.map((p) => (
                      <li key={p.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                          <Link href={`/admin/projects/${p.id}`} className="truncate hover:underline">
                            {p.key && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{p.key}</span>}{p.name}
                          </Link>
                          <span className="shrink-0 font-medium"><Money value={p.cost} /> <span className="text-xs font-normal text-muted-foreground">{p.count}건</span></span>
                        </div>
                        {p.budgetApproved && p.budgetExecuted && Number(p.budgetApproved) > 0 && (
                          <ExecutionBar
                            executed={p.budgetExecuted}
                            approved={p.budgetApproved}
                            rate={Math.round((Number(p.budgetExecuted) / Number(p.budgetApproved)) * 1000) / 10}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>미승인 지출</CardTitle>
                  <CardDescription>승인 대기 중인 지출 (오래된 순)</CardDescription>
                </div>
                <Link href="/admin/finance/transactions?status=PENDING&type=EXPENSE" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  전체 <ArrowRight className="size-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {data.pendingExpenses.length === 0 ? <EmptyState title="승인 대기 중인 지출이 없습니다" /> : (
                  <Table>
                    <THead><TR><TH>거래일</TH><TH>적요</TH><TH className="text-right">금액</TH></TR></THead>
                    <TBody>
                      {data.pendingExpenses.map((p) => (
                        <TR key={p.id}>
                          <TD className="whitespace-nowrap text-muted-foreground">{formatDate(p.txDate)}</TD>
                          <TD>
                            <Link href={`/admin/finance/transactions?id=${p.id}`} className="hover:underline">{p.description}</Link>
                            <p className="text-xs text-muted-foreground">{[p.counterparty, p.businessUnit?.name, p.createdBy?.name].filter(Boolean).join(' · ')}</p>
                          </TD>
                          <TD className="text-right"><Money value={p.totalAmount} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
