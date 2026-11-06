import { mergeAttributes, Node } from '@tiptap/react';

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    callout: {
      /** 콜아웃 블록 삽입 */
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

export const CALLOUT_EMOJIS = ['💡', 'ℹ️', '⚠️', '❗', '✅', '📌', '🔥', '📝'];

/** 콜아웃: 이모지 + 강조 배경 블록. 편집 가능 시 이모지를 클릭하면 순환 변경 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') || '💡',
        renderHTML: (attrs) => ({ 'data-emoji': attrs.emoji }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { emoji: attrs?.emoji ?? '💡' }, content: [{ type: 'paragraph' }] }),
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'callout');
      const emoji = document.createElement('button');
      emoji.type = 'button';
      emoji.contentEditable = 'false';
      emoji.className = 'callout-emoji';
      emoji.textContent = node.attrs.emoji;
      emoji.setAttribute('aria-label', '콜아웃 아이콘 변경');
      emoji.addEventListener('mousedown', (e) => e.preventDefault());
      emoji.addEventListener('click', () => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const i = CALLOUT_EMOJIS.indexOf(current.attrs.emoji);
        const next = CALLOUT_EMOJIS[(i + 1) % CALLOUT_EMOJIS.length];
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, emoji: next }));
      });
      const contentDOM = document.createElement('div');
      contentDOM.className = 'callout-body';
      dom.append(emoji, contentDOM);
      return {
        dom,
        contentDOM,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          emoji.textContent = updated.attrs.emoji;
          return true;
        },
      };
    };
  },
});
