'use client';
import { APPROVAL_TYPE_LABELS } from '@oogam/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, Clock, CornerUpLeft, Minus, Paperclip, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { uploadFile } from '@/features/finance/api';
import { krw } from '@/features/finance/common';
import { FileLink, useTargetFiles } from '@/features/finance/files';
import { ApprovalFormDialog } from './approval-form';
import { ACTION_LABELS, STEP_STATUS_LABELS, type ApprovalDetail, type StepStatus } from './types';
import { ApprovalStatusBadge } from './ui';

type ActKind = 'approve' | 'reject' | 'request-changes' | 'cancel';
const ACT_META: Record<ActKind, { title: string; label: string; required: boolean; variant: 'default' | 'danger' | 'outline' }> = {
  approve: { title: '승인', label: '승인', required: false, variant: 'default' },
  reject: { title: '반려', label: '반려', required: true, variant: 'danger' },
  'request-changes': { title: '보완 요청', label: '보완 요청', required: true, variant: 'outline' },
  cancel: { title: '결재 취소', label: '취소하기', required: false, variant: 'danger' },
};

function StepIcon({ status }: { status: StepStatus }) {
  const cls = 'size-3.5';
  const map: Record<StepStatus, React.ReactNode> = {
    APPROVED: <Check className={cls} />, REJECTED: <X className={cls} />, CHANGES_REQUESTED: <CornerUpLeft className={cls} />,
    PENDING: <Clock className={cls} />, WAITING: <CircleDashed className={cls} />, SKIPPED: <Minus className={cls} />,
  };
  return (
    <span className={cn(
      'flex size-7 shrink-0 items-center justify-center rounded-full border',
      status === 'APPROVED' && 'border-foreground bg-foreground text-background',
      status === 'PENDING' && 'border-foreground',
      status === 'REJECTED' && 'border-danger bg-danger text-white',
      status === 'CHANGES_REQUESTED' && 'border-warning text-warning',
      (status === 'WAITING' || status === 'SKIPPED') && 'border-border text-muted-foreground',
    )} aria-hidden>{map[status]}</span>
  );
}

export function useApproval(id: string | null) {
  return useQuery({ queryKey: ['approvals', 'detail', id], queryFn: () => apiGet<ApprovalDetail>(`/approvals/${id}`), enabled: !!id, retry: false });
}

export function ApprovalDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: a, isLoading, error } = useApproval(id);
  const files = useTargetFiles('APPROVAL', id);
  const [acting, setActing] = useState<ActKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['approvals'] });

  const act = useMutation({
    mutationFn: ({ kind, text }: { kind: ActKind | 'submit'; text?: string }) => apiPost<ApprovalDetail>(`/approvals/${id}/${kind}`, { version: a?.version, comment: text || undefined }),
    onSuccess: (_d, { kind }) => {
      toast.success({ approve: '승인했습니다.', reject: '반려했습니다.', 'request-changes': '보완을 요청했습니다.', cancel: '결재를 취소했습니다.', submit: '상신했습니다.' }[kind]);
      setActing(null);
      invalidate();
    },
    onError: (e: Error) => { toast.error(e.message); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/approvals/${id}`),
    onSuccess: () => { toast.success('삭제했습니다.'); invalidate(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const addComment = useMutation({
    mutationFn: () => apiPost(`/approvals/${id}/comments`, { comment: comment.trim() }),
    onSuccess: () => { setComment(''); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const upload = useMutation({
    mutationFn: (f: File) => uploadFile(f, 'APPROVAL', id),
    onSuccess: () => { toast.success('첨부했습니다.'); qc.invalidateQueries({ queryKey: ['files', 'APPROVAL', id] }); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !a) return <LoadingRows rows={6} />;

  const stepComments = new Map<string, { comment: string | null; createdAt: string }>();
  for (const act of a.actions) if (act.stepId && act.action !== 'COMMENT') stepComments.set(act.stepId, { comment: act.comment, createdAt: act.createdAt });
  const involved = a.requester?.id === me.user.id || a.steps.some((s) => s.approver.id === me.user.id);
  const attachments = a.attachments.map((f) => ({ ...f, url: files.data?.find((x) => x.id === f.id)?.url }));

  return (
    <article className="space-y-6" aria-labelledby="approval-title">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{a.number}</span>
          <span>·</span>
          <span>{APPROVAL_TYPE_LABELS[a.type]}</span>
          <ApprovalStatusBadge status={a.status} />
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 hover:bg-muted" aria-label="상세 닫기"><X className="size-4" /></button>
        </div>
        <h2 id="approval-title" className="text-xl font-semibold tracking-tight">{a.title}</h2>
        <p className="text-sm text-muted-foreground">
          기안 {a.requester?.name ?? '-'} · {a.submittedAt ? `상신 ${formatDateTime(a.submittedAt)}` : `작성 ${formatDateTime(a.createdAt)}`}
          {a.completedAt && ` · 완료 ${formatDateTime(a.completedAt)}`}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {a.can.approve && (
          <>
            <Button onClick={() => setActing('approve')}>승인</Button>
            <Button variant="outline" onClick={() => setActing('request-changes')}>보완 요청</Button>
            <Button variant="danger" onClick={() => setActing('reject')}>반려</Button>
          </>
        )}
        {a.can.edit && <Button variant="outline" onClick={() => setEditing(true)}>수정</Button>}
        {a.can.submit && <Button onClick={() => act.mutate({ kind: 'submit' })} loading={act.isPending}><Send /> {a.status === 'CHANGES_REQUESTED' ? '재상신' : '상신'}</Button>}
        {a.can.cancel && <Button variant="ghost" onClick={() => setActing('cancel')}>결재 취소</Button>}
        {a.can.delete && <Button variant="ghost" className="text-danger" onClick={() => confirm('문서를 삭제할까요?') && remove.mutate()}>삭제</Button>}
      </div>

      {(a.amount || a.project || a.budget || a.transaction) && (
        <dl className="grid gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
          {a.amount && <div><dt className="text-xs text-muted-foreground">금액</dt><dd className="mt-0.5 font-semibold tabular-nums">{krw(a.amount)}</dd></div>}
          {a.project && <div><dt className="text-xs text-muted-foreground">프로젝트</dt><dd className="mt-0.5"><Link href={`/admin/projects/${a.project.id}`} className="hover:underline">{a.project.key} · {a.project.name}</Link></dd></div>}
          {a.budget && <div><dt className="text-xs text-muted-foreground">연결 예산</dt><dd className="mt-0.5">{a.budget.fiscalYear} {a.budget.name} · 편성 {krw(a.budget.plannedAmount)}</dd></div>}
          {a.transaction && <div><dt className="text-xs text-muted-foreground">연결 거래</dt><dd className="mt-0.5">{formatDate(a.transaction.txDate)} {a.transaction.description} · {krw(a.transaction.totalAmount)}</dd></div>}
        </dl>
      )}

      <section aria-label="본문">
        <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed">{a.content || <span className="text-muted-foreground">내용 없음</span>}</div>
      </section>

      <section aria-labelledby="line-h">
        <h3 id="line-h" className="mb-3 text-[13px] font-medium">결재선</h3>
        <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-3.5 before:top-3 before:w-px before:bg-border">
          <li className="relative flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground bg-background" aria-hidden><Send className="size-3.5" /></span>
            <div className="text-sm"><p><span className="font-medium">{a.requester?.name}</span> <span className="text-muted-foreground">기안</span></p></div>
          </li>
          {a.steps.map((s) => {
            const c = stepComments.get(s.id);
            return (
              <li key={s.id} className="relative flex gap-3">
                <StepIcon status={s.status} />
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{s.order}단계</span>
                    <Avatar name={s.approver.name} src={s.approver.avatarUrl} className="size-5" />
                    <span className="font-medium">{s.approver.name}</span>
                    <span className={cn('text-xs', s.status === 'PENDING' ? 'font-medium text-foreground' : 'text-muted-foreground')}>{STEP_STATUS_LABELS[s.status]}</span>
                    {s.actedAt && <span className="text-xs text-muted-foreground">{formatDateTime(s.actedAt)}</span>}
                  </p>
                  {c?.comment && <p className="mt-1 whitespace-pre-wrap rounded-md border border-border px-3 py-2 text-[13px]">{c.comment}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="att-h">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="att-h" className="text-[13px] font-medium">첨부 {attachments.length > 0 && <span className="text-muted-foreground">{attachments.length}</span>}</h3>
          {involved && a.status !== 'APPROVED' && a.status !== 'CANCELLED' && (
            <>
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} loading={upload.isPending}><Paperclip /> 첨부</Button>
              <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            </>
          )}
        </div>
        {attachments.length === 0 ? <p className="text-sm text-muted-foreground">첨부 파일이 없습니다.</p> : (
          <ul className="space-y-1 text-sm">{attachments.map((f) => <li key={f.id}><FileLink file={f} url={f.url} /></li>)}</ul>
        )}
      </section>

      <section aria-labelledby="hist-h">
        <h3 id="hist-h" className="mb-2 text-[13px] font-medium">처리 이력 · 의견</h3>
        {a.actions.length === 0 ? <p className="text-sm text-muted-foreground">아직 이력이 없습니다.</p> : (
          <ul className="space-y-2">
            {a.actions.map((h) => (
              <li key={h.id} className="flex gap-2 text-sm">
                <Avatar name={h.actor?.name} src={h.actor?.avatarUrl} className="size-6" />
                <div className="min-w-0">
                  <p><span className="font-medium">{h.actor?.name ?? '-'}</span> <span className="text-muted-foreground">{ACTION_LABELS[h.action]} · {formatDateTime(h.createdAt)}</span></p>
                  {h.comment && <p className="whitespace-pre-wrap text-[13px]">{h.comment}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(); }}>
          <Textarea aria-label="의견 입력" value={comment} onChange={(e) => setComment(e.target.value)} rows={1} className="min-h-9" maxLength={2000} placeholder="의견 남기기" />
          <Button type="submit" variant="outline" disabled={!comment.trim()} loading={addComment.isPending}>등록</Button>
        </form>
      </section>

      {acting && (
        <ActionDialog kind={acting} pending={act.isPending} onClose={() => setActing(null)} onSubmit={(text) => act.mutate({ kind: acting, text })} />
      )}
      <ApprovalFormDialog open={editing} onOpenChange={setEditing} approval={a} />
    </article>
  );
}

function ActionDialog({ kind, onClose, onSubmit, pending }: { kind: ActKind; onClose: () => void; onSubmit: (text: string) => void; pending: boolean }) {
  const meta = ACT_META[kind];
  const [text, setText] = useState('');
  const missing = meta.required && !text.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>
            {kind === 'request-changes' ? '기안자가 내용을 보완해 재상신하면 결재선이 처음부터 다시 진행됩니다.'
              : kind === 'reject' ? '반려하면 결재가 종료됩니다.'
                : kind === 'cancel' ? '취소한 문서는 다시 상신할 수 없습니다.'
                  : '승인하면 다음 결재자에게 넘어가거나 최종 승인됩니다.'}
          </DialogDescription>
        </DialogHeader>
        <Field label={meta.required ? '의견 (필수)' : '의견 (선택)'} htmlFor="act-comment" error={missing && text.length > 0 ? '의견을 입력하세요.' : undefined}>
          <Textarea id="act-comment" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>닫기</Button>
          <Button variant={meta.variant} onClick={() => onSubmit(text.trim())} disabled={missing} loading={pending}>{meta.label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
