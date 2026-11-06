'use client';
import { useQuery } from '@tanstack/react-query';
import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, APPROVAL_TYPE_LABELS, type ApprovalType, type Priority, type ProjectStatus } from '@oogam/shared';
import { AlarmClock, Bell, CalendarClock, CheckSquare, FileText, Pin, Stamp } from 'lucide-react';
import Link from 'next/link';
import { ErrorState } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/misc';
import { apiGet } from '@/lib/api';
import { useCan, useMe } from '@/lib/auth';
import { cn, formatDate, timeAgo } from '@/lib/utils';
import type { DashboardData } from '@/features/dashboard/types';
import { MoneyCard, Panel, PanelEmpty, StatCard } from '@/features/dashboard/widgets';

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date()).replace(/\D/g, ''));
  return h < 6 ? '늦은 시간까지 수고하셨습니다' : h < 12 ? '좋은 아침입니다' : h < 18 ? '좋은 오후입니다' : '오늘도 수고하셨습니다';
}

const todayIso = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export default function DashboardPage() {
  const me = useMe();
  const can = useCan();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => apiGet<DashboardData>('/dashboard'), refetchInterval: 120_000 });
  const d = q.data;
  const today = todayIso();

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date())}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting()}, {me.user.name}님</h1>
      </header>

      {q.error ? <ErrorState error={q.error} /> : !d ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
          <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72" />)}</div>
        </div>
      ) : (
        <>
          <section aria-label="요약" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="진행 중 업무" value={d.tasks.open} icon={CheckSquare} href="/admin/my-tasks" />
            <StatCard label="지연" value={d.tasks.overdue} icon={AlarmClock} tone="danger" hint="마감일 경과" href="/admin/my-tasks" />
            <StatCard label="오늘 마감" value={d.tasks.today} icon={CalendarClock} hint={`7일 내 ${d.tasks.week}건`} href="/admin/my-tasks" />
            <StatCard label="결재 대기" value={d.approvals.count} icon={Stamp} hint="내 차례" href="/admin/approvals" />
            <StatCard label="읽지 않은 알림" value={d.unreadNotifications} icon={Bell} href="/admin/notifications" />
          </section>

          {d.finance && can('finance.read') && (
            <section aria-label="재무 요약" className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold tracking-tight">이번 달 재무 <span className="ml-1 text-xs font-normal text-muted-foreground">{d.finance.month} · 승인 거래 기준</span></h2>
                <Link href="/admin/finance" className="text-xs text-muted-foreground hover:text-foreground">재무 대시보드 →</Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MoneyCard label="매출" value={d.finance.revenue} previous={d.finance.previous.revenue} />
                <MoneyCard label="지출" value={d.finance.expense} previous={d.finance.previous.expense} invert />
                <MoneyCard label="손익" value={d.finance.net} previous={d.finance.previous.net} />
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="내 업무" className="lg:col-span-2" action={<Link href="/admin/my-tasks" className="text-xs text-muted-foreground hover:text-foreground">전체 보기</Link>}>
              {d.tasks.upcoming.length === 0 ? <PanelEmpty>진행 중인 업무가 없습니다.</PanelEmpty> : (
                <ul>
                  {d.tasks.upcoming.map((t) => {
                    const due = t.dueDate?.slice(0, 10);
                    const overdue = !!due && due < today;
                    return (
                      <li key={t.id}>
                        <Link href={t.project ? `/admin/projects/${t.project.id}?task=${t.id}` : `/admin/my-tasks?task=${t.id}`} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/60">
                          <span className={cn('size-1.5 shrink-0 rounded-full', t.priority === 'URGENT' ? 'bg-danger' : t.priority === 'HIGH' ? 'bg-warning' : 'bg-gray-300 dark:bg-gray-600')} aria-label={PRIORITY_LABELS[t.priority as Priority]} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{t.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">{t.project ? `${t.project.key} · ${t.project.name}` : '개인 업무'}</span>
                          </span>
                          <span className={cn('shrink-0 text-xs tabular-nums', overdue ? 'font-medium text-danger' : due === today ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                            {!due ? '기한 없음' : due === today ? '오늘' : formatDate(t.dueDate, { month: 'numeric', day: 'numeric' })}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="결재 대기" action={d.approvals.count > 0 ? <Badge variant="default">{d.approvals.count}</Badge> : undefined}>
              {d.approvals.items.length === 0 ? <PanelEmpty>처리할 결재가 없습니다.</PanelEmpty> : (
                <ul>
                  {d.approvals.items.map((a) => (
                    <li key={a.stepId}>
                      <Link href={`/admin/approvals?id=${a.id}`} className="block rounded-md px-3 py-2 hover:bg-muted/60">
                        <span className="block truncate text-sm">{a.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {APPROVAL_TYPE_LABELS[a.type as ApprovalType] ?? a.type} · {a.requester?.name ?? '-'}{a.submittedAt ? ` · ${timeAgo(a.submittedAt)}` : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {can('projects.read') && (
              <Panel title="내 프로젝트" className="lg:col-span-2" action={<Link href="/admin/projects" className="text-xs text-muted-foreground hover:text-foreground">전체 보기</Link>}>
                {d.projects.length === 0 ? <PanelEmpty>참여 중인 프로젝트가 없습니다.</PanelEmpty> : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {d.projects.map((p) => (
                      <li key={p.id}>
                        <Link href={`/admin/projects/${p.id}`} className="block rounded-md px-3 py-2.5 hover:bg-muted/60">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium"><span className="mr-1.5 font-mono text-xs text-muted-foreground">{p.key}</span>{p.name}</span>
                            <Badge variant="muted">{PROJECT_STATUS_LABELS[p.status as ProjectStatus] ?? p.status}</Badge>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} 진행률`}>
                              <div className="h-full rounded-full bg-foreground" style={{ width: `${p.progress}%` }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{p.progress}%</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">미완료 업무 {p._count.tasks} · {p.endDate ? `마감 ${formatDate(p.endDate)}` : '마감일 없음'}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {can('announcements.read') && (
              <Panel title="공지" action={<Link href="/admin/announcements" className="text-xs text-muted-foreground hover:text-foreground">전체 보기</Link>}>
                {d.announcements.length === 0 ? <PanelEmpty>새 공지가 없습니다.</PanelEmpty> : (
                  <ul>
                    {d.announcements.map((a) => (
                      <li key={a.id}>
                        <Link href={`/admin/announcements?id=${a.id}`} className="flex items-start gap-2 rounded-md px-3 py-2 hover:bg-muted/60">
                          <span className="mt-1.5 flex w-1.5 shrink-0">{!a.read && <span className="size-1.5 rounded-full bg-accent" aria-label="읽지 않음" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('flex items-center gap-1 truncate text-sm', !a.read && 'font-medium')}>{a.pinned && <Pin className="size-3 shrink-0" aria-label="고정" />}{a.title}</span>
                            <span className="block text-xs text-muted-foreground">{a.author?.name ?? '-'} · {timeAgo(a.publishedAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {can('docs.read') && (
              <Panel title="최근 문서" className="lg:col-span-3" action={<Link href="/admin/docs" className="text-xs text-muted-foreground hover:text-foreground">문서로 이동</Link>}>
                {d.documents.length === 0 ? <PanelEmpty>최근 작성하거나 수정한 문서가 없습니다.</PanelEmpty> : (
                  <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {d.documents.map((doc) => (
                      <li key={doc.id}>
                        <Link href={`/admin/docs/${doc.id}`} className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-muted/60">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-sm">{doc.icon || <FileText className="size-3.5 text-muted-foreground" />}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{doc.title || '제목 없음'}</span>
                            <span className="block text-xs text-muted-foreground">{timeAgo(doc.updatedAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}
