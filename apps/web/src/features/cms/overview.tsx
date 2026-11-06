'use client';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fmtDateTime } from './shared';
import { INQUIRY_CATEGORY_LABELS, INQUIRY_STATUS_LABELS, POST_TYPE_LABELS, type Overview } from './types';

const KIND_LABEL = { brand: '브랜드', portfolio: '포트폴리오', post: '게시물', page: '페이지' } as const;

function CountCard({ title, href, counts }: { title: string; href: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Link href={href} className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{total}</p>
      <dl className="mt-4 grid grid-cols-4 gap-2 text-xs">
        {CONTENT_STATUSES.map((s) => (
          <div key={s}>
            <dt className="text-muted-foreground">{CONTENT_STATUS_LABELS[s]}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{counts[s] ?? 0}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

export function CmsOverview() {
  const q = useQuery({ queryKey: ['cms', 'overview'], queryFn: () => apiGet<Overview>('/cms/overview') });

  return (
    <>
      <PageHeader
        title="홈페이지 CMS"
        description="공개 홈페이지(oogam.co.kr) 콘텐츠를 관리합니다. 게시(PUBLISHED)된 콘텐츠만 공개 사이트에 노출됩니다."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="/" target="_blank" rel="noopener noreferrer"><ExternalLink /> 공개 사이트</a>
          </Button>
        }
      />
      {q.isLoading && <LoadingRows rows={6} />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <CountCard title="브랜드" href="/admin/cms/brands" counts={q.data.brands} />
            <CountCard title="포트폴리오" href="/admin/cms/brands?tab=portfolio" counts={q.data.portfolio} />
            {(['NEWS', 'INSIGHT', 'CAREER'] as const).map((t) => (
              <CountCard key={t} title={POST_TYPE_LABELS[t]} href={`/admin/cms/posts?type=${t}`} counts={q.data.posts[t]} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">{q.data.canPublish ? '게시 승인 대기' : '검토·게시 대기 항목'}</h2>
                <Badge variant={q.data.pending.length ? 'warning' : 'muted'}>{q.data.pending.length}</Badge>
              </div>
              {q.data.pending.length === 0 ? (
                <EmptyState title="대기 중인 항목이 없습니다." description="검토 요청(REVIEW)된 콘텐츠와 미게시 변경이 있는 페이지가 여기에 표시됩니다." />
              ) : (
                <ul className="divide-y divide-border">
                  {q.data.pending.map((p) => (
                    <li key={`${p.kind}-${p.id}`}>
                      <Link href={p.href} className="flex items-center justify-between gap-4 py-2.5 text-sm hover:opacity-80">
                        <span className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline">{p.kind === 'post' && p.postType ? POST_TYPE_LABELS[p.postType] : KIND_LABEL[p.kind]}</Badge>
                          <span className="truncate font-medium">{p.title}</span>
                          {p.kind === 'page' && <span className="text-xs text-muted-foreground">미게시 변경</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtDateTime(p.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">고정 페이지</h2>
                <Link href="/admin/cms/pages" className="text-xs text-muted-foreground hover:underline">편집</Link>
              </div>
              <ul className="space-y-2 text-sm">
                {q.data.pages.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/cms/pages?key=${p.key}`} className="truncate hover:underline">{p.title}</Link>
                    {!p.exists ? <Badge variant="muted">미작성</Badge>
                      : p.status !== 'PUBLISHED' ? <Badge variant="muted">비공개</Badge>
                      : p.hasUnpublishedChanges ? <Badge variant="warning">미게시 변경</Badge>
                      : <Badge variant="success">게시됨</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {q.data.inquiries && (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  최근 문의 {q.data.inquiries.newCount > 0 && <Badge variant="danger">신규 {q.data.inquiries.newCount}</Badge>}
                </h2>
                <Link href="/admin/cms/inquiries" className="text-xs text-muted-foreground hover:underline">전체 보기</Link>
              </div>
              {q.data.inquiries.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">접수된 문의가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {q.data.inquiries.recent.map((i) => (
                    <li key={i.id}>
                      <Link href={`/admin/cms/inquiries?id=${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                        <span className="flex items-center gap-2">
                          <Badge variant={i.status === 'NEW' ? 'danger' : 'muted'}>{INQUIRY_STATUS_LABELS[i.status]}</Badge>
                          <span className="font-medium">{i.name}</span>
                          <span className="text-muted-foreground">{INQUIRY_CATEGORY_LABELS[i.category] ?? i.category}</span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(i.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
