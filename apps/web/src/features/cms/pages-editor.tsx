'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { BusinessGrid, HomeSections, toAreaCards } from '@/components/site/home-sections';
import { Markdown } from '@/components/site/markdown';
import { SiteFooter } from '@/components/site/site-footer';
import type { GenericContent, HomeContent, SiteSettings } from '@/components/site/types';
import { PageIntro } from '@/components/site/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ImageField, PreviewButton, RevisionHistory } from './cms-widgets';
import { cleanContent, HOME_SECTIONS, PAGE_FIELDS, type FieldDef } from './page-fields';
import { fmtDateTime, nn, useCmsMutation, useCmsPerms, WarningBanner } from './shared';
import type { PageDetail, PageSummary } from './types';

type Obj = Record<string, unknown>;

/** 공개 사이트 경로 (미리보기용) */
const PAGE_PATHS: Record<string, string> = {
  home: '/', about: '/about', business: '/business', brands: '/brands', portfolio: '/portfolio', news: '/news',
  careers: '/careers', contact: '/contact', privacy: '/privacy', terms: '/terms', site: '/',
};

type SectionRow = { key: string; visible: boolean };
/** 저장된 섹션 설정 + 누락된 섹션(기본 표시)을 합쳐 전체 순서를 만든다 */
export function normalizeSections(v: unknown): SectionRow[] {
  const saved = Array.isArray(v) ? (v as Obj[]).filter((x) => HOME_SECTIONS.some((h) => h.key === x.key)) : [];
  const rows: SectionRow[] = saved.map((x) => ({ key: x.key as string, visible: x.visible !== false }));
  for (const h of HOME_SECTIONS) if (!rows.some((r) => r.key === h.key)) rows.push({ key: h.key, visible: true });
  return rows.filter((r, i) => rows.findIndex((x) => x.key === r.key) === i);
}

function SectionsEditor({ value, onChange, disabled, label, hint }: { value: unknown; onChange: (v: unknown) => void; disabled?: boolean; label: string; hint?: string }) {
  const rows = normalizeSections(value);
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ol className="divide-y divide-border rounded-md border border-border">
        {rows.map((r, i) => {
          const name = HOME_SECTIONS.find((h) => h.key === r.key)?.label ?? r.key;
          return (
            <li key={r.key} className={cn('flex items-center gap-2 px-3 py-2 text-sm', !r.visible && 'text-muted-foreground')}>
              <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className={cn('flex-1', !r.visible && 'line-through')}>{name}</span>
              {!disabled && (
                <>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} 위로`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} 아래로`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button
                    type="button" variant="ghost" size="icon-sm" aria-pressed={r.visible} aria-label={`${name} ${r.visible ? '숨기기' : '표시'}`}
                    onClick={() => onChange(rows.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)))}
                  >
                    {r.visible ? <Eye /> : <EyeOff />}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}

function FieldEditor({ def, value, onChange, path, disabled }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; path: string; disabled?: boolean }) {
  const id = `pf-${path}`;
  switch (def.type) {
    case 'image':
      return <ImageField id={id} label={def.label} hint={def.hint} disabled={disabled} value={(value as string) ?? ''} onChange={onChange} />;
    case 'bool':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-foreground" disabled={disabled} checked={value !== false} onChange={(e) => onChange(e.target.checked)} />
          {def.label}
        </label>
      );
    case 'sections':
      return <SectionsEditor label={def.label} hint={def.hint} disabled={disabled} value={value} onChange={onChange} />;
    case 'text':
    case 'link':
      return (
        <Field label={def.label} htmlFor={id} hint={def.type === 'link' ? (def.hint ?? '/로 시작하는 내부 경로 또는 https:// 주소') : def.hint}>
          <Input id={id} disabled={disabled} maxLength={def.type === 'text' ? def.max : 1000} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'textarea':
    case 'markdown':
      return (
        <Field label={def.label} htmlFor={id} hint={def.hint ?? (def.type === 'markdown' ? '# 제목, - 목록, **굵게**, [링크](https://...) 지원' : undefined)}>
          <Textarea id={id} disabled={disabled} rows={def.type === 'markdown' ? 10 : 3} maxLength={def.max} className={def.type === 'markdown' ? 'font-mono text-[13px]' : undefined} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'lines':
      return (
        <Field label={def.label} htmlFor={id} hint={def.hint}>
          <Textarea id={id} disabled={disabled} rows={3} value={Array.isArray(value) ? (value as string[]).join('\n') : ''} onChange={(e) => onChange(e.target.value.split('\n'))} />
        </Field>
      );
    case 'group': {
      const obj = (value as Obj) ?? {};
      return (
        <fieldset className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{def.label}</legend>
          {def.fields.map((f) => (
            <FieldEditor key={f.name} def={f} path={`${path}.${f.name}`} disabled={disabled} value={obj[f.name]} onChange={(v) => onChange({ ...obj, [f.name]: v })} />
          ))}
        </fieldset>
      );
    }
    case 'list': {
      const arr = Array.isArray(value) ? (value as Obj[]) : [];
      const update = (i: number, v: Obj) => onChange(arr.map((x, j) => (j === i ? v : x)));
      const move = (i: number, d: -1 | 1) => {
        const next = [...arr];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        onChange(next);
      };
      return (
        <fieldset className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{def.label}</legend>
          {arr.map((item, i) => (
            <div key={i} className="space-y-3 rounded-md bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{def.itemLabel} {i + 1}</span>
                {!disabled && (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="아래로" disabled={i === arr.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`${def.itemLabel} ${i + 1} 삭제`} onClick={() => onChange(arr.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                )}
              </div>
              {def.fields.map((f) => (
                <FieldEditor key={f.name} def={f} path={`${path}.${i}.${f.name}`} disabled={disabled} value={item[f.name]} onChange={(v) => update(i, { ...item, [f.name]: v })} />
              ))}
            </div>
          ))}
          {!disabled && arr.length < def.max && (
            <Button type="button" variant="outline" size="sm" onClick={() => onChange([...arr, def.fields.some((x) => x.type === 'bool') ? { visible: true } : {}])}><Plus /> {def.itemLabel} 추가</Button>
          )}
        </fieldset>
      );
    }
  }
}

/** 초안 미리보기 — 공개 사이트 컴포넌트를 그대로 사용해 축소 렌더링 */
function DraftPreview({ pageKey, content, title }: { pageKey: string; content: Obj; title: string }) {
  let inner: React.ReactNode;
  if (pageKey === 'home') {
    const c = content as HomeContent;
    // 실제 공개 홈과 같은 렌더러 (섹션 순서·표시 반영). 브랜드·프로젝트·뉴스는 각 관리 화면의 게시 데이터로 채워짐
    inner = <HomeSections content={c} name="OOGAM" businessAreas={toAreaCards(c.business)} brands={[]} featured={[]} news={[]} />;
  } else if (pageKey === 'site') {
    inner = <SiteFooter site={{ name: 'OOGAM', nav: [{ href: '#', label: 'About' }, { href: '#', label: 'Contact' }], footer: content as SiteSettings, seo: { title: null, description: null, ogImageUrl: null } }} />;
  } else {
    const c = content as GenericContent;
    inner = (
      <>
        <PageIntro label={(c as { label?: string }).label || pageKey} title={c.heading || title} lead={pageKey === 'contact' ? c.body : (c as { lead?: string }).lead} />
        {pageKey !== 'contact' && c.body && <div className="container-site py-16"><Markdown source={c.body} /></div>}
        {(c.areas ?? c.values) && <BusinessGrid areas={toAreaCards(c.areas ?? c.values)} withLink={false} />}
      </>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
        <span className="size-2.5 rounded-full bg-gray-300" /><span className="size-2.5 rounded-full bg-gray-300" /><span className="size-2.5 rounded-full bg-gray-300" />
        <span className="ml-2 text-xs text-muted-foreground">미리보기 · 저장 전 변경 포함 (공개 사이트에는 게시 후 반영)</span>
      </div>
      <div className="max-h-[75vh] overflow-y-auto bg-paper text-ink">
        {/* 축소 렌더링 (CSS zoom) — 실제 사이트 스타일 그대로 */}
        <div style={{ zoom: 0.5 }} className="pointer-events-none select-none" aria-hidden>{inner}</div>
      </div>
    </div>
  );
}

function PageEditorPanel({ summary }: { summary: PageSummary }) {
  const { canWrite, canPublish } = useCmsPerms();
  const key = summary.key;
  const q = useQuery({ queryKey: ['cms', 'page', key], queryFn: () => apiGet<PageDetail>(`/cms/pages/${key}`) });
  const [content, setContent] = useState<Obj>({});
  const [seo, setSeo] = useState({ title: '', seoTitle: '', seoDescription: '', ogImageUrl: '' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setContent((q.data.content as Obj) ?? {});
    setSeo({ title: q.data.title ?? '', seoTitle: q.data.seoTitle ?? '', seoDescription: q.data.seoDescription ?? '', ogImageUrl: q.data.ogImageUrl ?? '' });
    setDirty(false);
  }, [q.data]);

  const save = useCmsMutation(
    () => apiPut<PageDetail>(`/cms/pages/${key}`, {
      ...(seo.title.trim() ? { title: seo.title.trim() } : {}),
      content: cleanContent(content),
      seoTitle: nn(seo.seoTitle), seoDescription: nn(seo.seoDescription), ogImageUrl: nn(seo.ogImageUrl),
    }),
    '초안을 저장했습니다. 공개 사이트에는 게시 후 반영됩니다.',
  );
  const publish = useCmsMutation(() => apiPost(`/cms/pages/${key}/publish`), '게시했습니다. 공개 사이트에 바로 반영됩니다.');
  const unpublish = useCmsMutation(() => apiPost(`/cms/pages/${key}/unpublish`), '게시를 중단했습니다.');
  const discard = useCmsMutation(() => apiPost(`/cms/pages/${key}/discard`), '공개본으로 되돌렸습니다.');

  const fields = PAGE_FIELDS[key] ?? [];
  const page = q.data;
  const disabled = !canWrite;

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!page) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{page.title}</span>
          {!page.exists ? <Badge variant="muted">미작성</Badge>
            : page.status === 'PUBLISHED' ? <Badge variant="success">게시됨</Badge> : <Badge variant="muted">비공개</Badge>}
          {page.exists && page.hasUnpublishedChanges && page.status === 'PUBLISHED' && <Badge variant="warning">미게시 변경 있음</Badge>}
          {dirty && <Badge variant="info">저장 안 됨</Badge>}
          <span className="text-xs text-muted-foreground">최근 게시 {fmtDateTime(page.publishedAt)} · 수정 {fmtDateTime(page.updatedAt)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {page.exists && <RevisionHistory entityType="page" entityId={key} />}
          {page.exists && <PreviewButton path={PAGE_PATHS[key] ?? '/'} label={dirty ? '미리보기 (저장된 초안)' : '미리보기'} />}
          {canWrite && page.publishedContent && page.hasUnpublishedChanges && (
            <Button size="sm" variant="ghost" loading={discard.isPending} onClick={() => window.confirm('초안을 현재 공개본으로 되돌릴까요?') && discard.mutate(undefined)}>공개본으로 되돌리기</Button>
          )}
          {canWrite && <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate(undefined)}>초안 저장</Button>}
          {canPublish && page.status === 'PUBLISHED' && (
            <Button size="sm" variant="ghost" loading={unpublish.isPending} onClick={() => window.confirm('이 페이지를 공개 사이트에서 내릴까요?') && unpublish.mutate(undefined)}>게시 중단</Button>
          )}
          {canPublish && (
            <Button size="sm" disabled={dirty || !page.exists || (page.status === 'PUBLISHED' && !page.hasUnpublishedChanges)} loading={publish.isPending} onClick={() => publish.mutate(undefined)} title={dirty ? '먼저 초안을 저장하세요' : undefined}>
              게시
            </Button>
          )}
        </div>
      </div>
      {!canPublish && canWrite && (
        <p className="text-xs text-muted-foreground">초안 저장 후 게시 승인 권한자(cms.publish)가 게시하면 공개 사이트에 반영됩니다. 저장된 미게시 변경은 CMS 개요의 대기 목록에 표시됩니다.</p>
      )}
      {(key === 'privacy' || key === 'terms') && (
        <WarningBanner title="법무 검토 필요">개인정보처리방침·이용약관은 게시 전 법무 검토를 받으세요. 시행일·처리 목적·보관 기간·위탁 현황을 반드시 기재해야 합니다.</WarningBanner>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          {fields.map((f) => (
            <FieldEditor
              key={f.name} def={f} path={f.name} disabled={disabled} value={content[f.name]}
              onChange={(v) => { setContent((c) => ({ ...c, [f.name]: v })); setDirty(true); }}
            />
          ))}
          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-sm font-semibold">페이지 · SEO</legend>
            {key === 'site' && <p className="text-xs text-muted-foreground">사이트 기본 SEO — 페이지별 SEO 가 비어 있을 때 사용됩니다.</p>}
            {(['title', 'seoTitle', 'seoDescription'] as const).map((k) => (
              <Field key={k} htmlFor={`seo-${k}`} label={{ title: '관리용 페이지명', seoTitle: 'SEO 제목', seoDescription: 'SEO 설명' }[k]}>
                {k === 'seoDescription'
                  ? <Textarea id={`seo-${k}`} rows={2} maxLength={500} disabled={disabled} value={seo[k]} onChange={(e) => { setSeo((s) => ({ ...s, [k]: e.target.value })); setDirty(true); }} />
                  : <Input id={`seo-${k}`} disabled={disabled} value={seo[k]} onChange={(e) => { setSeo((s) => ({ ...s, [k]: e.target.value })); setDirty(true); }} />}
              </Field>
            ))}
            <ImageField id="seo-og" label="공유 이미지 (OG)" hint="SNS 공유 시 표시 (권장 1200×630)" disabled={disabled} value={seo.ogImageUrl} onChange={(v) => { setSeo((s) => ({ ...s, ogImageUrl: v })); setDirty(true); }} />
            <p className="text-xs text-muted-foreground">SEO 필드는 저장 즉시 적용됩니다(본문과 달리 게시 단계 없음).</p>
          </fieldset>
        </div>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <DraftPreview pageKey={key} content={(cleanContent(content) as Obj) ?? {}} title={page.title} />
        </div>
      </div>
    </div>
  );
}

export function PagesEditor() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const list = useQuery({ queryKey: ['cms', 'pages'], queryFn: () => apiGet<PageSummary[]>('/cms/pages') });
  const key = params.get('key') ?? 'home';
  const current = useMemo(() => list.data?.find((p) => p.key === key) ?? list.data?.[0], [list.data, key]);

  return (
    <>
      <PageHeader title="고정 페이지" description="편집 내용은 초안(content)으로 저장되며, 게시 시 공개본(publishedContent)으로 복사됩니다." />
      {list.isLoading && <LoadingRows />}
      {list.error && <ErrorState error={list.error} />}
      {list.data && current && (
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <nav aria-label="페이지 선택" className="lg:sticky lg:top-4 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {list.data.map((p) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => router.replace(`${pathname}?key=${p.key}`)}
                    aria-current={p.key === current.key ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors',
                      p.key === current.key ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60',
                    )}
                  >
                    <span>{p.title}</span>
                    {!p.exists ? <span className="size-1.5 rounded-full bg-gray-300" title="미작성" />
                      : p.hasUnpublishedChanges ? <span className="size-1.5 rounded-full bg-amber-500" title="미게시 변경" />
                      : <span className="size-1.5 rounded-full bg-green-500" title="게시됨" />}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <PageEditorPanel key={current.key} summary={current} />
        </div>
      )}
    </>
  );
}
