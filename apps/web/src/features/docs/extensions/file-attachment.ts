import { mergeAttributes, Node } from '@tiptap/react';

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    fileAttachment: {
      /** 첨부 파일 카드 삽입 */
      setFileAttachment: (attrs: { href: string; name: string; size?: number; mime?: string }) => ReturnType;
    };
  }
}

function formatSize(n: unknown): string {
  const v = Number(n);
  if (!v) return '';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/** 첨부 파일 카드 (파일 API 다운로드 링크). 원자 노드 */
export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: '파일' },
      size: { default: null },
      mime: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'a[data-type="file-attachment"]',
        getAttrs: (el) => ({
          href: (el as HTMLElement).getAttribute('href'),
          name: (el as HTMLElement).getAttribute('data-name'),
          size: Number((el as HTMLElement).getAttribute('data-size')) || null,
          mime: (el as HTMLElement).getAttribute('data-mime'),
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const href = typeof node.attrs.href === 'string' && /^(https?:|\/)/i.test(node.attrs.href) ? node.attrs.href : null;
    return [
      'a',
      mergeAttributes(
        { 'data-type': 'file-attachment', 'data-name': node.attrs.name, 'data-size': node.attrs.size ?? '', 'data-mime': node.attrs.mime ?? '', target: '_blank', rel: 'noopener noreferrer' },
        href ? { href } : {},
        { class: HTMLAttributes.class },
      ),
      ['span', { class: 'file-attachment-icon', 'aria-hidden': 'true' }, '📎'],
      ['span', { class: 'file-attachment-name' }, String(node.attrs.name ?? '파일')],
      ['span', { class: 'file-attachment-size' }, formatSize(node.attrs.size)],
    ];
  },
  addCommands() {
    return {
      setFileAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
