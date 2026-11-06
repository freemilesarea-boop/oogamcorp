'use client';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS, type ContentStatus } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PublishedLockNotice, StatusBadge, useCmsMutation, useCmsPerms, WorkflowActions, nn } from './shared';
import type { Brand, PortfolioItem } from './types';

interface FormState {
  title: string; slug: string; summary: string; body: string; client: string; year: string; imageUrl: string;
  brandId: string; tags: string; featured: boolean;
}
const empty = (): FormState => ({ title: '', slug: '', summary: '', body: '', client: '', year: '', imageUrl: '', brandId: '', tags: '', featured: false });

function useBrandOptions() {
  return useQuery({ queryKey: ['cms', 'brands', 'options'], queryFn: () => apiGet<Paginated<Brand>>('/cms/brands', { pageSize: 100 }) });
}

function PortfolioDialog({ item, open, onOpenChange }: { item: PortfolioItem | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [f, setF] = useState<FormState>(empty);
  const { canPublish } = useCmsPerms();
  const brands = useBrandOptions();
  useEffect(() => {
    if (!open) return;
    setF(item
      ? {
          title: item.title, slug: item.slug, summary: item.summary ?? '', body: item.body ?? '', client: item.client ?? '',
          year: item.year ? String(item.year) : '', imageUrl: item.imageUrl ?? '', brandId: item.brandId ?? '', tags: item.tags.join(', '), featured: item.featured,
        }
      : empty());
  }, [open, item]);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const save = useCmsMutation(() => {
    const body = {
      title: f.title.trim(),
      ...(f.slug.trim() ? { slug: f.slug.trim() } : {}),
      summary: nn(f.summary), body: nn(f.body), client: nn(f.client), imageUrl: nn(f.imageUrl),
      year: f.year.trim() ? Number(f.year) : null,
      brandId: f.brandId || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      featured: f.featured,
    };
    return item ? apiPatch(`/cms/portfolio/${item.id}`, body) : apiPost('/cms/portfolio', body);
  }, item ? '프로젝트를 저장했습니다.' : '프로젝트를 추가했습니다. (초안)');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{item ? '프로젝트 편집' : '새 프로젝트'}</DialogTitle>
          <DialogDescription>&lsquo;주요 프로젝트&rsquo;로 지정하고 게시하면 홈의 Featured Projects 에 노출됩니다.</DialogDescription>
        </DialogHeader>
        {item && <PublishedLockNotice status={item.status} />}
        <form
          id="portfolio-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => onOpenChange(false) }); }}
        >
          <Field label="제목 *" htmlFor="p-title"><Input id="p-title" required maxLength={200} value={f.title} onChange={set('title')} /></Field>
          <Field label="슬러그" htmlFor="p-slug" hint="비워두면 제목으로 자동 생성"><Input id="p-slug" maxLength={120} value={f.slug} onChange={set('slug')} /></Field>
          <Field label="브랜드" htmlFor="p-brand" hint="브랜드가 비공개이면 공개 사이트에서 브랜드 표기가 숨겨집니다">
            <NativeSelect id="p-brand" value={f.brandId} onChange={set('brandId')}>
              <option value="">(없음)</option>
              {brands.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name} · {CONTENT_STATUS_LABELS[b.status]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="클라이언트" htmlFor="p-client"><Input id="p-client" maxLength={200} value={f.client} onChange={set('client')} /></Field>
          <Field label="연도" htmlFor="p-year"><Input id="p-year" type="number" min={1990} max={2100} value={f.year} onChange={set('year')} /></Field>
          <Field label="이미지 URL" htmlFor="p-image"><Input id="p-image" type="url" value={f.imageUrl} onChange={set('imageUrl')} /></Field>
          <div className="sm:col-span-2">
            <Field label="요약" htmlFor="p-summary"><Textarea id="p-summary" rows={2} maxLength={500} value={f.summary} onChange={set('summary')} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="상세 (마크다운)" htmlFor="p-body"><Textarea id="p-body" rows={5} maxLength={20000} value={f.body} onChange={set('body')} /></Field>
          </div>
          <Field label="태그 (쉼표로 구분)" htmlFor="p-tags"><Input id="p-tags" value={f.tags} onChange={set('tags')} placeholder="film, branding" /></Field>
          <div className="flex items-center gap-3 pt-6">
            <Switch id="p-featured" checked={f.featured} onCheckedChange={(v) => setF((s) => ({ ...s, featured: v }))} />
            <label htmlFor="p-featured" className="text-sm">주요 프로젝트 (홈 노출)</label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>취소</Button>
          <Button type="submit" form="portfolio-form" loading={save.isPending} disabled={!f.title.trim() || (item?.status === 'PUBLISHED' && !canPublish)}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioManager() {
  const { canWrite } = useCmsPerms();
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [brandId, setBrandId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PortfolioItem | null>(null);
  const [open, setOpen] = useState(false);
  const brands = useBrandOptions();
  const q = useQuery({
    queryKey: ['cms', 'portfolio', status, brandId, page],
    queryFn: () => apiGet<Paginated<PortfolioItem>>('/cms/portfolio', { status: status || undefined, brandId: brandId || undefined, page, pageSize: 20 }),
  });
  const changeStatus = useCmsMutation(
    (v: { id: string; status: ContentStatus }) => apiPost(`/cms/portfolio/${v.id}/status`, { status: v.status }),
    '상태를 변경했습니다.',
  );
  const remove = useCmsMutation((id: string) => apiDelete(`/cms/portfolio/${id}`), '프로젝트를 삭제했습니다.');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="상태 필터" className="w-36" value={status} onChange={(e) => { setStatus(e.target.value as ContentStatus | ''); setPage(1); }}>
            <option value="">전체 상태</option>
            {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="브랜드 필터" className="w-44" value={brandId} onChange={(e) => { setBrandId(e.target.value); setPage(1); }}>
            <option value="">전체 브랜드</option>
            {brands.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        </div>
        {canWrite && <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus /> 프로젝트 추가</Button>}
      </div>
      {q.isLoading && <LoadingRows />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="프로젝트가 없습니다." />}
      {q.data && q.data.items.length > 0 && (
        <Table>
          <THead>
            <TR><TH>제목</TH><TH>브랜드</TH><TH>연도</TH><TH>상태</TH><TH className="text-right">작업</TH></TR>
          </THead>
          <TBody>
            {q.data.items.map((p) => (
              <TR key={p.id}>
                <TD>
                  <p className="flex items-center gap-1.5 font-medium">
                    {p.featured && <Star className="size-3.5 fill-current" aria-label="주요 프로젝트" />}
                    {p.title}
                  </p>
                  <p className="text-xs text-muted-foreground">/{p.slug}</p>
                </TD>
                <TD>{p.brand ? <span className="flex items-center gap-1.5">{p.brand.name}{p.brand.status !== 'PUBLISHED' && <Badge variant="muted">비공개</Badge>}</span> : '—'}</TD>
                <TD className="tabular-nums">{p.year ?? '—'}</TD>
                <TD><StatusBadge status={p.status} /></TD>
                <TD>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <WorkflowActions status={p.status} pending={changeStatus.isPending} onChange={(to) => changeStatus.mutate({ id: p.id, status: to })} />
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={`${p.title} 편집`} onClick={() => { setEditing(p); setOpen(true); }}><Pencil /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${p.title} 삭제`} onClick={() => { if (window.confirm(`'${p.title}' 을(를) 삭제할까요?`)) remove.mutate(p.id); }}><Trash2 /></Button>
                      </>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
      <PortfolioDialog item={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}
