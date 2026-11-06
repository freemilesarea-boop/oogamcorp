import { mergeAttributes, Node } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    toggle: {
      /** 토글 블록 삽입 (제목 + 접히는 본문) */
      setToggle: () => ReturnType;
    };
  }
}

/** 토글 제목 (인라인 내용) */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }, { tag: 'summary' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-summary' }), 0];
  },
  addKeyboardShortcuts() {
    return {
      // 제목에서 Enter → 토글을 펼치고 본문 첫 줄로 이동
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        const togglePos = $from.before($from.depth - 1);
        const toggle = state.doc.nodeAt(togglePos);
        if (!toggle) return false;
        const target = $from.after() + 2; // toggleContent 진입 + 첫 블록 진입
        const tr = state.tr;
        if (!toggle.attrs.open) tr.setNodeMarkup(togglePos, undefined, { ...toggle.attrs, open: true });
        if (target <= tr.doc.content.size) tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

/** 토글 본문 (블록 내용) */
export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',
  defining: true,
  selectable: false,
  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content' }), 0];
  },
});

/**
 * 토글 블록 (details/summary). open 속성으로 펼침 상태를 저장한다.
 * 읽기 전용 모드에서는 문서를 바꾸지 않고 화면에서만 펼치고 접는다.
 */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false' && (el.tagName !== 'DETAILS' || el.hasAttribute('open')),
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }, { tag: 'details' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },
  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [{ type: 'toggleSummary' }, { type: 'toggleContent', content: [{ type: 'paragraph' }] }],
          }),
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'toggle');
      dom.setAttribute('data-open', node.attrs.open ? 'true' : 'false');
      const button = document.createElement('button');
      button.type = 'button';
      button.contentEditable = 'false';
      button.className = 'toggle-button';
      const syncLabel = () => {
        const open = dom.getAttribute('data-open') === 'true';
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? '토글 접기' : '토글 펼치기');
      };
      syncLabel();
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => {
        const open = dom.getAttribute('data-open') !== 'true';
        if (editor.isEditable && typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open }));
            return;
          }
        }
        dom.setAttribute('data-open', open ? 'true' : 'false');
        syncLabel();
      });
      const contentDOM = document.createElement('div');
      contentDOM.className = 'toggle-body';
      dom.append(button, contentDOM);
      return {
        dom,
        contentDOM,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          dom.setAttribute('data-open', updated.attrs.open ? 'true' : 'false');
          syncLabel();
          return true;
        },
        ignoreMutation: (m) => m.type === 'attributes' && m.target === dom,
      };
    };
  },
});
