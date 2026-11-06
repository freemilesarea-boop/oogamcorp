import type { SystemRole } from './roles';

/**
 * 권한 키 정의. 서버(API)에서 모든 접근 제어의 기준이 된다.
 * sensitive=true 인 권한은 재무·인사 등 민감 정보로, 명시적으로 부여된 사용자만 접근한다.
 */
export const PERMISSIONS = {
  'workspace.access': { module: 'workspace', label: '워크스페이스 접근', sensitive: false },
  'docs.read': { module: 'docs', label: '문서 열람', sensitive: false },
  'docs.write': { module: 'docs', label: '문서 작성/편집', sensitive: false },
  'docs.manage': { module: 'docs', label: '모든 문서 관리(권한 우회)', sensitive: false },
  'databases.read': { module: 'databases', label: '데이터베이스 열람', sensitive: false },
  'databases.write': { module: 'databases', label: '데이터베이스 편집', sensitive: false },
  'projects.read': { module: 'projects', label: '프로젝트 열람', sensitive: false },
  'projects.write': { module: 'projects', label: '프로젝트 생성/편집', sensitive: false },
  'projects.manage': { module: 'projects', label: '모든 프로젝트 관리', sensitive: false },
  'tasks.write': { module: 'projects', label: '업무 생성/편집', sensitive: false },
  'calendar.read': { module: 'calendar', label: '캘린더 열람', sensitive: false },
  'calendar.write': { module: 'calendar', label: '일정 생성/편집', sensitive: false },
  'approvals.request': { module: 'approvals', label: '결재 요청', sensitive: false },
  'approvals.read_all': { module: 'approvals', label: '전체 결재 문서 열람', sensitive: true },
  'finance.read': { module: 'finance', label: '재무 정보 열람', sensitive: true },
  'finance.write': { module: 'finance', label: '재무 거래/예산 등록', sensitive: true },
  'finance.approve': { module: 'finance', label: '예산/지출 승인', sensitive: true },
  'employees.read': { module: 'employees', label: '직원 목록 열람', sensitive: false },
  'employees.manage': { module: 'employees', label: '직원 계정 관리/초대', sensitive: false },
  'hr.sensitive.read': { module: 'employees', label: '민감 인사정보(급여 등) 열람', sensitive: true },
  'hr.sensitive.write': { module: 'employees', label: '민감 인사정보(급여 등) 수정', sensitive: true },
  'teams.manage': { module: 'teams', label: '부서 관리', sensitive: false },
  'announcements.read': { module: 'announcements', label: '공지 열람', sensitive: false },
  'announcements.write': { module: 'announcements', label: '공지 작성', sensitive: false },
  'files.read': { module: 'files', label: '파일 열람', sensitive: false },
  'files.write': { module: 'files', label: '파일 업로드', sensitive: false },
  'cms.read': { module: 'cms', label: 'CMS 열람', sensitive: false },
  'cms.write': { module: 'cms', label: 'CMS 편집', sensitive: false },
  'cms.publish': { module: 'cms', label: 'CMS 게시 승인', sensitive: false },
  'cms.inquiries': { module: 'cms', label: '문의 접수 관리(개인정보)', sensitive: true },
  'audit.read': { module: 'settings', label: '감사 로그 열람', sensitive: true },
  'settings.manage': { module: 'settings', label: '시스템 설정 변경', sensitive: true },
  'permissions.manage': { module: 'settings', label: '역할·권한 정책 관리', sensitive: true },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

const COLLAB: PermissionKey[] = [
  'workspace.access', 'docs.read', 'docs.write', 'databases.read', 'databases.write',
  'projects.read', 'tasks.write', 'calendar.read', 'calendar.write', 'approvals.request',
  'employees.read', 'announcements.read', 'files.read', 'files.write',
];

/** 시스템 역할 기본 권한 (시드 시 role_permissions 로 저장되며 이후 관리자 화면에서 변경 가능) */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, PermissionKey[]> = {
  OWNER: [...PERMISSION_KEYS],
  EXECUTIVE: [
    ...COLLAB, 'docs.manage', 'projects.write', 'projects.manage', 'approvals.read_all',
    'finance.read', 'finance.write', 'finance.approve', 'employees.manage', 'teams.manage',
    'announcements.write', 'cms.read', 'cms.write', 'cms.publish', 'cms.inquiries', 'audit.read',
  ],
  MANAGER: [...COLLAB, 'projects.write', 'announcements.write', 'cms.read', 'cms.write'],
  EMPLOYEE: [...COLLAB],
  GUEST: ['workspace.access', 'docs.read', 'projects.read', 'announcements.read', 'files.read'],
};
