/**
 * 시스템 역할. OWNER와 EXECUTIVE는 서로 다른 권한 집합을 가진다.
 * - OWNER: 최고관리자. 시스템 설정·권한 정책·민감 인사(급여) 정보 포함 전체 권한
 * - EXECUTIVE: 경영진. 재무 조회/승인, 결재, 인사 일반 조회. 권한 정책/시스템 설정 변경 불가, 급여 정보 기본 비공개
 * - MANAGER: 부서/프로젝트 관리자. 프로젝트·업무·CMS 편집. 재무 정보 기본 비공개
 * - EMPLOYEE: 일반 직원. 협업 기능 사용
 * - GUEST: 제한된 열람(명시적 리소스 공유 문서/프로젝트만)
 */
export const SYSTEM_ROLES = ['OWNER', 'EXECUTIVE', 'MANAGER', 'EMPLOYEE', 'GUEST'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const ROLE_LABELS: Record<SystemRole, string> = {
  OWNER: '최고관리자',
  EXECUTIVE: '경영진',
  MANAGER: '매니저',
  EMPLOYEE: '직원',
  GUEST: '게스트',
};

/** 역할 서열 (초대/권한 변경 시 자신보다 높은 역할을 부여하지 못하도록 사용) */
export const ROLE_RANK: Record<SystemRole, number> = {
  OWNER: 100,
  EXECUTIVE: 80,
  MANAGER: 60,
  EMPLOYEE: 40,
  GUEST: 10,
};
