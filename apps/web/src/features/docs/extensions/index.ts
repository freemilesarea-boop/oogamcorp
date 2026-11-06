import type { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Callout } from './callout';
import { FileAttachment } from './file-attachment';
import { SlashCommand, type SlashItem } from './slash-command';
import { Toggle, ToggleContent, ToggleSummary } from './toggle';

export const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;

export interface BuildOptions {
  /** 실시간 협업 (Yjs). 지정 시 히스토리는 Collaboration 확장이 담당 */
  collab?: { provider: HocuspocusProvider; user: { name: string; color: string } };
  /** 슬래시 메뉴 항목 (편집 모드에서만) */
  getSlashItems?: () => SlashItem[];
  placeholder?: string;
}

/** 에디터/미리보기에서 공통으로 사용하는 Tiptap 확장 구성 (서버 저장 JSON 스키마와 동일해야 함) */
export function buildExtensions(opts: BuildOptions = {}): Extensions {
  const exts: Extensions = [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, ...(opts.collab ? { history: false } : {}) }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `제목 ${node.attrs.level}`;
        if (node.type.name === 'toggleSummary') return '토글 제목';
        return opts.placeholder ?? "'/' 를 입력해 블록을 추가하세요";
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false, HTMLAttributes: { class: 'doc-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      isAllowedUri: (url) => SAFE_URL.test(url.trim()),
    }),
    Toggle,
    ToggleSummary,
    ToggleContent,
    Callout,
    FileAttachment,
  ];
  if (opts.getSlashItems) exts.push(SlashCommand.configure({ getItems: opts.getSlashItems }));
  if (opts.collab) {
    exts.push(Collaboration.configure({ document: opts.collab.provider.document, field: 'default' }));
    exts.push(CollaborationCursor.configure({ provider: opts.collab.provider, user: opts.collab.user }));
  }
  return exts;
}

/** 사용자별 커서 색상 (단색 계열, 대비 확보) */
export function userColor(id: string): string {
  const palette = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#4f46e5'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
