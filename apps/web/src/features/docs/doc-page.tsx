'use client';
import * as Popover from '@radix-ui/react-popover';
import {
  AlertTriangle, Check, CloudOff, Copy, FilePlus2, History, LayoutTemplate, Loader2, Lock, MessageSquare, MoreHorizontal, Share2, SmilePlus, Trash2, Users, Wifi, X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/admin/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCan, useMe } from '@/lib/auth';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { ACCESS_LABEL, atLeast, useCreateDocument, useDocActions, useDocument, type DocumentDetail } from './api';
import { DocEditor, type SaveStatus } from './editor/doc-editor';
import { useCollab, type CollabState } from './editor/use-collab';
import { userColor } from './extensions';
import { CommentsPanel } from './panels/comments-panel';
import { ShareDialog } from './panels/share-dialog';
import { VersionsPanel } from './panels/versions-panel';

const ICONS = ['📄', '📘', '📗', '📕', '📒', '📝', '📌', '📎', '📊', '📈', '🗂️', '🗓️', '✅', '💡', '🚀', '🎯', '🧭', '🛠️', '⚙️', '🔒', '🏢', '👥', '💬', '📣', '🎨', '🧪', '📦', '💰', '🌱', '⭐'];

export function DocPage({ id }: { id: string }) {
  const query = useDocument(id);
  if (query.isLoading) return <div className="mx-auto max-w-3xl"><LoadingRows rows={8} /></div>;
  if (query.isError || !query.data) return <div className="mx-auto max-w-3xl"><ErrorState error={query.error} /></div>;
  return <DocView key={id} doc={query.data} refetch={query.refetch} />;
}

function DocView({ doc, refetch }: { doc: DocumentDetail; refetch: () => Promise<{ data?: DocumentDetail }> }) {
  const can = useCan();
  const me = useMe();
  const router = useRouter();
  const editable = atLeast(doc.access, 'EDIT') && can('docs.write');
  const canComment = atLeast(doc.access, 'COMMENT');
  const collab = useCollab(doc.id, true);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [editorKey, setEditorKey] = useState(0);
  const [overwrite, setOverwrite] = useState<{ version: number; nonce: number } | null>(null);
  const [panel, setPanel] = useState<'comments' | 'versions' | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(doc); // 에디터 초기화 기준 (재시작 시 최신 문서로 교체)

  const mode: 'collab' | 'rest' | 'pending' = collab.provider ? 'collab' : collab.status === 'connecting' ? 'pending' : 'rest';

  const reload = async () => {
    const res = await refetch();
    if (res.data) setSnapshot(res.data);
    setStatus({ kind: 'idle' });
    setEditorKey((k) => k + 1);
  };

  return (
    <div className="flex gap-6">
      <article className="mx-auto min-w-0 max-w-3xl flex-1">
        <DocHeader
          doc={doc}
          editable={editable}
          status={status}
          collab={collab}
          mode={mode}
          onShare={() => setShareOpen(true)}
          panel={panel}
          onPanel={(p) => setPanel((cur) => (cur === p ? null : p))}
          onDeleted={() => router.push('/admin/docs')}
        />

        {status.kind === 'conflict' && (
          <div role="alert" className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center">
            <AlertTriangle className="size-4 shrink-0" />
            <p className="flex-1">다른 사용자가 이 문서를 먼저 수정했습니다. 최신 내용을 불러오면 저장되지 않은 내 변경 사항은 사라집니다.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void reload()}>최신 내용 불러오기</Button>
              <Button
                size="sm"
                onClick={async () => {
                  const v = status.currentVersion ?? (await refetch()).data?.version;
                  if (v) setOverwrite({ version: v, nonce: Date.now() });
                }}
              >
                내 내용으로 덮어쓰기
              </Button>
            </div>
          </div>
        )}
        {!editable && (
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> 읽기 전용 · 내 권한: {ACCESS_LABEL[doc.access]}
          </p>
        )}

        <TitleBlock doc={doc} editable={editable} />

        <div className="mt-6">
          {mode === 'pending' ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" aria-busy="true"><Loader2 className="size-4 animate-spin" /> 실시간 편집 서버에 연결하는 중…</div>
          ) : (
            <DocEditor
              key={`${mode}:${editorKey}`}
              pageId={doc.id}
              content={snapshot.content}
              version={snapshot.version}
              editable={editable}
              collab={mode === 'collab' && collab.provider ? { provider: collab.provider, user: { name: me.user.name, color: userColor(me.user.id) } } : null}
              onStatus={setStatus}
              overwrite={overwrite}
            />
          )}
        </div>
      </article>

      {panel && (
        <aside
          aria-label={panel === 'comments' ? '댓글' : '버전 기록'}
          className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto border-l border-border bg-background p-4 shadow-xl xl:sticky xl:top-20 xl:z-auto xl:h-[calc(100vh-7rem)] xl:w-80 xl:shrink-0 xl:rounded-lg xl:border xl:shadow-none"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{panel === 'comments' ? '댓글' : '버전 기록'}</h2>
            <button type="button" onClick={() => setPanel(null)} className="rounded p-1 hover:bg-muted" aria-label="패널 닫기"><X className="size-4" /></button>
          </div>
          {panel === 'comments' ? (
            <CommentsPanel targetType="PAGE" targetId={doc.id} canComment={canComment} />
          ) : (
            <VersionsPanel
              pageId={doc.id}
              canEdit={editable}
              onRestored={() => {
                if (mode === 'collab') toast.info('복원된 내용이 잠시 후 모든 접속자에게 반영됩니다.');
                else void reload();
              }}
            />
          )}
        </aside>
      )}

      <ShareDialog pageId={doc.id} open={shareOpen} onOpenChange={setShareOpen} canManage={doc.access === 'FULL'} />
    </div>
  );
}

function StatusIndicator({ status, collab, mode }: { status: SaveStatus; collab: CollabState; mode: 'collab' | 'rest' | 'pending' }) {
  if (mode === 'collab') {
    if (collab.status === 'connected') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Wifi className="size-3.5 text-green-600" /> 실시간 연결됨</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-amber-600" title="연결이 복구되면 변경 내용이 자동으로 병합됩니다."><CloudOff className="size-3.5" /> 연결 끊김 · 재연결 중</span>;
  }
  if (mode === 'pending') return <span className="text-xs text-muted-foreground">연결 중…</span>;
  switch (status.kind) {
    case 'saving': return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 저장 중</span>;
    case 'dirty': return <span className="text-xs text-muted-foreground">변경 사항 있음</span>;
    case 'saved': return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={formatDateTime(status.at)}><Check className="size-3.5" /> 저장됨</span>;
    case 'conflict': return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="size-3.5" /> 충돌</span>;
    case 'error': return <span className="inline-flex items-center gap-1 text-xs text-red-600" title={status.message}><AlertTriangle className="size-3.5" /> 저장 실패 · 다시 시도합니다</span>;
    default: return <span className="text-xs text-muted-foreground">{collab.status === 'unavailable' ? '자동 저장 (실시간 서버 미연결)' : '자동 저장'}</span>;
  }
}

function DocHeader({
  doc, editable, status, collab, mode, onShare, panel, onPanel, onDeleted,
}: {
  doc: DocumentDetail;
  editable: boolean;
  status: SaveStatus;
  collab: CollabState;
  mode: 'collab' | 'rest' | 'pending';
  onShare: () => void;
  panel: 'comments' | 'versions' | null;
  onPanel: (p: 'comments' | 'versions') => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const can = useCan();
  const { duplicate, remove, update } = useDocActions();
  const create = useCreateDocument();
  const onError = (e: unknown) => toast.error((e as Error).message);
  return (
    <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav aria-label="문서 경로" className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
        <Link href="/admin/docs" className="shrink-0 hover:text-foreground">{doc.workspace?.name ?? '문서'}</Link>
        {doc.breadcrumbs.map((b) => (
          <span key={b.id} className="flex min-w-0 items-center gap-1">
            <span aria-hidden>/</span>
            <Link href={`/admin/docs/${b.id}`} className="truncate hover:text-foreground">{b.icon ? `${b.icon} ` : ''}{b.title || '제목 없음'}</Link>
          </span>
        ))}
        {doc.visibility !== 'WORKSPACE' && <Badge variant="muted" className="ml-1">{doc.visibility === 'PRIVATE' ? <><Lock className="size-3" /> 비공개</> : <><Users className="size-3" /> 제한됨</>}</Badge>}
        {doc.isTemplate && <Badge variant="outline" className="ml-1"><LayoutTemplate className="size-3" /> 템플릿</Badge>}
      </nav>
      <div className="flex items-center gap-1.5">
        <span aria-live="polite"><StatusIndicator status={status} collab={collab} mode={mode} /></span>
        {mode === 'collab' && collab.peers.length > 0 && (
          <div className="ml-1 flex -space-x-1.5" aria-label={`함께 보는 사람 ${collab.peers.length}명`}>
            {collab.peers.slice(0, 4).map((p) => (
              <span key={p.clientId} title={p.name} className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background" style={{ background: p.color }}>
                {p.name.slice(0, 1)}
              </span>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={onShare}><Share2 /> 공유</Button>
        <Button size="icon-sm" variant={panel === 'comments' ? 'secondary' : 'ghost'} onClick={() => onPanel('comments')} aria-label="댓글" aria-pressed={panel === 'comments'} title="댓글"><MessageSquare /></Button>
        <Button size="icon-sm" variant={panel === 'versions' ? 'secondary' : 'ghost'} onClick={() => onPanel('versions')} aria-label="버전 기록" aria-pressed={panel === 'versions'} title="버전 기록"><History /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="문서 메뉴"><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editable && (
              <DropdownMenuItem onSelect={() => create.mutate({ parentId: doc.id }, { onSuccess: (d) => router.push(`/admin/docs/${d.id}`), onError })}>
                <FilePlus2 /> 하위 문서 추가
              </DropdownMenuItem>
            )}
            {can('docs.write') && (
              <DropdownMenuItem onSelect={() => duplicate.mutate({ id: doc.id, includeChildren: false }, { onSuccess: (r) => router.push(`/admin/docs/${r.id}`), onError })}>
                <Copy /> 복제
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onSelect={() => update.mutate({ id: doc.id, isTemplate: !doc.isTemplate }, { onSuccess: () => toast.success(doc.isTemplate ? '템플릿에서 해제했습니다.' : '템플릿으로 지정했습니다.'), onError })}>
                <LayoutTemplate /> {doc.isTemplate ? '템플릿 지정 해제' : '템플릿으로 지정'}
              </DropdownMenuItem>
            )}
            {editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600" onSelect={() => remove.mutate(doc.id, { onSuccess: (r) => { toast.success(`휴지통으로 이동했습니다${r.count > 1 ? ` (하위 문서 ${r.count - 1}개 포함)` : ''}.`); onDeleted(); }, onError })}>
                  <Trash2 /> 휴지통으로 이동
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              작성 {doc.createdBy?.name ?? '-'} · {formatDateTime(doc.createdAt)}<br />
              수정 {doc.updatedBy?.name ?? '-'} · {timeAgo(doc.updatedAt)}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** 아이콘 + 제목 (디바운스 PATCH, 트리 동기화) */
function TitleBlock({ doc, editable }: { doc: DocumentDetail; editable: boolean }) {
  const { update } = useDocActions();
  const [title, setTitle] = useState(doc.title);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastSaved = useRef(doc.title);

  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value === lastSaved.current) return;
    lastSaved.current = value;
    update.mutate({ id: doc.id, title: value }, { onError: (e) => toast.error((e as Error).message) });
  };
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="group">
      <div className="mb-2 flex items-center gap-2">
        {doc.icon || editable ? (
          <Popover.Root>
            <Popover.Trigger
              disabled={!editable}
              className={cn('rounded-md text-4xl leading-none', editable && 'hover:bg-muted', !doc.icon && 'text-sm text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
              aria-label="아이콘 변경"
            >
              {doc.icon ?? <span className="inline-flex items-center gap-1 px-1.5 py-1"><SmilePlus className="size-4" /> 아이콘 추가</span>}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} className="z-50 w-72 rounded-lg border border-border bg-background p-2 shadow-lg">
                <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="아이콘">
                  {ICONS.map((i) => (
                    <Popover.Close key={i} asChild>
                      <button type="button" role="option" aria-selected={doc.icon === i} className="rounded p-1 text-xl hover:bg-muted" onClick={() => update.mutate({ id: doc.id, icon: i })}>{i}</button>
                    </Popover.Close>
                  ))}
                </div>
                {doc.icon && (
                  <Popover.Close asChild>
                    <button type="button" className="mt-2 w-full rounded-md border border-border py-1 text-xs hover:bg-muted" onClick={() => update.mutate({ id: doc.id, icon: null })}>아이콘 제거</button>
                  </Popover.Close>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : null}
      </div>
      <textarea
        ref={ref}
        rows={1}
        value={title}
        readOnly={!editable}
        maxLength={300}
        placeholder="제목 없음"
        aria-label="문서 제목"
        onChange={(e) => {
          const v = e.target.value.replace(/\n/g, '');
          setTitle(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), 700);
        }}
        onBlur={() => commit(title)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(title);
            (document.querySelector('.doc-prose') as HTMLElement | null)?.focus();
          }
        }}
        className="block w-full resize-none overflow-hidden bg-transparent text-3xl font-bold leading-tight tracking-tight placeholder:text-gray-300 focus:outline-none dark:placeholder:text-gray-700 md:text-4xl"
      />
    </div>
  );
}
