import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 최소 안전 마크다운 렌더러.
 * - HTML 을 절대 해석하지 않는다 (dangerouslySetInnerHTML 미사용, 모든 텍스트는 React 가 이스케이프)
 * - 지원: 제목(#, ##, ###), 문단, 줄바꿈, 순서/비순서 목록, 인용(>), 굵게(**), 링크([텍스트](url))
 * - 링크는 http(s)://, mailto:, 내부 경로(/...)만 허용. 그 외(javascript: 등)는 텍스트로 표시
 */

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; lines: string[] };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  // 객체 속성으로 보관 (클로저 내 변경에 대한 타입 좁히기 문제 회피)
  const st: { cur: Block | null } = { cur: null };
  const flush = () => {
    if (st.cur) blocks.push(st.cur);
    st.cur = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'h', level: h[1].length as 1 | 2 | 3, text: h[2] });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    const cur = st.cur;
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      const text = (ul ?? ol)![1];
      if (cur && cur.kind === kind) cur.items.push(text);
      else {
        flush();
        st.cur = { kind, items: [text] };
      }
      continue;
    }
    if (q) {
      if (cur && cur.kind === 'quote') cur.lines.push(q[1]);
      else {
        flush();
        st.cur = { kind: 'quote', lines: [q[1]] };
      }
      continue;
    }
    if (cur && cur.kind === 'p') cur.lines.push(line.trim());
    else {
      flush();
      st.cur = { kind: 'p', lines: [line.trim()] };
    }
  }
  flush();
  return blocks;
}

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

export function safeHref(href: string): string | null {
  const h = href.trim();
  return SAFE_HREF.test(h) ? h : null;
}

function renderBold(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyPrefix}-b${i++}`} className="font-semibold">{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...renderBold(text.slice(last, m.index), `${keyPrefix}-t${i}`));
    const href = safeHref(m[2]);
    if (href) {
      const external = /^https?:/i.test(href);
      out.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={href}
          className="underline decoration-1 underline-offset-4 transition-colors hover:text-gray-500"
          {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
        >
          {renderBold(m[1], `${keyPrefix}-al${i}`)}
        </a>,
      );
    } else {
      // 허용되지 않은 스킴: 원문 그대로 텍스트로 표시
      out.push(m[0]);
    }
    i += 1;
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...renderBold(text.slice(last), `${keyPrefix}-end`));
  return out;
}

export function Markdown({ source, className, size = 'base' }: { source: string | null | undefined; className?: string; size?: 'base' | 'lg' }) {
  if (!source?.trim()) return null;
  const blocks = parseBlocks(source);
  return (
    <div className={cn('space-y-5 leading-[1.8] text-gray-800', size === 'lg' ? 'text-lg md:text-xl' : 'text-base md:text-[17px]', className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'h': {
            const cls = b.level === 1 ? 'text-3xl md:text-4xl' : b.level === 2 ? 'text-2xl md:text-3xl' : 'text-xl md:text-2xl';
            const Tag = (`h${b.level + 1}`) as 'h2' | 'h3' | 'h4';
            return <Tag key={k} className={cn('pt-6 font-semibold tracking-tight text-ink', cls)}>{renderInline(b.text, k)}</Tag>;
          }
          case 'ul':
            return <ul key={k} className="list-disc space-y-2 pl-6 marker:text-gray-400">{b.items.map((t, j) => <li key={j}>{renderInline(t, `${k}-${j}`)}</li>)}</ul>;
          case 'ol':
            return <ol key={k} className="list-decimal space-y-2 pl-6 marker:text-gray-400">{b.items.map((t, j) => <li key={j}>{renderInline(t, `${k}-${j}`)}</li>)}</ol>;
          case 'quote':
            return (
              <blockquote key={k} className="border-l-2 border-ink pl-5 text-gray-600">
                {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(l, `${k}-${j}`)}</Fragment>)}
              </blockquote>
            );
          default:
            return <p key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(l, `${k}-${j}`)}</Fragment>)}</p>;
        }
      })}
    </div>
  );
}
