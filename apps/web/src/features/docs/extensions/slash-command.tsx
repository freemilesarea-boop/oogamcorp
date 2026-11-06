'use client';
import { Extension, ReactRenderer, type Editor, type Range } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import {
  ChevronRight, Code2, File, Heading1, Heading2, Heading3, Image as ImageIcon, List, ListChecks, ListOrdered, Megaphone, Minus, Quote, Table, Type,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SlashItem {
  key: string;
  title: string;
  description: string;
  keywords: string[];
  icon: typeof Type;
  run: (editor: Editor) => void;
}

/** 블록 선택 항목. 이미지/파일은 업로드 콜백을 사용 */
export function slashItems(onUpload: (kind: 'image' | 'file') => void): SlashItem[] {
  return [
    { key: 'text', title: '텍스트', description: '일반 문단', keywords: ['text', 'paragraph', '본문', '문단'], icon: Type, run: (e) => e.chain().focus().setParagraph().run() },
    { key: 'h1', title: '제목 1', description: '큰 제목', keywords: ['h1', 'heading', '제목'], icon: Heading1, run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { key: 'h2', title: '제목 2', description: '중간 제목', keywords: ['h2', 'heading', '제목'], icon: Heading2, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { key: 'h3', title: '제목 3', description: '작은 제목', keywords: ['h3', 'heading', '제목'], icon: Heading3, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { key: 'bullet', title: '글머리 기호 목록', description: '순서 없는 목록', keywords: ['bullet', 'list', 'ul', '목록'], icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: 'ordered', title: '번호 목록', description: '순서 있는 목록', keywords: ['number', 'ordered', 'ol', '번호'], icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: 'task', title: '체크리스트', description: '할 일 목록', keywords: ['todo', 'task', 'check', '체크', '할일'], icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run() },
    { key: 'toggle', title: '토글', description: '접고 펼치는 블록', keywords: ['toggle', 'details', '토글', '접기'], icon: ChevronRight, run: (e) => e.chain().focus().setToggle().run() },
    { key: 'callout', title: '콜아웃', description: '아이콘이 있는 강조 블록', keywords: ['callout', 'note', '콜아웃', '강조'], icon: Megaphone, run: (e) => e.chain().focus().setCallout().run() },
    { key: 'quote', title: '인용', description: '인용문', keywords: ['quote', 'blockquote', '인용'], icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
    { key: 'divider', title: '구분선', description: '가로 구분선', keywords: ['divider', 'hr', 'line', '구분'], icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
    { key: 'code', title: '코드 블록', description: '코드 스니펫', keywords: ['code', 'snippet', '코드'], icon: Code2, run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { key: 'table', title: '표', description: '3×3 표 삽입', keywords: ['table', 'grid', '표', '테이블'], icon: Table, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { key: 'image', title: '이미지', description: '이미지 업로드', keywords: ['image', 'picture', 'photo', '이미지', '사진'], icon: ImageIcon, run: () => onUpload('image') },
    { key: 'file', title: '파일', description: '파일 첨부', keywords: ['file', 'attachment', '파일', '첨부'], icon: File, run: () => onUpload('file') },
  ];
}

export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)));
}

interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SlashMenu = forwardRef<MenuHandle, { items: SlashItem[]; command: (item: SlashItem) => void }>(function SlashMenu({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { setIndex((i) => (i - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { command(items[index]); return true; }
      return false;
    },
  }));
  return (
    <div ref={listRef} role="listbox" aria-label="블록 선택" className="max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-xl">
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">일치하는 블록이 없습니다</p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={i === index}
            data-index={i}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(item)}
            className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm', i === index && 'bg-muted')}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background"><item.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="block font-medium">{item.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
});

/** "/" 입력 시 블록 선택 메뉴 (@tiptap/suggestion 기반, 별도 팝업 라이브러리 없이 고정 위치 렌더링) */
export const SlashCommand = Extension.create<{ getItems: () => SlashItem[] }>({
  name: 'slashCommand',
  addOptions() {
    return { getItems: () => [] };
  },
  addProseMirrorPlugins() {
    const getItems = this.options.getItems;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          // 코드 블록 안에서는 비활성
          return $from.parent.type.name !== 'codeBlock';
        },
        items: ({ query }) => filterSlashItems(getItems(), query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let renderer: ReactRenderer<MenuHandle> | null = null;
          let container: HTMLDivElement | null = null;
          const place = (props: SuggestionProps<SlashItem, SlashItem>) => {
            const rect = props.clientRect?.();
            if (!rect || !container) return;
            const below = window.innerHeight - rect.bottom > 340;
            container.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
            container.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 330)}px`;
          };
          return {
            onStart: (props) => {
              container = document.createElement('div');
              container.style.position = 'fixed';
              container.style.zIndex = '70';
              document.body.appendChild(container);
              renderer = new ReactRenderer(SlashMenu, { props: { items: props.items, command: props.command }, editor: props.editor });
              container.appendChild(renderer.element);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: props.command });
              place(props);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                container?.remove();
                container = null;
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              container?.remove();
              renderer = null;
              container = null;
            },
          };
        },
      }),
    ];
  },
});
