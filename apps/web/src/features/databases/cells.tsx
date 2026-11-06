'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, ExternalLink, Paperclip, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { UserPicker } from '@/components/admin/user-picker';
import { Checkbox, Avatar } from '@/components/ui/misc';
import { useDirectory } from '@/lib/directory';
import { cn } from '@/lib/utils';
import { uploadFile, useRelationRows } from './api';
import { OPTION_COLORS, type DbProperty, type SelectOption } from './types';

export function OptionChip({ option, className }: { option?: SelectOption; className?: string }) {
  if (!option) return null;
  return <span className={cn('inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs font-medium', OPTION_COLORS[option.color] ?? OPTION_COLORS.gray, className)}>{option.name}</span>;
}

export function formatNumber(v: unknown, format?: string): string {
  if (typeof v !== 'number') return typeof v === 'string' ? v : '';
  switch (format) {
    case 'percent': return `${(v * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
    case 'currency_krw': return `₩${v.toLocaleString('ko-KR')}`;
    case 'currency_usd': return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'integer': return Math.round(v).toLocaleString('ko-KR');
    default: return v.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
  }
}

export function formatDateValue(v: unknown): string {
  const d = v as { start?: string; end?: string } | null;
  if (!d?.start) return '';
  const f = (s: string) => s.slice(0, 10).replace(/-/g, '.');
  return d.end ? `${f(d.start)} → ${f(d.end)}` : f(d.start);
}

/** 읽기 전용 셀 표시 (보드 카드·리스트·갤러리·캘린더 공용) */
export function CellDisplay({ prop, value }: { prop: DbProperty; value: unknown }) {
  const { data: users = [] } = useDirectory();
  const rel = useRelationRows(prop.type === 'RELATION' ? prop.config.targetDatabaseId : undefined);
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  switch (prop.type) {
    case 'TITLE':
    case 'TEXT':
      return <span className="truncate">{String(value)}</span>;
    case 'NUMBER':
      return <span className="tabular-nums">{formatNumber(value, prop.config.format)}</span>;
    case 'SELECT':
      return <OptionChip option={prop.config.options?.find((o) => o.id === value)} />;
    case 'MULTI_SELECT':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((id) => <OptionChip key={id} option={prop.config.options?.find((o) => o.id === id)} />)}
        </span>
      );
    case 'DATE':
      return <span className="tabular-nums text-muted-foreground">{formatDateValue(value)}</span>;
    case 'CHECKBOX':
      return value ? <Check className="size-4" aria-label="체크됨" /> : null;
    case 'PERSON':
      return (
        <span className="flex flex-wrap items-center gap-1">
          {(value as string[]).map((id) => {
            const u = users.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 text-xs">
                <Avatar name={u?.name ?? '?'} src={u?.avatarUrl} className="size-5" />
                {u?.name ?? '알 수 없음'}
              </span>
            );
          })}
        </span>
      );
    case 'URL':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" className="truncate underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    case 'FILE':
      return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="size-3" />첨부 {(value as string[]).length}개</span>;
    case 'RELATION':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((id) => (
            <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-xs">{rel.data?.rows.find((r) => r.id === id)?.title || (rel.isError ? '접근 불가' : '…')}</span>
          ))}
        </span>
      );
    default:
      return null;
  }
}

/** 인라인 텍스트/숫자/URL 편집 */
function InlineInput({ value, type, onCommit, placeholder, editable, display }: {
  value: string; type: 'text' | 'number' | 'url'; onCommit: (v: string) => void; placeholder?: string; editable: boolean; display: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  if (!editing) {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => setEditing(true)}
        className="flex min-h-7 w-full items-center truncate rounded px-1 text-left text-sm hover:bg-muted/70 disabled:cursor-default disabled:hover:bg-transparent"
      >
        {value ? display : <span className="text-muted-foreground/60">{editable ? placeholder ?? '비어 있음' : ''}</span>}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      ref={ref}
      type={type === 'number' ? 'number' : 'text'}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      className="h-7 w-full rounded border border-foreground/30 bg-background px-1 text-sm outline-none"
    />
  );
}

function PopoverCell({ trigger, children, editable, className }: { trigger: React.ReactNode; children: React.ReactNode; editable: boolean; className?: string }) {
  if (!editable) return <div className="flex min-h-7 items-center px-1">{trigger}</div>;
  return (
    <Popover.Root>
      <Popover.Trigger className="flex min-h-7 w-full items-center rounded px-1 text-left hover:bg-muted/70">{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className={cn('z-[60] w-64 rounded-lg border border-border bg-background p-1.5 shadow-lg', className)}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RelationPicker({ prop, value, onChange }: { prop: DbProperty; value: string[]; onChange: (v: string[] | null) => void }) {
  const rel = useRelationRows(prop.config.targetDatabaseId);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (rel.data?.rows ?? []).filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase())), [rel.data, q]);
  if (rel.isError) return <p className="p-2 text-xs text-muted-foreground">대상 데이터베이스에 접근할 수 없습니다.</p>;
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${rel.data?.name ?? ''} 검색`} className="mb-1 h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none" />
      <ul className="max-h-60 overflow-y-auto">
        {rows.map((r) => {
          const on = value.includes(r.id);
          return (
            <li key={r.id}>
              <button type="button" onClick={() => { const next = on ? value.filter((x) => x !== r.id) : [...value, r.id]; onChange(next.length ? next : null); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className="flex-1 truncate">{r.title || '제목 없음'}</span>
                {on && <Check className="size-4" />}
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">{rel.isLoading ? '불러오는 중…' : '행이 없습니다'}</li>}
      </ul>
    </>
  );
}

/** 속성 타입별 인라인 편집기. onChange(null) 은 값 지우기 */
export function CellEditor({ prop, value, rowId, editable, onChange }: {
  prop: DbProperty; value: unknown; rowId: string; editable: boolean; onChange: (v: unknown) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  switch (prop.type) {
    case 'TITLE':
    case 'TEXT':
      return <InlineInput type="text" value={(value as string) ?? ''} editable={editable} onCommit={(v) => onChange(v === '' ? null : v)} display={<span className={cn('truncate', prop.type === 'TITLE' && 'font-medium')}>{String(value ?? '')}</span>} placeholder={prop.type === 'TITLE' ? '제목 없음' : undefined} />;
    case 'URL':
      return (
        <div className="flex items-center gap-1">
          <InlineInput type="url" value={(value as string) ?? ''} editable={editable} onCommit={(v) => onChange(v === '' ? null : v.trim())} display={<span className="truncate">{String(value ?? '').replace(/^https?:\/\//, '')}</span>} placeholder="https://" />
          {typeof value === 'string' && value && <a href={value} target="_blank" rel="noopener noreferrer" aria-label="링크 열기" className="shrink-0 rounded p-1 hover:bg-muted"><ExternalLink className="size-3.5" /></a>}
        </div>
      );
    case 'NUMBER':
      return (
        <InlineInput
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          editable={editable}
          onCommit={(v) => {
            if (v.trim() === '') return onChange(null);
            const n = Number(v);
            if (!Number.isFinite(n)) return toast.error('숫자를 입력하세요.');
            onChange(n);
          }}
          display={<span className="ml-auto tabular-nums">{formatNumber(value, prop.config.format)}</span>}
        />
      );
    case 'CHECKBOX':
      return (
        <div className="flex min-h-7 items-center px-1">
          <Checkbox checked={value === true} disabled={!editable} onCheckedChange={(c) => onChange(c === true)} aria-label={prop.name} />
        </div>
      );
    case 'SELECT': {
      const opts = prop.config.options ?? [];
      return (
        <PopoverCell editable={editable} trigger={<CellDisplay prop={prop} value={value} />}>
          <ul role="listbox" aria-label={prop.name}>
            {opts.map((o) => (
              <li key={o.id}>
                <button type="button" role="option" aria-selected={value === o.id} onClick={() => onChange(o.id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-muted">
                  <OptionChip option={o} />
                  {value === o.id && <Check className="size-4" />}
                </button>
              </li>
            ))}
            {opts.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">옵션이 없습니다. 속성 메뉴에서 추가하세요.</li>}
          </ul>
          {value != null && <button type="button" onClick={() => onChange(null)} className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">선택 지우기</button>}
        </PopoverCell>
      );
    }
    case 'MULTI_SELECT': {
      const opts = prop.config.options ?? [];
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <PopoverCell editable={editable} trigger={<CellDisplay prop={prop} value={value} />}>
          <ul role="listbox" aria-multiselectable aria-label={prop.name}>
            {opts.map((o) => {
              const on = cur.includes(o.id);
              return (
                <li key={o.id}>
                  <button type="button" role="option" aria-selected={on} onClick={() => { const next = on ? cur.filter((x) => x !== o.id) : [...cur, o.id]; onChange(next.length ? next : null); }} className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-muted">
                    <OptionChip option={o} />
                    {on && <Check className="size-4" />}
                  </button>
                </li>
              );
            })}
            {opts.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">옵션이 없습니다.</li>}
          </ul>
        </PopoverCell>
      );
    }
    case 'DATE': {
      const d = (value as { start?: string; end?: string } | null) ?? null;
      const start = d?.start?.slice(0, 10) ?? '';
      const end = d?.end?.slice(0, 10) ?? '';
      return (
        <PopoverCell editable={editable} trigger={<CellDisplay prop={prop} value={value} />}>
          <div className="space-y-2 p-1 text-sm">
            <label className="block space-y-1"><span className="text-xs text-muted-foreground">시작일</span>
              <input type="date" value={start} onChange={(e) => onChange(e.target.value ? { start: e.target.value, ...(end && end >= e.target.value ? { end } : {}) } : null)} className="h-8 w-full rounded-md border border-border bg-transparent px-2" />
            </label>
            <label className="block space-y-1"><span className="text-xs text-muted-foreground">종료일 (선택)</span>
              <input type="date" value={end} min={start} disabled={!start} onChange={(e) => onChange({ start, ...(e.target.value ? { end: e.target.value } : {}) })} className="h-8 w-full rounded-md border border-border bg-transparent px-2 disabled:opacity-50" />
            </label>
            {d && <button type="button" onClick={() => onChange(null)} className="text-xs text-muted-foreground underline">날짜 지우기</button>}
          </div>
        </PopoverCell>
      );
    }
    case 'PERSON':
      return editable ? (
        <UserPicker value={(value as string[]) ?? []} onChange={(ids) => onChange(ids.length ? ids : null)} placeholder="사람 선택" className="min-h-7 border-transparent bg-transparent px-1 hover:bg-muted/70" />
      ) : (
        <div className="flex min-h-7 items-center px-1"><CellDisplay prop={prop} value={value} /></div>
      );
    case 'RELATION':
      return (
        <PopoverCell editable={editable} trigger={<CellDisplay prop={prop} value={value} />} className="w-72">
          <RelationPicker prop={prop} value={(value as string[]) ?? []} onChange={onChange} />
        </PopoverCell>
      );
    case 'FILE': {
      const ids = (value as string[]) ?? [];
      return (
        <div className="flex min-h-7 items-center gap-1 px-1">
          <CellDisplay prop={prop} value={value} />
          {editable && (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="파일 업로드">
                <Upload className="size-3.5" />
              </button>
              {ids.length > 0 && (
                <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="첨부 비우기"><X className="size-3.5" /></button>
              )}
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setUploading(true);
                  try {
                    const res = await uploadFile(f, rowId);
                    onChange([...ids, res.id]);
                  } catch (err) {
                    toast.error(`업로드 실패: ${(err as Error).message}`);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </>
          )}
        </div>
      );
    }
    default:
      return <span className="px-1 text-xs text-muted-foreground">후속 구현</span>;
  }
}
