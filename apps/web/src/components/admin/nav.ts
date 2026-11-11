import type { PermissionKey } from '@oogam/shared';
import {
  Bell, Building2, Calendar, CheckSquare, Database, FileText, Folder, FolderKanban, Globe, LayoutDashboard, Megaphone, Settings, Stamp, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 메뉴 표시 조건 (UX). 실제 접근 제어는 API 가 강제 */
  perm?: PermissionKey;
  shortcut?: string;
  children?: { href: string; label: string; perm?: PermissionKey }[];
}

export const NAV: NavItem[] = [
  { href: '/admin', label: '대시보드', icon: LayoutDashboard, shortcut: 'G D' },
  { href: '/admin/my-tasks', label: '내 업무', icon: CheckSquare, perm: 'projects.read', shortcut: 'G T' },
  { href: '/admin/projects', label: '프로젝트', icon: FolderKanban, perm: 'projects.read', shortcut: 'G P' },
  { href: '/admin/docs', label: '문서', icon: FileText, perm: 'docs.read', shortcut: 'G O' },
  { href: '/admin/databases', label: '데이터베이스', icon: Database, perm: 'databases.read' },
  { href: '/admin/calendar', label: '캘린더', icon: Calendar, perm: 'calendar.read', shortcut: 'G C' },
  { href: '/admin/approvals', label: '전자결재', icon: Stamp, perm: 'approvals.request' },
  {
    href: '/admin/finance', label: '재무', icon: Wallet, perm: 'finance.read',
    children: [
      { href: '/admin/finance', label: '재무 대시보드' },
      { href: '/admin/finance/budgets', label: '예산' },
      { href: '/admin/finance/transactions', label: '매출·지출' },
    ],
  },
  { href: '/admin/employees', label: '직원', icon: Users, perm: 'employees.read' },
  { href: '/admin/teams', label: '부서', icon: Building2, perm: 'employees.read' },
  { href: '/admin/announcements', label: '공지', icon: Megaphone, perm: 'announcements.read' },
  { href: '/admin/files', label: '파일', icon: Folder, perm: 'files.read' },
  {
    href: '/admin/cms', label: '홈페이지 CMS', icon: Globe, perm: 'cms.read',
    children: [
      { href: '/admin/cms', label: 'CMS 개요' },
      { href: '/admin/cms/pages', label: '페이지·사이트 설정' },
      { href: '/admin/cms/business-areas', label: '사업 영역' },
      { href: '/admin/cms/brands', label: '브랜드·포트폴리오' },
      { href: '/admin/cms/posts', label: '뉴스·채용' },
      { href: '/admin/cms/inquiries', label: '문의 접수', perm: 'cms.inquiries' },
    ],
  },
  {
    href: '/admin/settings', label: '설정', icon: Settings,
    children: [
      { href: '/admin/settings', label: '내 계정' },
      { href: '/admin/settings/permissions', label: '역할·권한', perm: 'permissions.manage' },
      { href: '/admin/settings/audit-logs', label: '감사 로그', perm: 'audit.read' },
    ],
  },
];

/**
 * 홈페이지 CMS 배포(Vercel)에서 보이는 메뉴. 사내 업무 시스템 메뉴는 표시하지 않으며,
 * 해당 화면·API 는 미들웨어에서 404 로 차단된다(메뉴 숨김에만 의존하지 않음).
 */
const CMS_SITE_NAV_HREFS = new Set(['/admin/cms', '/admin/settings']);
export function visibleNav(cmsSite: boolean): NavItem[] {
  if (!cmsSite) return NAV;
  return NAV.filter((n) => CMS_SITE_NAV_HREFS.has(n.href)).map((n) =>
    n.href === '/admin/settings' ? { ...n, children: [{ href: '/admin/settings', label: '내 계정' }] } : n,
  );
}

export const NotificationsIcon = Bell;

const LABELS: Record<string, string> = {
  admin: '워크스페이스', 'my-tasks': '내 업무', projects: '프로젝트', docs: '문서', databases: '데이터베이스', calendar: '캘린더',
  approvals: '전자결재', finance: '재무', budgets: '예산', transactions: '매출·지출', employees: '직원', teams: '부서',
  announcements: '공지', files: '파일', cms: '홈페이지 CMS', brands: '브랜드', pages: '페이지', posts: '뉴스·채용',
  inquiries: '문의 접수', 'business-areas': '사업 영역', settings: '설정', permissions: '역할·권한', 'audit-logs': '감사 로그', notifications: '알림', search: '검색',
};

export function breadcrumbFor(pathname: string): { href: string; label: string }[] {
  const parts = pathname.split('/').filter(Boolean);
  const out: { href: string; label: string }[] = [];
  let acc = '';
  for (const p of parts) {
    acc += `/${p}`;
    out.push({ href: acc, label: LABELS[p] ?? (p.length > 12 ? '상세' : p) });
  }
  return out;
}
