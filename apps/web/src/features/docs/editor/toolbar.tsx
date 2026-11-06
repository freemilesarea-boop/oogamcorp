'use client';
import type { Editor } from '@tiptap/react';
import {
  Bold, ChevronRight, Code, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, Megaphone, Minus, Paperclip,
  Quote, Redo2, Strikethrough, Table, Trash, Undo2,
} from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SAFE_URL } from '../extensions';

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn('inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 [&_svg]:size-4', active && 'bg-muted text-foreground')}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;

/** 서식 도구 모음 (선택 상태 반영을 위해 트랜잭션마다 다시 그림) */
export function EditorToolbar({ editor, onUpload, collab }: { editor: Editor; onUpload: (kind: 'image' | 'file') => void; collab: boolean }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [linkOpen, setLinkOpen] = useState(false);
  useEffect(() => {
    editor.on('transaction', rerender);
    return () => {
      editor.off('transaction', rerender);
    };
  }, [editor]);
  const c = () => editor.chain().focus();
  const inTable = editor.isActive('table');

  return (
    <div role="toolbar" aria-label="서식 도구" className="sticky top-14 z-20 -mx-2 mb-4 flex flex-wrap items-center gap-0.5 border-b border-border bg-background/90 px-2 py-1.5 backdrop-blur">
      <Btn label="실행 취소 (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => c().undo().run()}><Undo2 /></Btn>
      <Btn label="다시 실행 (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => c().redo().run()}><Redo2 /></Btn>
      <Sep />
      <Btn label="제목 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 /></Btn>
      <Btn label="제목 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 /></Btn>
      <Btn label="제목 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 /></Btn>
      <Sep />
      <Btn label="굵게 (Ctrl+B)" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><Bold /></Btn>
      <Btn label="기울임 (Ctrl+I)" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><Italic /></Btn>
      <Btn label="취소선" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><Strikethrough /></Btn>
      <Btn label="인라인 코드" active={editor.isActive('code')} onClick={() => c().toggleCode().run()}><Code /></Btn>
      <Btn label="링크" active={editor.isActive('link')} onClick={() => setLinkOpen(true)}><Link2 /></Btn>
      <Sep />
      <Btn label="글머리 기호 목록" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}><List /></Btn>
      <Btn label="번호 목록" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></Btn>
      <Btn label="체크리스트" active={editor.isActive('taskList')} onClick={() => c().toggleTaskList().run()}><ListChecks /></Btn>
      <Btn label="인용" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}><Quote /></Btn>
      <Btn label="코드 블록" active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}><Code2 /></Btn>
      <Btn label="토글" onClick={() => c().setToggle().run()}><ChevronRight /></Btn>
      <Btn label="콜아웃" active={editor.isActive('callout')} onClick={() => c().setCallout().run()}><Megaphone /></Btn>
      <Btn label="구분선" onClick={() => c().setHorizontalRule().run()}><Minus /></Btn>
      <Sep />
      <Btn label="표 삽입" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></Btn>
      <Btn label="이미지 업로드" onClick={() => onUpload('image')}><ImageIcon /></Btn>
      <Btn label="파일 첨부" onClick={() => onUpload('file')}><Paperclip /></Btn>
      {inTable && (
        <>
          <Sep />
          <span className="flex flex-wrap items-center gap-1 text-xs">
            <TableAction onClick={() => c().addRowAfter().run()}>행 추가</TableAction>
            <TableAction onClick={() => c().addColumnAfter().run()}>열 추가</TableAction>
            <TableAction onClick={() => c().deleteRow().run()}>행 삭제</TableAction>
            <TableAction onClick={() => c().deleteColumn().run()}>열 삭제</TableAction>
            <Btn label="표 삭제" onClick={() => c().deleteTable().run()}><Trash /></Btn>
          </span>
        </>
      )}
      {collab && <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">실시간 공동 편집</span>}
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  );
}

function TableAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="rounded border border-border px-1.5 py-0.5 hover:bg-muted">
      {children}
    </button>
  );
}

function LinkDialog({ editor, open, onOpenChange }: { editor: Editor; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setUrl((editor.getAttributes('link').href as string | undefined) ?? '');
      setError('');
    }
  }, [open, editor]);
  const apply = () => {
    const v = url.trim();
    if (!v) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onOpenChange(false);
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(v) ? v : `https://${v}`;
    if (!SAFE_URL.test(href)) {
      setError('http(s), mailto, tel 또는 내부 경로만 사용할 수 있습니다.');
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty && !editor.isActive('link')) chain.insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>링크</DialogTitle>
          <DialogDescription>선택한 텍스트에 링크를 연결합니다. 비워 두면 링크를 제거합니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="space-y-2">
          <label htmlFor="doc-link-url" className="text-sm font-medium">주소</label>
          <Input id="doc-link-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" aria-invalid={!!error} aria-describedby={error ? 'doc-link-err' : undefined} />
          {error && <p id="doc-link-err" className="text-xs text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit">적용</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
