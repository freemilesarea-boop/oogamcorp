'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, ChevronsLeft, ChevronsRight, LogOut, Menu, Moon, Search, Settings, Sun, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { MeProvider, useMeQuery, type Me } from '@/lib/auth';
import { cn, timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, Spinner, Tooltip } from '@/components/ui/misc';
import { breadcrumbFor, NAV } from './nav';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: me, error, isLoading } = useMeQuery();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [error, pathname, router]);
  // MFA 정책: 검증 전 세션 → 검증 화면, 필수 역할 미등록 → 등록 화면 (API 도 동일하게 차단)
  const mfaGate = me && (!me.mfa.verified ? '/admin/mfa' : me.mfa.required && !me.mfa.enabled ? '/admin/mfa/setup' : null);
  useEffect(() => {
    if (mfaGate) router.replace(`${mfaGate}?next=${encodeURIComponent(pathname)}`);
  }, [mfaGate, pathname, router]);

  if (isLoading || !me || mfaGate) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {error && !(error instanceof ApiError && error.status === 401) ? <p className="text-sm">워크스페이스를 불러오지 못했습니다: {(error as Error).message}</p> : <Spinner />}
      </div>
    );
  }
  return (
    <MeProvider value={me}>
      <Layout me={me}>{children}</Layout>
    </MeProvider>
  );
}

function Layout({ me, children }: { me: Me; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem('oogam-sidebar') === 'collapsed');
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  // 모바일 드로어: Esc 로 닫기
  useEffect(() => {
    if (!mobileOpen) return;
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [mobileOpen]);

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('oogam-sidebar', c ? 'open' : 'collapsed');
      return !c;
    });
  };

  // 키보드 단축키: ⌘K / Ctrl+K / '/' 검색, 'g' + 키 이동, '[' 사이드바 토글
  const pending = useRef<string | null>(null);
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '[') toggle();
      else if (pending.current === 'g') {
        const map: Record<string, string> = { d: '/admin', t: '/admin/my-tasks', p: '/admin/projects', o: '/admin/docs', c: '/admin/calendar' };
        const dest = map[e.key.toLowerCase()];
        pending.current = null;
        if (dest) router.push(dest);
      } else if (e.key === 'g') {
        pending.current = 'g';
        setTimeout(() => (pending.current = null), 1000);
      }
    },
    [router],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">본문으로 건너뛰기</a>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-gray-50 transition-[width,transform] duration-200 dark:bg-[#0d0d0f]',
          collapsed ? 'lg:w-[60px]' : 'lg:w-[248px]',
          'w-[260px] lg:translate-x-0',
          // 닫힌 모바일 드로어는 화면 밖에 있어도 Tab 포커스를 받지 않도록 숨김
          mobileOpen ? 'translate-x-0' : '-translate-x-full max-lg:invisible',
        )}
        aria-label="워크스페이스 메뉴"
      >
        <div className="flex h-14 items-center justify-between px-3">
          <Link href="/admin" className="flex items-center gap-2 px-1.5 font-bold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-ink text-[11px] font-black text-white dark:bg-white dark:text-ink">OG</span>
            {(!collapsed || mobileOpen) && <span className="text-[15px]">OOGAM</span>}
          </Link>
          <button className="rounded p-1 text-muted-foreground hover:bg-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기"><X className="size-4" /></button>
        </div>
        <SidebarNav me={me} collapsed={collapsed && !mobileOpen} pathname={pathname} />
        <div className="hidden border-t border-border p-2 lg:block">
          <button onClick={toggle} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-muted" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> 접기 <kbd className="ml-auto text-[10px]">[</kbd></>}
          </button>
        </div>
      </aside>

      <div className={cn('flex min-w-0 flex-1 flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[60px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
          <button className="rounded p-1.5 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="메뉴 열기"><Menu className="size-5" /></button>
          <Breadcrumb pathname={pathname} />
          <form
            className="relative ml-auto hidden w-full max-w-xs md:block"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = searchRef.current?.value.trim();
              if (q) router.push(`/admin/search?q=${encodeURIComponent(q)}`);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input ref={searchRef} name="q" placeholder="검색 (⌘K)" aria-label="워크스페이스 검색" className="h-8 w-full rounded-md border border-border bg-muted/50 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/15" />
          </form>
          <Link href="/admin/search" className="ml-auto rounded p-1.5 hover:bg-muted md:hidden" aria-label="검색"><Search className="size-5" /></Link>
          <NotificationsBell />
          <ThemeToggle />
          <ProfileMenu me={me} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarNav({ me, collapsed, pathname }: { me: Me; collapsed: boolean; pathname: string }) {
  const perms = new Set(me.permissions);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-1">
      <ul className="space-y-0.5">
        {NAV.filter((n) => !n.perm || perms.has(n.perm)).map((item) => {
          const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          const Icon = item.icon;
          const children = item.children?.filter((c) => !c.perm || perms.has(c.perm));
          const expanded = open[item.href] ?? active;
          const link = (
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
                active ? 'bg-gray-200/70 font-medium text-foreground dark:bg-gray-800' : 'text-gray-600 hover:bg-gray-150 hover:text-foreground dark:text-gray-400 dark:hover:bg-gray-900',
                collapsed && 'justify-center px-0',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="size-[17px] shrink-0" strokeWidth={1.75} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
          return (
            <li key={item.href}>
              {collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : (
                <div className="flex items-center">
                  <div className="flex-1">{link}</div>
                  {children && children.length > 1 && (
                    <button onClick={() => setOpen((o) => ({ ...o, [item.href]: !expanded }))} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`${item.label} 하위 메뉴`} aria-expanded={expanded}>
                      <ChevronDown className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')} />
                    </button>
                  )}
                </div>
              )}
              {!collapsed && children && children.length > 1 && expanded && (
                <ul className="ml-[22px] mt-0.5 space-y-0.5 border-l border-border pl-2">
                  {children.map((c) => (
                    <li key={c.href}>
                      <Link href={c.href} className={cn('block rounded px-2 py-1 text-[13px]', pathname === c.href ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>{c.label}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const crumbs = breadcrumbFor(pathname);
  return (
    <nav aria-label="현재 위치" className="hidden min-w-0 sm:block">
      <ol className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1.5 truncate">
            {i > 0 && <span aria-hidden>/</span>}
            {i === crumbs.length - 1 ? <span className="truncate text-foreground">{c.label}</span> : <Link href={c.href} className="hover:text-foreground">{c.label}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label="다크/라이트 모드 전환">
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

interface NotificationItem { id: string; title: string; body?: string | null; link?: string | null; readAt?: string | null; createdAt: string }

function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => apiGet<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notifications', 'recent'], queryFn: () => apiGet<{ items: NotificationItem[] }>('/notifications', { pageSize: 8 }), enabled: false });
  const readAll = useMutation({ mutationFn: () => apiPost('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const n = count.data?.count ?? 0;
  return (
    <DropdownMenu onOpenChange={(o) => o && list.refetch()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`알림 ${n}건`}>
          <Bell />
          {n > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{n > 99 ? '99+' : n}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">알림</span>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => readAll.mutate()}>모두 읽음</button>
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {list.isFetching && !list.data && <div className="p-4 text-center"><Spinner /></div>}
          {list.data?.items.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">새 알림이 없습니다.</p>}
          {list.data?.items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex-col items-start gap-0.5"
              onSelect={async () => {
                await apiPost(`/notifications/${item.id}/read`).catch(() => undefined);
                qc.invalidateQueries({ queryKey: ['notifications'] });
                if (item.link) router.push(item.link);
              }}
            >
              <span className={cn('text-[13px]', !item.readAt && 'font-semibold')}>{item.title}</span>
              {item.body && <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>}
              <span className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
            </DropdownMenuItem>
          ))}
        </div>
        <div className="border-t border-border p-1">
          <DropdownMenuItem onSelect={() => router.push('/admin/notifications')} className="justify-center text-xs">전체 알림 보기</DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu({ me }: { me: Me }) {
  const router = useRouter();
  const qc = useQueryClient();
  const logout = async () => {
    await apiPost('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/admin/login');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label={`${me.user.name} 계정 메뉴`} data-testid="profile-menu">
        <span aria-hidden className="block"><Avatar name={me.user.name} src={me.user.avatarUrl} className="size-8" /></span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium text-foreground">{me.user.name}</p>
          <p className="truncate text-xs">{me.user.email}</p>
          <p className="mt-1 text-xs">{me.role.name}{me.department ? ` · ${me.department.name}` : ''}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/admin/settings')}><Settings /> 계정 설정</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.open('/', '_blank')}>공개 홈페이지 보기</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} data-testid="logout"><LogOut /> 로그아웃</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
