'use client';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, Database, FileText, FolderKanban, Megaphone, Rows3, Search, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

type SearchType = 'pages' | 'projects' | 'tasks' | 'databases' | 'rows' | 'employees' | 'announcements';
interface Hit { type: SearchType; id: string; title: string; snippet: string | null; href: string; meta?: string | null }
interface SearchResponse { q: string; total: number; groups: { type: SearchType; label: string; items: Hit[] }[] }

const TYPES: { key: SearchType; label: string; icon: typeof FileText }[] = [
  { key: 'pages', label: '문서', icon: FileText },
  { key: 'projects', label: '프로젝트', icon: FolderKanban },
  { key: 'tasks', label: '업무', icon: CheckSquare },
  { key: 'databases', label: '데이터베이스', icon: Database },
  { key: 'rows', label: '데이터베이스 항목', icon: Rows3 },
  { key: 'employees', label: '직원', icon: User },
  { key: 'announcements', label: '공지', icon: Megaphone },
];
const ICON = Object.fromEntries(TYPES.map((t) => [t.key, t.icon])) as Record<SearchType, typeof FileText>;

/** 검색어 강조 (React 텍스트 노드로만 렌더링 — HTML 주입 없음) */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let idx = lower.indexOf(needle);
  while (idx >= 0 && parts.length < 20) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={idx} className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700/60">{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
    idx = lower.indexOf(needle, i);
  }
  parts.push(text.slice(i));
  return <>{parts}</>;
}

export function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const typesParam = params.get('types') ?? '';
  const selected = typesParam ? (typesParam.split(',') as SearchType[]) : [];
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const result = useQuery({
    queryKey: ['search', q, typesParam],
    enabled: q.length >= 2,
    queryFn: () => apiGet<SearchResponse>('/search', { q, types: typesParam || undefined, limit: selected.length === 1 ? 30 : 8 }),
  });

  const push = (nextQ: string, nextTypes: SearchType[]) => {
    const sp = new URLSearchParams();
    if (nextQ) sp.set('q', nextQ);
    if (nextTypes.length) sp.set('types', nextTypes.join(','));
    router.push(`${pathname}?${sp}`);
  };
  const toggleType = (t: SearchType) => push(q, selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);

  return (
    <>
      <PageHeader title="검색" description="문서·프로젝트·업무·데이터베이스·직원·공지를 권한 범위 안에서 검색합니다." />
      <form role="search" className="mb-4 flex max-w-2xl gap-2" onSubmit={(e) => { e.preventDefault(); push(input.trim(), selected); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="검색어 (2자 이상)" aria-label="검색어" className="pl-9" autoFocus maxLength={100} />
        </div>
        <Button type="submit">검색</Button>
      </form>
      <div className="mb-6 flex flex-wrap gap-1.5" role="group" aria-label="유형 필터">
        {TYPES.map((t) => {
          const on = selected.includes(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on} onClick={() => toggleType(t.key)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors', on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground')}>
              <t.icon className="size-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {q.length < 2 ? (
        <EmptyState icon={Search} title="검색어를 2자 이상 입력하세요" description="⌘K 로 어디서든 검색창으로 이동할 수 있습니다." />
      ) : result.isLoading ? (
        <LoadingRows rows={6} />
      ) : result.error ? (
        <ErrorState error={result.error} />
      ) : !result.data || result.data.total === 0 ? (
        <EmptyState icon={Search} title={`"${q}"에 대한 결과가 없습니다`} description="다른 검색어를 사용하거나 유형 필터를 해제해 보세요. 접근 권한이 없는 항목은 표시되지 않습니다." />
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground" aria-live="polite">결과 {result.data.total}건</p>
          {result.data.groups.map((g) => {
            const Icon = ICON[g.type];
            return (
              <section key={g.type} aria-labelledby={`sg-${g.type}`}>
                <h2 id={`sg-${g.type}`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Icon className="size-4" />{g.label}<span className="font-normal text-muted-foreground">{g.items.length}</span>
                  {selected.length !== 1 && g.items.length >= 8 && (
                    <button type="button" onClick={() => push(q, [g.type])} className="ml-auto text-xs font-normal text-muted-foreground underline-offset-2 hover:underline">더 보기</button>
                  )}
                </h2>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {g.items.map((h) => (
                    <li key={`${h.type}-${h.id}`}>
                      <Link href={h.href} className="block px-4 py-3 hover:bg-muted/40">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium"><Highlight text={h.title} q={q} /></span>
                          {h.meta && <span className="shrink-0 text-xs text-muted-foreground">{h.meta}</span>}
                        </span>
                        {h.snippet && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"><Highlight text={h.snippet} q={q} /></span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
