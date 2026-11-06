import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks, safeHref } from './markdown';

// vitest 는 고전 JSX 런타임으로 변환하므로 전역 React 제공
(globalThis as { React?: typeof React }).React = React;

describe('safe markdown renderer', () => {
  it('parses headings, lists, quotes and paragraphs', () => {
    const blocks = parseBlocks('# Title\n\npara line 1\nline 2\n\n- a\n- b\n\n1. x\n2. y\n\n> quote');
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'ul', 'ol', 'quote']);
  });

  it('only allows http(s), mailto and internal links', () => {
    expect(safeHref('https://oogam.co.kr')).toBe('https://oogam.co.kr');
    expect(safeHref('/contact')).toBe('/contact');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//evil.example')).toBeNull();
    expect(safeHref('data:text/html,x')).toBeNull();
  });

  it('escapes raw HTML and never renders script/javascript links', () => {
    const html = renderToStaticMarkup(
      React.createElement(Markdown, { source: '<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) **bold** [ok](https://a.example)' }),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<strong');
    expect(html).toContain('href="https://a.example"');
  });
});
