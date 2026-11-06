'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 전역 내비게이션.
 * - 홈(히어로 위)에서는 투명 + 흰 글자, 스크롤하면 불투명 배경으로 전환
 * - 모바일: 전체 화면 메뉴 (ESC 닫기, 포커스 이동, 배경 스크롤 잠금)
 */
export function SiteHeader({ nav }: { nav: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const overHero = pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    menuRef.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const transparent = overHero && !scrolled && !open;
  const dark = transparent || open; // 흰 글자 모드

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,color] duration-300',
        transparent ? 'border-b border-transparent bg-transparent text-white' : open ? 'bg-ink text-white' : 'border-b border-gray-150 bg-paper/90 text-ink backdrop-blur-md',
      )}
    >
      <div className="container-site flex h-16 items-center justify-between md:h-20">
        <Link href="/" className="text-lg font-bold tracking-[-0.04em] md:text-xl" aria-label="OOGAM 홈">
          OOGAM
        </Link>
        <nav aria-label="주요 메뉴" className="hidden lg:block">
          <ul className="flex items-center gap-9">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative text-[13px] font-medium tracking-wide transition-opacity hover:opacity-100',
                      active ? 'opacity-100' : 'opacity-70',
                      'after:absolute after:-bottom-1.5 after:left-0 after:h-px after:bg-current after:transition-[width] after:duration-300',
                      active ? 'after:w-full' : 'after:w-0 hover:after:w-full',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <button
          ref={toggleRef}
          type="button"
          className="relative -mr-2 flex size-11 items-center justify-center lg:hidden"
          aria-expanded={open}
          aria-controls="site-mobile-menu"
          aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={cn('absolute h-px w-6 bg-current transition-transform duration-300', open ? 'rotate-45' : '-translate-y-1')} />
          <span className={cn('absolute h-px w-6 bg-current transition-transform duration-300', open ? '-rotate-45' : 'translate-y-1')} />
        </button>
      </div>

      <div
        id="site-mobile-menu"
        ref={menuRef}
        hidden={!open}
        className={cn('fixed inset-x-0 bottom-0 top-16 overflow-y-auto bg-ink text-white lg:hidden', dark && 'text-white')}
      >
        <nav aria-label="모바일 메뉴" className="container-site flex min-h-full flex-col justify-between py-10">
          <ul className="space-y-1">
            {nav.map((item, i) => (
              <li key={item.href} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                <Link
                  href={item.href}
                  className="block py-2 text-4xl font-semibold tracking-[-0.03em] text-white/90 transition-colors hover:text-white sm:text-5xl"
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-12 text-xs uppercase tracking-[0.2em] text-white/40">Ideas Become Impact.</p>
        </nav>
      </div>
    </header>
  );
}
