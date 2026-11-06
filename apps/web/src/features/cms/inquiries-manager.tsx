'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, type Paginated } from '@/lib/api';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { fmtDateTime, useCmsMutation, useCmsPerms } from './shared';
import { INQUIRY_CATEGORY_LABELS, INQUIRY_STATUS_LABELS, type InquiryDetail, type InquiryRow, type InquiryStatus } from './types';

const STATUS_VARIANT: Record<InquiryStatus, 'danger' | 'warning' | 'success' | 'muted'> = { NEW: 'danger', IN_PROGRESS: 'warning', RESOLVED: 'success', SPAM: 'muted' };
const STATUSES = Object.keys(INQUIRY_STATUS_LABELS) as InquiryStatus[];

function InquiryDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['cms', 'inquiry', id], queryFn: () => apiGet<InquiryDetail>(`/cms/inquiries/${id}`), enabled: !!id, staleTime: 0 });
  const [status, setStatus] = useState<InquiryStatus>('NEW');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (q.data) {
      setStatus(q.data.status);
      setNote(q.data.internalNote ?? '');
    }
  }, [q.data]);
  const save = useCmsMutation(() => apiPatch(`/cms/inquiries/${id}`, { status, internalNote: note.trim() ? note : null }), '저장했습니다.');
  const remove = useCmsMutation(() => apiDelete(`/cms/inquiries/${id}`), '문의를 영구 삭제했습니다.');
  const d = q.data;

  return (
    <DialogPrimitive.Root open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <DialogPrimitive.Title className="font-semibold">문의 상세</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-sm opacity-60 hover:opacity-100" aria-label="닫기"><X className="size-4" /></DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">문의 내용과 처리 상태, 내부 메모</DialogPrimitive.Description>
          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            {q.isLoading && <LoadingRows rows={4} />}
            {q.error && <ErrorState error={q.error} />}
            {d && (
              <>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="size-3.5" /> 개인정보가 포함되어 있습니다. 열람·변경 이력은 감사 로그에 기록됩니다.
                </p>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[d.status]}>{INQUIRY_STATUS_LABELS[d.status]}</Badge>
                    <Badge variant="outline">{INQUIRY_CATEGORY_LABELS[d.category] ?? d.category}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(d.createdAt)} 접수</span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold">{d.name}{d.company && <span className="ml-2 text-base font-normal text-muted-foreground">{d.company}</span>}</h2>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <a href={`mailto:${d.email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail className="size-3.5" />{d.email}</a>
                    {d.phone && <a href={`tel:${d.phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1.5 hover:underline"><Phone className="size-3.5" />{d.phone}</a>}
                  </div>
                </div>
                <div className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm leading-relaxed">{d.message}</div>
                <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <dt>개인정보 동의</dt><dd className="tabular-nums">{fmtDateTime(d.consentAt)}</dd>
                  <dt>최근 처리자</dt><dd>{d.handledBy?.name ?? '—'}</dd>
                </dl>
                <div className="space-y-4 border-t border-border pt-5">
                  <Field label="처리 상태" htmlFor="inq-status">
                    <NativeSelect id="inq-status" value={status} onChange={(e) => setStatus(e.target.value as InquiryStatus)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label="내부 메모 (문의자에게 공개되지 않음)" htmlFor="inq-note">
                    <Textarea id="inq-note" rows={4} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
          </div>
          {d && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-4">
              <Button
                variant="ghost" size="sm" className="text-danger"
                loading={remove.isPending}
                onClick={() => window.confirm('이 문의를 영구 삭제할까요? (개인정보 파기 요청 대응용, 복구 불가)') && remove.mutate(undefined, { onSuccess: onClose })}
              >
                <Trash2 /> 영구 삭제
              </Button>
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>저장</Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function InquiriesManager() {
  const { canInquiries } = useCmsPerms();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openId = params.get('id');
  const [status, setStatus] = useState<InquiryStatus | ''>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, category, query]);

  const q = useQuery({
    queryKey: ['cms', 'inquiries', status, category, query, page],
    queryFn: () => apiGet<Paginated<InquiryRow>>('/cms/inquiries', { status: status || undefined, category: category || undefined, q: query || undefined, page, pageSize: 20 }),
    enabled: canInquiries,
  });
  const setOpen = (id: string | null) => router.replace(id ? `${pathname}?id=${id}` : pathname);

  return (
    <>
      <PageHeader title="문의 접수" description="공개 사이트 문의 폼으로 접수된 내용입니다. 개인정보가 포함되므로 업무 목적 외 열람·반출을 금지합니다." />
      {!canInquiries ? (
        <ErrorState error={new ApiError(403, '문의 접수 관리 권한(cms.inquiries)이 필요합니다.')} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <form className="relative" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="이름·이메일·회사 검색" className="w-60 pl-8" placeholder="이름·이메일·회사 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
            </form>
            <NativeSelect aria-label="상태 필터" className="w-32" value={status} onChange={(e) => setStatus(e.target.value as InquiryStatus | '')}>
              <option value="">전체 상태</option>
              {STATUSES.map((s) => <option key={s} value={s}>{INQUIRY_STATUS_LABELS[s]}</option>)}
            </NativeSelect>
            <NativeSelect aria-label="유형 필터" className="w-36" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">전체 유형</option>
              {Object.entries(INQUIRY_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </div>
          {q.isLoading && <LoadingRows />}
          {q.error && <ErrorState error={q.error} />}
          {q.data && q.data.items.length === 0 && <EmptyState title="접수된 문의가 없습니다." />}
          {q.data && q.data.items.length > 0 && (
            <Table>
              <THead>
                <TR><TH>상태</TH><TH>이름</TH><TH>이메일</TH><TH>회사</TH><TH>유형</TH><TH>접수</TH></TR>
              </THead>
              <TBody>
                {q.data.items.map((i) => (
                  <TR key={i.id} className="cursor-pointer" onClick={() => setOpen(i.id)}>
                    <TD><Badge variant={STATUS_VARIANT[i.status]}>{INQUIRY_STATUS_LABELS[i.status]}</Badge></TD>
                    <TD>
                      <button type="button" className="font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(i.id); }}>{i.name}</button>
                    </TD>
                    <TD className="text-muted-foreground">{i.email}</TD>
                    <TD className="text-muted-foreground">{i.company ?? '—'}</TD>
                    <TD>{INQUIRY_CATEGORY_LABELS[i.category] ?? i.category}</TD>
                    <TD className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(i.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} onChange={setPage} />}
          <InquiryDrawer id={openId} onClose={() => setOpen(null)} />
        </>
      )}
    </>
  );
}
