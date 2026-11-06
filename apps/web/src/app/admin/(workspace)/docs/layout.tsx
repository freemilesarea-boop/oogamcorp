'use client';
import { PanelLeft, X } from 'lucide-react';
import { useState } from 'react';
import { DocTree } from '@/features/docs/doc-tree';
import '@/features/docs/editor/editor.css';

/** 문서 영역 레이아웃: 좌측 문서 트리(데스크톱 고정, 모바일 서랍) + 본문 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-3.5rem)] md:-mx-8 md:-my-8">
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-border bg-gray-50/60 pt-3 dark:bg-gray-900/30 lg:block">
        <DocTree />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="문서 트리">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-background pt-3 shadow-xl">
            <div className="flex justify-end px-2 pb-1">
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 hover:bg-muted" aria-label="닫기"><X className="size-4" /></button>
            </div>
            <DocTree onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <button type="button" onClick={() => setOpen(true)} className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm lg:hidden">
          <PanelLeft className="size-4" /> 문서 목록
        </button>
        {children}
      </div>
    </div>
  );
}
