export const CONTENT_STATUSES = ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: '초안', REVIEW: '검토 중', PUBLISHED: '게시됨', ARCHIVED: '보관됨',
};

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: '할 일', IN_PROGRESS: '진행 중', REVIEW: '검토', DONE: '완료',
};

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: '낮음', MEDIUM: '보통', HIGH: '높음', URGENT: '긴급',
};

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: '기획', ACTIVE: '진행 중', ON_HOLD: '보류', COMPLETED: '완료', CANCELLED: '취소',
};

export const APPROVAL_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  DRAFT: '임시저장', PENDING: '결재 진행', APPROVED: '승인', REJECTED: '반려',
  CHANGES_REQUESTED: '보완 요청', CANCELLED: '취소',
};

export const APPROVAL_TYPES = ['GENERAL', 'EXPENSE', 'BUDGET', 'PURCHASE', 'CONTRACT', 'LEAVE'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  GENERAL: '일반 품의', EXPENSE: '지출 결의', BUDGET: '예산 승인', PURCHASE: '구매 요청',
  CONTRACT: '계약 검토', LEAVE: '휴가 신청',
};

export const DB_PROPERTY_TYPES = [
  'TITLE', 'TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'CHECKBOX', 'PERSON', 'URL', 'FILE', 'RELATION',
] as const;
export type DbPropertyType = (typeof DB_PROPERTY_TYPES)[number];
export const DB_PROPERTY_TYPE_LABELS: Record<DbPropertyType, string> = {
  TITLE: '제목', TEXT: '텍스트', NUMBER: '숫자', SELECT: '선택', MULTI_SELECT: '다중 선택',
  DATE: '날짜', CHECKBOX: '체크박스', PERSON: '사람', URL: 'URL', FILE: '파일', RELATION: '관계',
};

export const DB_VIEW_TYPES = ['TABLE', 'BOARD', 'CALENDAR', 'LIST', 'GALLERY', 'TIMELINE'] as const;
export type DbViewType = (typeof DB_VIEW_TYPES)[number];
