'use client';
import { CONTENT_STATUS_LABELS, type ContentStatus } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, type Paginated } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ImageField, PreviewButton, RevisionHistory } from './cms-widgets';
import { PublishedLockNotice, StatusBadge, useCmsMutation, useCmsPerms, WorkflowActions, nn } from './shared';
import type { BusinessArea } from './types';

const KEYS = ['title', 'slug', 'subtitle', 'summary', 'body', 'imageUrl', 'highlights', 'ctaLabel', 'ctaHref', 'seoTitle', 'seoDescription'] as const;
type Form = Record<(typeof KEYS)[number], string>;
const empty = (): Form => Object.fromEntries(KEYS.map((k) => [k, ''])) as Form;
const toForm = (a: BusinessArea): Form => ({
  title: a.title, slug: a.slug, subtitle: a.subtitle ?? '', summary: a.summary ?? '', body: a.body ?? '', imageUrl: a.imageUrl ?? '',
  highlights: a.highlights.join('\n'), ctaLabel: a.ctaLabel ?? '', ctaHref: a.ctaHref ?? '', seoTitle: a.seoTitle ?? '', seoDescription: a.seoDescription ?? '',
});

function AreaDialog({ area, open, onOpenChange }: { area: BusinessArea | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState<Form>(empty);
  const { canPublish } = useCmsPerms();
  useEffect(() => {
    if (open) setForm(area ? toForm(area) : empty());
  }, [open, area]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useCmsMutation(
    () => {
      const body = {
        title: form.title.trim(),
        ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
        subtitle: nn(form.subtitle), summary: nn(form.summary), body: nn(form.body), imageUrl: nn(form.imageUrl),
        highlights: form.highlights.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12),
        ctaLabel: nn(form.ctaLabel), ctaHref: nn(form.ctaHref), seoTitle: nn(form.seoTitle), seoDescription: nn(form.seoDescription),
      };
      return area ? apiPatch(`/cms/business-areas/${area.id}`, body) : apiPost('/cms/business-areas', body);
    },
    area ? '사업 영역을 저장했습니다.' : '사업 영역을 추가했습니다. (초안)',
  );
  const locked = area?.status === 'PUBLISHED' && !canPublish;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{area ? '사업 영역 편집' : '새 사업 영역'}</DialogTitle>
          <DialogDescription>홈의 Business Areas 카드와 /business/슬러그 상세 페이지에 사용됩니다. 새 항목은 초안으로 저장됩니다.</DialogDescription>
        </DialogHeader>
        {area && <PublishedLockNotice status={area.status} />}
        <form
          id="area-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <Field label="제목 *" htmlFor="a-title" hint="예: AI Education"><Input id="a-title" required maxLength={120} value={form.title} onChange={set('title')} disabled={locked} /></Field>
          <Field label="슬러그" htmlFor="a-slug" hint="주소에 사용 (예: ai-education). 비우면 제목으로 자동 생성">
            <Input id="a-slug" maxLength={120} value={form.slug} onChange={set('slug')} disabled={locked} />
          </Field>
          <Field label="보조 제목" htmlFor="a-sub" hint="예: AI 교육"><Input id="a-sub" maxLength={120} value={form.subtitle} onChange={set('subtitle')} disabled={locked} /></Field>
          <Field label="키워드 (한 줄에 하나)" htmlFor="a-hl" hint="상세 페이지 상단 태그, 최대 12개">
            <Textarea id="a-hl" rows={3} value={form.highlights} onChange={set('highlights')} disabled={locked} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="요약 (카드·상단 문구)" htmlFor="a-sum"><Textarea id="a-sum" rows={2} maxLength={500} value={form.summary} onChange={set('summary')} disabled={locked} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="상세 본문 (마크다운)" htmlFor="a-body" hint="# 제목, - 목록, **굵게**, [링크](https://...) 지원. HTML·스크립트는 표시되지 않습니다.">
              <Textarea id="a-body" rows={10} maxLength={20000} className="font-mono text-[13px]" value={form.body} onChange={set('body')} disabled={locked} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <ImageField id="a-img" label="대표 이미지" value={form.imageUrl} onChange={(v) => setForm((f) => ({ ...f, imageUrl: v }))} disabled={locked} />
          </div>
          <Field label="버튼 문구" htmlFor="a-ctal" hint="비우면 문의 버튼 영역 숨김"><Input id="a-ctal" maxLength={60} value={form.ctaLabel} onChange={set('ctaLabel')} disabled={locked} /></Field>
          <Field label="버튼 링크" htmlFor="a-ctah" hint="/로 시작하는 내부 경로 또는 https:// 주소"><Input id="a-ctah" maxLength={1000} value={form.ctaHref} onChange={set('ctaHref')} disabled={locked} /></Field>
          <Field label="SEO 제목" htmlFor="a-seot"><Input id="a-seot" maxLength={200} value={form.seoTitle} onChange={set('seoTitle')} disabled={locked} /></Field>
          <Field label="SEO 설명" htmlFor="a-seod"><Input id="a-seod" maxLength={500} value={form.seoDescription} onChange={set('seoDescription')} disabled={locked} /></Field>
        </form>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-1">
            {area && <RevisionHistory entityType="business_area" entityId={area.id} />}
            {area && <PreviewButton path={`/business/${encodeURIComponent(area.slug)}`} />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" form="area-form" loading={save.isPending} disabled={locked || !form.title.trim()}>저장</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BusinessAreasManager() {
  const { canWrite } = useCmsPerms();
  const [editing, setEditing] = useState<BusinessArea | null>(null);
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['cms', 'business-areas'], queryFn: () => apiGet<Paginated<BusinessArea>>('/cms/business-areas', { pageSize: 100 }) });
  const changeStatus = useCmsMutation(
    (v: { id: string; status: ContentStatus }) => apiPost<BusinessArea>(`/cms/business-areas/${v.id}/status`, { status: v.status }),
    (r) => `상태를 '${CONTENT_STATUS_LABELS[(r as BusinessArea).status]}'(으)로 변경했습니다.`,
  );
  const reorder = useCmsMutation((ids: string[]) => apiPut('/cms/business-areas/order', { ids }), '순서를 저장했습니다.');
  const remove = useCmsMutation((id: string) => apiDelete(`/cms/business-areas/${id}`), '사업 영역을 삭제했습니다.');
  const items = q.data?.items ?? [];
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((a) => a.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        title="사업 영역"
        description="홈 Business Areas 카드(순서 포함)와 사업 영역 상세 페이지를 관리합니다. 게시된 항목만 공개 사이트에 노출됩니다."
        actions={canWrite ? <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus /> 사업 영역 추가</Button> : undefined}
      />
      {q.isLoading && <LoadingRows />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && items.length === 0 && <EmptyState title="사업 영역이 없습니다." description="사업 영역을 추가하고 게시하면 홈과 사업 영역 페이지에 표시됩니다." />}
      {items.length > 0 && (
        <ol className="divide-y divide-border rounded-lg border border-border">
          {items.map((a, i) => (
            <li key={a.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
              <div className="flex items-center gap-3 md:w-[45%]">
                {canWrite && (
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon-sm" aria-label={`${a.title} 위로`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`${a.title} 아래로`} disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  </div>
                )}
                <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] font-semibold">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.imageUrl ? <img src={a.imageUrl} alt="" className="size-full object-cover" /> : 'AI'}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.title}{a.subtitle && <span className="ml-2 text-xs font-normal text-muted-foreground">{a.subtitle}</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">/business/{a.slug}{a.summary ? ` · ${a.summary}` : ''}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                <StatusBadge status={a.status} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <WorkflowActions status={a.status} pending={changeStatus.isPending} onChange={(to) => changeStatus.mutate({ id: a.id, status: to })} />
                  <PreviewButton path={`/business/${encodeURIComponent(a.slug)}`} />
                  {canWrite && (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={`${a.title} 편집`} onClick={() => { setEditing(a); setOpen(true); }}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${a.title} 삭제`} onClick={() => { if (window.confirm(`'${a.title}' 사업 영역을 삭제할까요?`)) remove.mutate(a.id); }}><Trash2 /></Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <AreaDialog area={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}
