'use client';
import { FileText, LayoutTemplate, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { useCan } from '@/lib/auth';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { useCreateDocument, useDocActions, useDocSearch, useTemplates, useTrash, type DocListItem, type TrashItem } from '@/features/docs/api';

export default function DocsHomePage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <DocsHome />
    </Suspense>
  );
}

function DocsHome() {
  const params = useSearchParams();
  const view = params.get('view');
  const can = useCan();
  const router = useRouter();
  const create = useCreateDocument();
  const newDoc = (body: { templateId?: string; isTemplate?: boolean } = {}) =>
    create.mutate(body, {
      onSuccess: (d) => router.push(`/admin/docs/${d.id}`),
      onError: (e) => toast.error((e as Error).message),
    });

  const tabs = [
    { key: null, label: '홈', icon: Search },
    { key: 'templates', label: '템플릿', icon: LayoutTemplate },
    { key: 'trash', label: '휴지통', icon: Trash2 },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="문서"
        description="팀의 지식과 업무 문서를 한곳에서 작성하고 공유합니다."
        actions={can('docs.write') && (
          <Button onClick={() => newDoc()} loading={create.isPending}><Plus /> 새 문서</Button>
        )}
      />
      <div role="tablist" aria-label="문서 보기" className="mb-6 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = (view ?? null) === t.key;
          return (
            <Link
              key={t.label}
              role="tab"
              aria-selected={active}
              href={t.key ? `/admin/docs?view=${t.key}` : '/admin/docs'}
              className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', active ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              <t.icon className="size-4" /> {t.label}
            </Link>
          );
        })}
      </div>
      {view === 'templates' ? <TemplatesView onCreate={newDoc} canWrite={can('docs.write')} /> : view === 'trash' ? <TrashView /> : <HomeView onCreate={newDoc} canWrite={can('docs.write')} />}
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function HomeView({ onCreate, canWrite }: { onCreate: (b?: { templateId?: string }) => void; canWrite: boolean }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim());
  useEffect(() => setPage(1), [dq]);
  const searching = dq.length > 0;
  const results = useDocSearch({ q: dq, page, pageSize: 20 }, searching);
  const recent = useDocSearch({ sort: 'updatedAt', pageSize: 8 }, !searching);
  const templates = useTemplates();

  return (
    <div className="space-y-10">
      <div role="search" className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 또는 본문으로 문서 검색" aria-label="문서 검색" className="h-11 pl-9 text-[15px]" />
      </div>

      {searching ? (
        <section aria-label="검색 결과">
          {results.isLoading ? <LoadingRows /> : results.isError ? <ErrorState error={results.error} /> : results.data!.items.length === 0 ? (
            <EmptyState title="검색 결과가 없습니다" description={`"${dq}" 와(과) 일치하는 문서를 찾지 못했습니다. 접근 권한이 있는 문서만 검색됩니다.`} icon={Search} />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{results.data!.total}개 결과</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {results.data!.items.map((d) => <DocRow key={d.id} doc={d} query={dq} />)}
              </ul>
              <Pagination page={page} totalPages={results.data!.totalPages} onChange={setPage} />
            </>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="mb-3 text-sm font-semibold">최근 수정한 문서</h2>
            {recent.isLoading ? <LoadingRows rows={4} /> : recent.isError ? <ErrorState error={recent.error} /> : recent.data!.items.length === 0 ? (
              <EmptyState
                title="아직 문서가 없습니다"
                description="새 문서를 만들어 팀의 지식을 기록해 보세요."
                icon={FileText}
                action={canWrite && <Button variant="outline" onClick={() => onCreate()}><Plus /> 새 문서</Button>}
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {recent.data!.items.map((d) => <DocRow key={d.id} doc={d} />)}
              </ul>
            )}
          </section>
          <section aria-labelledby="tpl-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="tpl-heading" className="text-sm font-semibold">템플릿으로 시작하기</h2>
              <Link href="/admin/docs?view=templates" className="text-xs text-muted-foreground underline-offset-2 hover:underline">전체 보기</Link>
            </div>
            {templates.isLoading ? <LoadingRows rows={2} /> : templates.isError ? <ErrorState error={templates.error} /> : templates.data!.items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                등록된 템플릿이 없습니다. 문서 메뉴에서 &lsquo;템플릿으로 지정&rsquo;하면 여기에 표시됩니다.
              </p>
            ) : (
              <TemplateGrid items={templates.data!.items.slice(0, 6)} onCreate={onCreate} canWrite={canWrite} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

function DocRow({ doc, query }: { doc: DocListItem; query?: string }) {
  return (
    <li>
      <Link href={`/admin/docs/${doc.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/60">
        <span className="mt-0.5 w-5 shrink-0 text-center">{doc.icon ?? <FileText className="inline size-4 text-muted-foreground" />}</span>
        <span className="min-w-0 flex-1">
          {doc.path.length > 0 && <span className="block truncate text-xs text-muted-foreground">{doc.path.join(' / ')}</span>}
          <span className="block truncate font-medium"><Highlight text={doc.title || '제목 없음'} query={query} /></span>
          {doc.snippet && <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground"><Highlight text={doc.snippet} query={query} /></span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {doc.updatedBy && <Avatar name={doc.updatedBy.name} src={doc.updatedBy.avatarUrl} className="size-5" />}
          <time dateTime={doc.updatedAt} title={formatDateTime(doc.updatedAt)}>{timeAgo(doc.updatedAt)}</time>
        </span>
      </Link>
    </li>
  );
}

function TemplateGrid({ items, onCreate, canWrite }: { items: DocListItem[]; onCreate: (b: { templateId: string }) => void; canWrite: boolean }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => (
        <li key={t.id} className="flex flex-col rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">{t.icon ?? '📄'}</span>
            <Link href={`/admin/docs/${t.id}`} className="truncate font-medium hover:underline">{t.title || '제목 없음'}</Link>
          </div>
          <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{t.snippet || '내용 없음'}</p>
          {canWrite && (
            <Button variant="outline" size="sm" className="mt-3 self-start" onClick={() => onCreate({ templateId: t.id })}>이 템플릿으로 만들기</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TemplatesView({ onCreate, canWrite }: { onCreate: (b?: { templateId?: string; isTemplate?: boolean }) => void; canWrite: boolean }) {
  const templates = useTemplates();
  return (
    <section aria-label="템플릿">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">템플릿 문서의 내용을 복사해 새 문서를 만듭니다. 문서 메뉴의 &lsquo;템플릿으로 지정&rsquo;으로 추가할 수 있습니다.</p>
        {canWrite && <Button variant="outline" size="sm" onClick={() => onCreate({ isTemplate: true })}><Plus /> 새 템플릿</Button>}
      </div>
      {templates.isLoading ? <LoadingRows /> : templates.isError ? <ErrorState error={templates.error} /> : templates.data!.items.length === 0 ? (
        <EmptyState title="템플릿이 없습니다" description="자주 쓰는 문서 형식(회의록, 주간 보고 등)을 템플릿으로 만들어 두세요." icon={LayoutTemplate} />
      ) : (
        <TemplateGrid items={templates.data!.items} onCreate={onCreate} canWrite={canWrite} />
      )}
    </section>
  );
}

function TrashView() {
  const [page, setPage] = useState(1);
  const trash = useTrash(page);
  const { restore, purge } = useDocActions();
  const router = useRouter();
  const [confirm, setConfirm] = useState<TrashItem | null>(null);
  return (
    <section aria-label="휴지통">
      <p className="mb-4 text-sm text-muted-foreground">삭제한 문서는 하위 문서와 함께 휴지통에 보관됩니다. 편집 권한이 있는 문서만 표시됩니다.</p>
      {trash.isLoading ? <LoadingRows /> : trash.isError ? <ErrorState error={trash.error} /> : trash.data!.items.length === 0 ? (
        <EmptyState title="휴지통이 비어 있습니다" icon={Trash2} />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {trash.data!.items.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.icon ? `${t.icon} ` : ''}{t.title || '제목 없음'}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.deletedBy?.name ?? '알 수 없음'} · {formatDateTime(t.deletedAt)} 삭제{t.descendants > 0 && ` · 하위 문서 ${t.descendants}개`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={restore.isPending && restore.variables === t.id}
                    onClick={() =>
                      restore.mutate(t.id, {
                        onSuccess: (r) => {
                          toast.success(r.movedToRoot ? '복원했습니다. 상위 문서가 삭제되어 최상위로 이동했습니다.' : '복원했습니다.', {
                            action: { label: '열기', onClick: () => router.push(`/admin/docs/${t.id}`) },
                          });
                        },
                        onError: (e) => toast.error((e as Error).message),
                      })
                    }
                  >
                    <RotateCcw /> 복원
                  </Button>
                  {t.canPurge && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setConfirm(t)}><Trash2 /> 영구 삭제</Button>}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={trash.data!.totalPages} onChange={setPage} />
        </>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>영구 삭제할까요?</DialogTitle>
            <DialogDescription>
              &ldquo;{confirm?.title || '제목 없음'}&rdquo;{confirm && confirm.descendants > 0 ? `과(와) 하위 문서 ${confirm.descendants}개` : ''}, 댓글과 버전 기록이 모두 삭제되며 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>취소</Button>
            <Button
              variant="danger"
              loading={purge.isPending}
              onClick={() =>
                confirm &&
                purge.mutate(confirm.id, {
                  onSuccess: () => { toast.success('영구 삭제했습니다.'); setConfirm(null); },
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              영구 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
