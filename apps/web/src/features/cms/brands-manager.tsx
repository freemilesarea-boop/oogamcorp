'use client';
import { CONTENT_STATUSES, CONTENT_STATUS_LABELS, type ContentStatus } from '@oogam/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, type Paginated } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImageField, PreviewButton, RevisionHistory } from './cms-widgets';
import { PortfolioManager } from './portfolio-manager';
import { PublishedLockNotice, StatusBadge, useCmsMutation, useCmsPerms, WarningBanner, WorkflowActions, nn } from './shared';
import type { Brand } from './types';

const FORM_KEYS = ['name', 'slug', 'tagline', 'description', 'logoUrl', 'imageUrl', 'websiteUrl', 'category', 'relationshipNote', 'seoTitle', 'seoDescription'] as const;
type FormState = Record<(typeof FORM_KEYS)[number], string>;
const emptyForm = (): FormState => Object.fromEntries(FORM_KEYS.map((k) => [k, ''])) as FormState;

function BrandDialog({ brand, open, onOpenChange }: { brand: Brand | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const { canPublish } = useCmsPerms();
  useEffect(() => {
    if (open) setForm(brand ? (Object.fromEntries(FORM_KEYS.map((k) => [k, (brand[k] as string | null) ?? ''])) as FormState) : emptyForm());
  }, [open, brand]);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useCmsMutation(
    () => {
      const body = {
        name: form.name.trim(),
        ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
        tagline: nn(form.tagline), description: nn(form.description), logoUrl: nn(form.logoUrl), imageUrl: nn(form.imageUrl),
        websiteUrl: nn(form.websiteUrl), category: nn(form.category), relationshipNote: nn(form.relationshipNote),
        seoTitle: nn(form.seoTitle), seoDescription: nn(form.seoDescription),
      };
      return brand ? apiPatch(`/cms/brands/${brand.id}`, body) : apiPost('/cms/brands', body);
    },
    brand ? '브랜드를 저장했습니다.' : '브랜드를 추가했습니다. (초안)',
  );
  const locked = brand?.status === 'PUBLISHED' && !canPublish;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle>{brand ? '브랜드 편집' : '새 브랜드'}</DialogTitle>
          <DialogDescription>새 브랜드는 초안(DRAFT)으로 저장되며, 게시 승인 후 공개 사이트에 노출됩니다.</DialogDescription>
        </DialogHeader>
        {brand && <PublishedLockNotice status={brand.status} />}
        {form.relationshipNote.trim() && (
          <WarningBanner title="법인 관계 확인 필요">
            <p className="whitespace-pre-line">{form.relationshipNote}</p>
            <p className="mt-1">공개 문구에 &lsquo;공식 계열사·자회사&rsquo; 등 소유 관계를 단정하는 표현을 사용하지 마세요. &lsquo;OOGAM과 함께하는 브랜드&rsquo; 같은 표현을 사용합니다.</p>
          </WarningBanner>
        )}
        <form
          id="brand-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onSuccess: () => onOpenChange(false) });
          }}
        >
          <Field label="브랜드명 *" htmlFor="b-name"><Input id="b-name" required maxLength={120} value={form.name} onChange={set('name')} /></Field>
          <Field label="슬러그" htmlFor="b-slug" hint="비워두면 이름으로 자동 생성 (영문 소문자·숫자·한글·하이픈)">
            <Input id="b-slug" maxLength={120} value={form.slug} onChange={set('slug')} placeholder="예: louver" />
          </Field>
          <Field label="태그라인" htmlFor="b-tagline"><Input id="b-tagline" maxLength={200} value={form.tagline} onChange={set('tagline')} /></Field>
          <Field label="카테고리" htmlFor="b-category"><Input id="b-category" maxLength={80} value={form.category} onChange={set('category')} /></Field>
          <div className="sm:col-span-2">
            <Field label="소개 (마크다운)" htmlFor="b-desc"><Textarea id="b-desc" rows={5} maxLength={5000} value={form.description} onChange={set('description')} /></Field>
          </div>
          <ImageField id="b-logo" label="브랜드 로고" value={form.logoUrl} onChange={(v) => setForm((f) => ({ ...f, logoUrl: v }))} />
          <ImageField id="b-image" label="대표 이미지" value={form.imageUrl} onChange={(v) => setForm((f) => ({ ...f, imageUrl: v }))} />
          <Field label="웹사이트" htmlFor="b-web" hint="http:// 또는 https:// 만 허용"><Input id="b-web" type="url" value={form.websiteUrl} onChange={set('websiteUrl')} /></Field>
          <Field label="SEO 제목" htmlFor="b-seot"><Input id="b-seot" maxLength={200} value={form.seoTitle} onChange={set('seoTitle')} /></Field>
          <div className="sm:col-span-2">
            <Field label="SEO 설명" htmlFor="b-seod"><Textarea id="b-seod" rows={2} maxLength={500} value={form.seoDescription} onChange={set('seoDescription')} /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="법인 관계 확인 메모 (내부 전용 · 공개되지 않음)" htmlFor="b-note">
              <Textarea id="b-note" rows={2} maxLength={1000} value={form.relationshipNote} onChange={set('relationshipNote')} />
            </Field>
          </div>
        </form>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-1">
            {brand && <RevisionHistory entityType="brand" entityId={brand.id} />}
            {brand && <PreviewButton path={`/brands/${encodeURIComponent(brand.slug)}`} />}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" form="brand-form" loading={save.isPending} disabled={locked || !form.name.trim()}>저장</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 관계 메모가 있는 브랜드 게시 전 확인 */
function PublishConfirm({ brand, onClose, onConfirm, pending }: { brand: Brand | null; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [brand]);
  return (
    <Dialog open={!!brand} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>&lsquo;{brand?.name}&rsquo; 게시</DialogTitle>
          <DialogDescription>게시하면 공개 사이트의 브랜드 목록에 즉시 노출됩니다.</DialogDescription>
        </DialogHeader>
        <WarningBanner title="법인 관계 확인 메모">
          <p className="whitespace-pre-line">{brand?.relationshipNote}</p>
        </WarningBanner>
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
          <span>소개 문구에 공식 계열사·자회사 등 확인되지 않은 법인 관계를 표기하지 않았음을 확인합니다.</span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button disabled={!ack} loading={pending} onClick={onConfirm}>확인하고 게시</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrandList() {
  const { canWrite } = useCmsPerms();
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [editing, setEditing] = useState<Brand | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmBrand, setConfirmBrand] = useState<Brand | null>(null);
  const q = useQuery({
    queryKey: ['cms', 'brands', status],
    queryFn: () => apiGet<Paginated<Brand>>('/cms/brands', { pageSize: 100, status: status || undefined }),
  });

  const changeStatus = useCmsMutation(
    (v: { id: string; status: ContentStatus; acknowledgeRelationship?: boolean }) =>
      apiPost(`/cms/brands/${v.id}/status`, { status: v.status, ...(v.acknowledgeRelationship ? { acknowledgeRelationship: true } : {}) }),
    (r) => `상태를 '${CONTENT_STATUS_LABELS[(r as Brand).status]}'(으)로 변경했습니다.`,
  );
  const reorder = useCmsMutation((ids: string[]) => apiPut('/cms/brands/order', { ids }), '순서를 저장했습니다.');
  const remove = useCmsMutation((id: string) => apiDelete(`/cms/brands/${id}`), '브랜드를 삭제했습니다.');

  const items = q.data?.items ?? [];
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((b) => b.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };
  const onStatus = (b: Brand, to: ContentStatus) => {
    if (to === 'PUBLISHED' && b.relationshipNote?.trim()) setConfirmBrand(b);
    else changeStatus.mutate({ id: b.id, status: to });
  };
  const flagged = items.filter((b) => b.relationshipNote?.trim()).length;

  return (
    <div className="space-y-4">
      <WarningBanner title="브랜드 표기 원칙">
        법인 소유·운영 관계가 확인되지 않은 브랜드를 &lsquo;공식 계열사·자회사&rsquo;로 표기하지 마세요. 공개 사이트는 &lsquo;OOGAM과 함께하는 브랜드&rsquo;로 소개합니다.
        {flagged > 0 && <> 현재 관계 확인 메모가 있는 브랜드 <strong>{flagged}</strong>개.</>}
      </WarningBanner>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NativeSelect aria-label="상태 필터" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as ContentStatus | '')}>
          <option value="">전체 상태</option>
          {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{CONTENT_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        {canWrite && (
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus /> 브랜드 추가</Button>
        )}
      </div>
      {q.isLoading && <LoadingRows />}
      {q.error && <ErrorState error={q.error} />}
      {q.data && items.length === 0 && <EmptyState title="브랜드가 없습니다." description="브랜드를 추가하면 초안으로 저장됩니다." />}
      {items.length > 0 && (
        <ol className="divide-y divide-border rounded-lg border border-border">
          {items.map((b, i) => (
            <li key={b.id} className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
              <div className="flex items-center gap-3 md:w-[40%]">
                {canWrite && !status && (
                  <div className="flex flex-col">
                    <Button variant="ghost" size="icon-sm" aria-label={`${b.name} 위로`} disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`${b.name} 아래로`} disabled={i === items.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  </div>
                )}
                <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-xs font-semibold">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {b.logoUrl ? <img src={b.logoUrl} alt="" className="size-full object-contain" /> : b.name.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{b.name}</span>
                    {b.relationshipNote?.trim() && (
                      <span title={b.relationshipNote} className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        <AlertTriangle className="size-3" /> 관계 확인 필요
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">/{b.slug}{b.category ? ` · ${b.category}` : ''} · 프로젝트 {b._count?.portfolioItems ?? 0}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                <StatusBadge status={b.status} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <WorkflowActions status={b.status} pending={changeStatus.isPending} onChange={(to) => onStatus(b, to)} />
                  {canWrite && (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={`${b.name} 편집`} onClick={() => { setEditing(b); setDialogOpen(true); }}><Pencil /></Button>
                      <Button
                        variant="ghost" size="icon-sm" aria-label={`${b.name} 삭제`}
                        onClick={() => { if (window.confirm(`'${b.name}' 브랜드를 삭제할까요?`)) remove.mutate(b.id); }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <BrandDialog brand={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <PublishConfirm
        brand={confirmBrand}
        pending={changeStatus.isPending}
        onClose={() => setConfirmBrand(null)}
        onConfirm={() => confirmBrand && changeStatus.mutate({ id: confirmBrand.id, status: 'PUBLISHED', acknowledgeRelationship: true }, { onSuccess: () => setConfirmBrand(null) })}
      />
    </div>
  );
}

export function BrandsManager() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') === 'portfolio' ? 'portfolio' : 'brands';
  return (
    <>
      <PageHeader title="브랜드 · 포트폴리오" description="공개 사이트의 브랜드 목록(순서 포함)과 프로젝트 포트폴리오를 관리합니다." />
      <Tabs value={tab} onValueChange={(v) => router.replace(v === 'portfolio' ? `${pathname}?tab=portfolio` : pathname)}>
        <TabsList>
          <TabsTrigger value="brands">브랜드</TabsTrigger>
          <TabsTrigger value="portfolio">포트폴리오</TabsTrigger>
        </TabsList>
        <TabsContent value="brands"><BrandList /></TabsContent>
        <TabsContent value="portfolio"><PortfolioManager /></TabsContent>
      </Tabs>
    </>
  );
}
