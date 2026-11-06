'use client';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS, type ContentStatus } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Markdown } from '@/components/site/markdown';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtDateTime, nn, PublishedLockNotice, StatusBadge, useCmsMutation, useCmsPerms, WorkflowActions } from './shared';
import { EMPLOYMENT_TYPES, POST_TYPE_LABELS, type Post, type PostType } from './types';

const TYPES: PostType[] = ['NEWS', 'INSIGHT', 'CAREER'];

interface FormState {
  title: string; slug: string; excerpt: string; body: string; coverImageUrl: string; publishedAt: string; seoTitle: string; seoDescription: string;
  location: string; employmentType: string; deadline: string; team: string; experience: string; applyUrl: string;
}
const empty = (): FormState => ({
  title: '', slug: '', excerpt: '', body: '', coverImageUrl: '', publishedAt: '', seoTitle: '', seoDescription: '',
  location: '', employmentType: '', deadline: '', team: '', experience: '', applyUrl: '',
});
const CAREER_KEYS = ['location', 'employmentType', 'deadline', 'team', 'experience', 'applyUrl'] as const;

/** datetime-local ↔ ISO */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

function PostEditor({ type, postId, open, onOpenChange }: { type: PostType; postId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { canPublish } = useCmsPerms();
  const [f, setF] = useState<FormState>(empty);
  const [savedId, setSavedId] = useState<string | null>(null);
  const id = postId ?? savedId;
  const detail = useQuery({ queryKey: ['cms', 'post', id], queryFn: () => apiGet<Post>(`/cms/posts/${id}`), enabled: open && !!id });
  const post = detail.data;

  useEffect(() => {
    if (!open) {
      setSavedId(null);
      return;
    }
    if (!postId) setF(empty());
  }, [open, postId]);
  useEffect(() => {
    if (!post || post.id !== postId) return;
    setF({
      title: post.title, slug: post.slug, excerpt: post.excerpt ?? '', body: post.body ?? '', coverImageUrl: post.coverImageUrl ?? '',
      publishedAt: toLocal(post.publishedAt), seoTitle: post.seoTitle ?? '', seoDescription: post.seoDescription ?? '',
      ...Object.fromEntries(CAREER_KEYS.map((k) => [k, post.metadata?.[k] ?? ''])),
    } as FormState);
  }, [post, postId]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const status: ContentStatus = post?.status ?? 'DRAFT';
  const locked = status === 'PUBLISHED' && !canPublish;

  const save = useCmsMutation(() => {
    const metadata = type === 'CAREER' ? Object.fromEntries(CAREER_KEYS.filter((k) => f[k].trim()).map((k) => [k, f[k].trim()])) : undefined;
    const body = {
      title: f.title.trim(),
      ...(f.slug.trim() ? { slug: f.slug.trim() } : {}),
      excerpt: nn(f.excerpt), body: f.body, coverImageUrl: nn(f.coverImageUrl),
      publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : null,
      seoTitle: nn(f.seoTitle), seoDescription: nn(f.seoDescription),
      ...(metadata ? { metadata } : {}),
    };
    return id ? apiPatch<Post>(`/cms/posts/${id}`, body) : apiPost<Post>('/cms/posts', { type, ...body });
  }, '저장했습니다.');
  const changeStatus = useCmsMutation((to: ContentStatus) => apiPost(`/cms/posts/${id}/status`, { status: to }), '상태를 변경했습니다.');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {id ? `${POST_TYPE_LABELS[type]} 편집` : `새 ${POST_TYPE_LABELS[type]}`}
            {id && <StatusBadge status={status} />}
          </DialogTitle>
          <DialogDescription>본문은 마크다운(제목 #, 목록 -, 굵게 **, 링크 [텍스트](https://...))을 지원합니다. HTML 은 렌더링되지 않고 텍스트로 표시됩니다.</DialogDescription>
        </DialogHeader>
        {id && detail.isLoading && <LoadingRows rows={3} />}
        {post && <PublishedLockNotice status={post.status} />}
        <form
          id="post-form"
          className="grid gap-6 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onSuccess: (r) => !id && setSavedId((r as Post).id) });
          }}
        >
          <div className="space-y-4">
            <Field label="제목 *" htmlFor="po-title"><Input id="po-title" required maxLength={200} value={f.title} onChange={set('title')} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="슬러그" htmlFor="po-slug" hint="비워두면 제목으로 자동 생성"><Input id="po-slug" maxLength={120} value={f.slug} onChange={set('slug')} /></Field>
              <Field label="게시일" htmlFor="po-pub" hint="미래 시각이면 그때부터 노출"><Input id="po-pub" type="datetime-local" value={f.publishedAt} onChange={set('publishedAt')} /></Field>
            </div>
            <Field label="요약" htmlFor="po-excerpt"><Textarea id="po-excerpt" rows={2} maxLength={500} value={f.excerpt} onChange={set('excerpt')} /></Field>
            {type === 'CAREER' && (
              <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium text-muted-foreground">채용 정보</legend>
                <Field label="근무지" htmlFor="po-loc"><Input id="po-loc" maxLength={200} value={f.location} onChange={set('location')} /></Field>
                <Field label="고용 형태" htmlFor="po-emp">
                  <NativeSelect id="po-emp" value={f.employmentType} onChange={set('employmentType')}>
                    <option value="">선택</option>
                    {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="마감일" htmlFor="po-deadline" hint="비우면 상시 채용"><Input id="po-deadline" type="date" value={f.deadline} onChange={set('deadline')} /></Field>
                <Field label="팀" htmlFor="po-team"><Input id="po-team" maxLength={120} value={f.team} onChange={set('team')} /></Field>
                <Field label="경력" htmlFor="po-exp"><Input id="po-exp" maxLength={120} value={f.experience} onChange={set('experience')} /></Field>
                <Field label="지원 링크" htmlFor="po-apply" hint="https:// 또는 mailto:"><Input id="po-apply" maxLength={1000} value={f.applyUrl} onChange={set('applyUrl')} /></Field>
              </fieldset>
            )}
            <Field label="본문 (마크다운)" htmlFor="po-body">
              <Textarea id="po-body" rows={16} maxLength={50000} className="font-mono text-[13px] leading-relaxed" value={f.body} onChange={set('body')} />
            </Field>
            <Field label="커버 이미지 URL" htmlFor="po-cover"><Input id="po-cover" type="url" value={f.coverImageUrl} onChange={set('coverImageUrl')} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO 제목" htmlFor="po-seot"><Input id="po-seot" maxLength={200} value={f.seoTitle} onChange={set('seoTitle')} /></Field>
              <Field label="SEO 설명" htmlFor="po-seod"><Input id="po-seod" maxLength={500} value={f.seoDescription} onChange={set('seoDescription')} /></Field>
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[13px] font-medium">미리보기</p>
            <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-paper p-6 text-ink">
              <h1 className="text-3xl font-semibold tracking-[-0.03em]">{f.title || '제목 없음'}</h1>
              {f.excerpt && <p className="mt-3 text-lg text-gray-600">{f.excerpt}</p>}
              <hr className="my-6 border-gray-200" />
              {f.body.trim() ? <Markdown source={f.body} /> : <p className="text-sm text-gray-400">본문을 입력하면 공개 사이트와 동일한 방식으로 렌더링됩니다.</p>}
            </div>
          </div>
        </form>
        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>{id && <WorkflowActions status={status} pending={changeStatus.isPending} onChange={(to) => changeStatus.mutate(to)} />}</div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>닫기</Button>
            <Button type="submit" form="post-form" loading={save.isPending} disabled={locked || !f.title.trim()}>저장</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PostsManager() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const t = params.get('type');
  const type: PostType = t === 'INSIGHT' || t === 'CAREER' ? t : 'NEWS';
  const { canWrite } = useCmsPerms();
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => setPage(1), [type, status, query]);

  const q = useQuery({
    queryKey: ['cms', 'posts', type, status, query, page],
    queryFn: () => apiGet<Paginated<Post>>('/cms/posts', { type, status: status || undefined, q: query || undefined, page, pageSize: 20 }),
  });
  const changeStatus = useCmsMutation((v: { id: string; to: ContentStatus }) => apiPost(`/cms/posts/${v.id}/status`, { status: v.to }), '상태를 변경했습니다.');
  const remove = useCmsMutation((id: string) => apiDelete(`/cms/posts/${id}`), '삭제했습니다.');

  return (
    <>
      <PageHeader
        title="뉴스 · 인사이트 · 채용"
        description="편집자는 초안 작성과 검토 요청까지, 게시 승인자는 게시·게시 중단을 할 수 있습니다."
        actions={canWrite && <Button size="sm" onClick={() => { setEditingId(null); setOpen(true); }}><Plus /> 새 {POST_TYPE_LABELS[type]}</Button>}
      />
      <Tabs value={type} onValueChange={(v) => router.replace(`${pathname}?type=${v}`)}>
        <TabsList>
          {TYPES.map((x) => <TabsTrigger key={x} value={x}>{POST_TYPE_LABELS[x]}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="제목 검색" className="w-56 pl-8" placeholder="제목 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <NativeSelect aria-label="상태 필터" className="w-36" value={status} onChange={(e) => setStatus(e.target.value as ContentStatus | '')}>
          <option value="">전체 상태</option>
          {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
      </div>
      <div className="mt-4">
        {q.isLoading && <LoadingRows />}
        {q.error && <ErrorState error={q.error} />}
        {q.data && q.data.items.length === 0 && <EmptyState title={`${POST_TYPE_LABELS[type]} 게시물이 없습니다.`} />}
        {q.data && q.data.items.length > 0 && (
          <Table>
            <THead>
              <TR><TH>제목</TH><TH>상태</TH><TH>게시일</TH><TH>수정</TH><TH>작성자</TH><TH className="text-right">작업</TH></TR>
            </THead>
            <TBody>
              {q.data.items.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => { setEditingId(p.id); setOpen(true); }}>{p.title}</button>
                    <p className="text-xs text-muted-foreground">/{p.slug}{p.type === 'CAREER' && p.metadata?.deadline ? ` · 마감 ${p.metadata.deadline}` : ''}</p>
                  </TD>
                  <TD><StatusBadge status={p.status} /></TD>
                  <TD className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(p.publishedAt)}</TD>
                  <TD className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(p.updatedAt)}</TD>
                  <TD className="text-xs">{p.author?.name ?? '—'}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <WorkflowActions status={p.status} pending={changeStatus.isPending} onChange={(to) => changeStatus.mutate({ id: p.id, to })} />
                      <Button variant="ghost" size="icon-sm" aria-label={`${p.title} 편집`} onClick={() => { setEditingId(p.id); setOpen(true); }}><Pencil /></Button>
                      {canWrite && (
                        <Button variant="ghost" size="icon-sm" aria-label={`${p.title} 삭제`} onClick={() => { if (window.confirm(`'${p.title}' 을(를) 삭제할까요?`)) remove.mutate(p.id); }}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
      </div>
      <PostEditor type={type} postId={editingId} open={open} onOpenChange={setOpen} />
    </>
  );
}
