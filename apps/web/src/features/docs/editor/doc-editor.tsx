'use client';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { buildExtensions } from '../extensions';
import { slashItems } from '../extensions/slash-command';
import { uploadFile, type DocJson } from '../api';
import { EditorToolbar } from './toolbar';

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'conflict'; currentVersion?: number }
  | { kind: 'error'; message: string };

const AUTOSAVE_MS = 1500;

interface Props {
  pageId: string;
  content: DocJson | null;
  version: number;
  editable: boolean;
  /** 실시간 협업 모드 (지정 시 REST 본문 저장을 하지 않음 — 협업 서버가 영속화) */
  collab: { provider: HocuspocusProvider; user: { name: string; color: string } } | null;
  onStatus: (s: SaveStatus) => void;
  /** 충돌 해결 시 덮어쓰기 요청 신호 (값이 바뀌면 currentVersion 기준으로 강제 저장) */
  overwrite?: { version: number; nonce: number } | null;
}

/**
 * Tiptap 문서 에디터.
 * REST 모드: 1.5초 디바운스 자동 저장(PUT /documents/:id/content, baseVersion 낙관적 동시성) → 409 시 충돌 상태.
 * 협업 모드: Collaboration/CollaborationCursor + HocuspocusProvider (Yjs). 저장은 협업 서버가 담당.
 */
export function DocEditor({ pageId, content, version, editable, collab, onStatus, overwrite }: Props) {
  const versionRef = useRef(version);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const blockedRef = useRef(false); // 충돌 상태에서는 자동 저장 중지
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const isCollab = !!collab;

  const save = useCallback(async (opts: { keepalive?: boolean; baseVersion?: number } = {}) => {
    const editor = editorRef.current;
    if (!editor || isCollab) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    onStatusRef.current({ kind: 'saving' });
    try {
      const res = await api<{ version: number }>(`/documents/${pageId}/content`, {
        method: 'PUT',
        json: { content: editor.getJSON(), baseVersion: opts.baseVersion ?? versionRef.current },
        keepalive: opts.keepalive,
      });
      versionRef.current = res.version;
      blockedRef.current = false;
      onStatusRef.current(dirtyRef.current ? { kind: 'dirty' } : { kind: 'saved', at: new Date() });
    } catch (e) {
      dirtyRef.current = true;
      if (e instanceof ApiError && e.status === 409) {
        blockedRef.current = true;
        onStatusRef.current({ kind: 'conflict', currentVersion: (e.body as { currentVersion?: number } | undefined)?.currentVersion });
      } else {
        onStatusRef.current({ kind: 'error', message: (e as Error).message });
        // 네트워크/서버 오류는 잠시 후 재시도
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void save(), 5000);
      }
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !blockedRef.current) {
        pendingRef.current = false;
        void save();
      }
    }
  }, [pageId, isCollab]);

  const schedule = useCallback(() => {
    if (isCollab) return;
    dirtyRef.current = true;
    if (blockedRef.current) return;
    onStatusRef.current({ kind: 'dirty' });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), AUTOSAVE_MS);
  }, [isCollab, save]);

  const openUpload = useCallback((kind: 'image' | 'file') => (kind === 'image' ? imageInput : fileInput).current?.click(), []);

  const extensions = useMemo(
    () => buildExtensions({ collab: collab ?? undefined, getSlashItems: editable ? () => slashItems(openUpload) : undefined }),
    // 확장 구성은 모드가 바뀔 때만 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collab?.provider, editable],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions,
      // 협업 모드에서는 Yjs 문서가 내용의 원천이다
      content: collab ? undefined : (content ?? { type: 'doc', content: [] }),
      editorProps: {
        attributes: { class: 'doc-prose', 'aria-label': '문서 본문', role: 'textbox', 'aria-multiline': 'true' },
        handleDrop: (_view, event) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
          if (!files.length || !editable) return false;
          event.preventDefault();
          void handleFiles(files);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length || !editable) return false;
          void handleFiles(files);
          return true;
        },
      },
      onUpdate: ({ transaction }) => {
        if (!editable || !transaction.docChanged) return;
        schedule();
      },
    },
    [extensions],
  );
  editorRef.current = editor;

  async function handleFiles(files: File[], kind?: 'image' | 'file') {
    const ed = editorRef.current;
    if (!ed) return;
    for (const file of files) {
      const id = toast.loading(`${file.name} 업로드 중…`);
      try {
        const up = await uploadFile(file, pageId);
        const asImage = kind === 'image' || (kind === undefined && file.type.startsWith('image/'));
        if (asImage) ed.chain().focus().setImage({ src: up.url, alt: up.originalName, title: up.originalName }).run();
        else ed.chain().focus().setFileAttachment({ href: up.url, name: up.originalName, size: up.size, mime: up.mimeType }).run();
        toast.success('업로드했습니다.', { id });
      } catch (e) {
        toast.error((e as Error).message, { id });
      }
    }
  }

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // 충돌 해결: 현재 서버 버전을 기준으로 내 내용 덮어쓰기
  useEffect(() => {
    if (!overwrite) return;
    blockedRef.current = false;
    versionRef.current = overwrite.version;
    void save({ baseVersion: overwrite.version });
  }, [overwrite, save]);

  // 페이지 이탈 시 미저장 내용 저장 + 경고
  useEffect(() => {
    if (isCollab) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current && !blockedRef.current) void save({ keepalive: true });
    };
  }, [isCollab, save]);

  if (!editor) return <div className="doc-prose animate-pulse text-muted-foreground" aria-busy="true">불러오는 중…</div>;

  return (
    <div>
      {editable && <EditorToolbar editor={editor} onUpload={openUpload} collab={!!collab} />}
      <EditorContent editor={editor} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void handleFiles(f, 'image'); }} />
      <input ref={fileInput} type="file" hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void handleFiles(f, 'file'); }} />
    </div>
  );
}

/** 읽기 전용 렌더링 (버전 미리보기 등) */
export function DocPreview({ content }: { content: unknown }) {
  const extensions = useMemo(() => buildExtensions(), []);
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions, content: (content as DocJson) ?? { type: 'doc', content: [] } }, [content]);
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}
