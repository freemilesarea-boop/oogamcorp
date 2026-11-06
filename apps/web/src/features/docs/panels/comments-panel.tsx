'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CornerDownRight, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { apiDelete, apiGet, apiPatch, apiPost, type Paginated } from '@/lib/api';
import { useDirectory, type DirectoryUser } from '@/lib/directory';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import type { CommentItem } from '../api';

export type CommentTarget = 'PAGE' | 'TASK' | 'PROJECT' | 'APPROVAL' | 'DATABASE_ROW';

/** 범용 댓글 패널 (스레드 1단계 답글, @멘션, 해결 처리) */
export function CommentsPanel({ targetType, targetId, canComment }: { targetType: CommentTarget; targetId: string; canComment: boolean }) {
  const qc = useQueryClient();
  const key = ['comments', targetType, targetId];
  const [showResolved, setShowResolved] = useState(false);
  const list = useQuery({
    queryKey: key,
    queryFn: () => apiGet<Paginated<CommentItem>>('/comments', { targetType, targetId, pageSize: 100, order: 'asc' }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: (b: { body: string; mentions: string[]; parentId?: string }) => apiPost('/comments', { targetType, targetId, ...b }),
    onSuccess: invalidate,
  });

  const threads = list.data?.items ?? [];
  const open = threads.filter((t) => !t.resolvedAt);
  const resolved = threads.filter((t) => t.resolvedAt);

  return (
    <div className="space-y-4">
      {canComment ? (
        <Composer placeholder="댓글 남기기 — @로 멘션" submitLabel="댓글" pending={create.isPending} onSubmit={(b, m) => create.mutateAsync({ body: b, mentions: m })} />
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">이 항목에 댓글을 작성할 권한이 없습니다.</p>
      )}
      {list.isLoading ? <LoadingRows rows={3} /> : list.isError ? <ErrorState error={list.error} /> : threads.length === 0 ? (
        <EmptyState title="댓글이 없습니다" description="질문이나 의견을 남겨 팀과 논의해 보세요." icon={MessageSquare} />
      ) : (
        <>
          <ul className="space-y-3">
            {open.map((t) => <Thread key={t.id} thread={t} canComment={canComment} onChanged={invalidate} onReply={(b, m) => create.mutateAsync({ body: b, mentions: m, parentId: t.id })} />)}
          </ul>
          {open.length === 0 && <p className="text-center text-xs text-muted-foreground">열린 댓글이 없습니다.</p>}
          {resolved.length > 0 && (
            <div>
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowResolved((v) => !v)} aria-expanded={showResolved}>
                해결된 댓글 {resolved.length}개 {showResolved ? '숨기기' : '보기'}
              </button>
              {showResolved && (
                <ul className="mt-3 space-y-3 opacity-80">
                  {resolved.map((t) => <Thread key={t.id} thread={t} canComment={canComment} onChanged={invalidate} onReply={(b, m) => create.mutateAsync({ body: b, mentions: m, parentId: t.id })} />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Thread({ thread, canComment, onChanged, onReply }: { thread: CommentItem; canComment: boolean; onChanged: () => void; onReply: (body: string, mentions: string[]) => Promise<unknown> }) {
  const [replying, setReplying] = useState(false);
  const resolve = useMutation({
    mutationFn: (resolved: boolean) => apiPost(`/comments/${thread.id}/resolve`, { resolved }),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <li className={cn('rounded-lg border border-border p-3', thread.resolvedAt && 'bg-muted/40')}>
      <CommentBody c={thread} onChanged={onChanged} />
      {thread.replies && thread.replies.length > 0 && (
        <ul className="mt-3 space-y-3 border-l border-border pl-3">
          {thread.replies.map((r) => <li key={r.id}><CommentBody c={r} onChanged={onChanged} /></li>)}
        </ul>
      )}
      {canComment && (
        <div className="mt-2 flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setReplying((v) => !v)}><CornerDownRight className="size-3.5" /> 답글</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" loading={resolve.isPending} onClick={() => resolve.mutate(!thread.resolvedAt)}>
            {thread.resolvedAt ? <><RotateCcw className="size-3.5" /> 다시 열기</> : <><Check className="size-3.5" /> 해결</>}
          </Button>
        </div>
      )}
      {replying && (
        <div className="mt-2">
          <Composer autoFocus placeholder="답글 — @로 멘션" submitLabel="답글" onCancel={() => setReplying(false)} onSubmit={async (b, m) => { await onReply(b, m); setReplying(false); }} />
        </div>
      )}
    </li>
  );
}

/** 멘션된 사용자 이름(@이름)을 강조해 평문으로 렌더링 (HTML 미해석) */
function RichText({ text, mentions }: { text: string; mentions: { name: string }[] }) {
  const parts = useMemo(() => {
    const names = mentions.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length) return [text];
    const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
    return text.split(re);
  }, [text, mentions]);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="rounded bg-muted px-0.5 font-medium">{p}</span> : <span key={i}>{p}</span>))}
    </p>
  );
}

function CommentBody({ c, onChanged }: { c: CommentItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const update = useMutation({ mutationFn: (b: { body: string; mentions: string[] }) => apiPatch(`/comments/${c.id}`, b), onSuccess: () => { setEditing(false); onChanged(); } });
  const remove = useMutation({ mutationFn: () => apiDelete(`/comments/${c.id}`), onSuccess: onChanged, onError: (e) => toast.error((e as Error).message) });
  if (c.deleted) return <p className="text-sm italic text-muted-foreground">삭제된 댓글입니다.</p>;
  return (
    <div className="flex gap-2.5">
      <Avatar name={c.author?.name} src={c.author?.avatarUrl} className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{c.author?.name ?? '알 수 없음'}</span>
          <time className="text-xs text-muted-foreground" dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>{timeAgo(c.createdAt)}</time>
          {c.editedAt && <span className="text-xs text-muted-foreground">(수정됨)</span>}
          {(c.canEdit || c.canDelete) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="댓글 메뉴"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {c.canEdit && <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> 수정</DropdownMenuItem>}
                {c.canDelete && <DropdownMenuItem className="text-red-600" onSelect={() => remove.mutate()}><Trash2 /> 삭제</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <Composer
              autoFocus
              initial={c.body}
              initialMentions={c.mentions}
              submitLabel="저장"
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSubmit={(b, m) => update.mutateAsync({ body: b, mentions: m })}
            />
          </div>
        ) : (
          <RichText text={c.body} mentions={c.mentions} />
        )}
      </div>
    </div>
  );
}

/** 댓글 입력: '@' 입력 시 사용자 자동완성 → 본문에 @이름 삽입 + 멘션 ID 수집 */
function Composer({
  onSubmit, onCancel, placeholder, submitLabel, pending, autoFocus, initial = '', initialMentions = [],
}: {
  onSubmit: (body: string, mentions: string[]) => Promise<unknown>;
  onCancel?: () => void;
  placeholder?: string;
  submitLabel: string;
  pending?: boolean;
  autoFocus?: boolean;
  initial?: string;
  initialMentions?: { id: string; name: string }[];
}) {
  const { data: users = [] } = useDirectory();
  const [body, setBody] = useState(initial);
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map(initialMentions.map((m) => [m.name, m.id])));
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 6);
  }, [users, query]);

  const detect = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,20})$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };
  const pick = (u: DirectoryUser) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = body.slice(0, caret).replace(/@([^\s@]{0,20})$/, `@${u.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setPicked((p) => new Map(p).set(u.name, u.id));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };
  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    const mentions = [...picked.entries()].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id);
    setBusy(true);
    try {
      await onSubmit(text, [...new Set(mentions)]);
      setBody('');
      setPicked(new Map());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={body}
        autoFocus={autoFocus}
        maxLength={5000}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder ?? '댓글'}
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => { setBody(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        className="block min-h-[64px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:outline-none"
      />
      {matches.length > 0 && (
        <ul id={listId} role="listbox" aria-label="멘션할 사용자" className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-border bg-background p-1 shadow-lg">
          {matches.map((u, i) => (
            <li key={u.id}>
              <button type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', i === active && 'bg-muted')}>
                <Avatar name={u.name} src={u.avatarUrl} className="size-5" />
                <span className="truncate">{u.name}</span>
                <span className="truncate text-xs text-muted-foreground">{u.department?.name ?? u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted-foreground">Ctrl/⌘+Enter 로 등록</span>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>취소</Button>}
        <Button size="sm" onClick={() => void submit()} loading={busy || pending} disabled={!body.trim()}>{submitLabel}</Button>
      </div>
    </div>
  );
}
