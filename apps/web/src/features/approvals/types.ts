import type { ApprovalStatus, ApprovalType } from '@oogam/shared';

export interface UserLite { id: string; name: string; email: string; avatarUrl: string | null }
export type StepStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | 'SKIPPED';
export type ActionType = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'RESUBMIT' | 'CANCEL' | 'COMMENT';
export type Box = 'todo' | 'mine' | 'done' | 'all';

export interface ApprovalListItem {
  id: string;
  number: string;
  type: ApprovalType;
  title: string;
  status: ApprovalStatus;
  amount: string | null;
  requester: UserLite | null;
  currentApprover: UserLite | null;
  stepCount: number;
  steps: { order: number; status: StepStatus; approver: UserLite }[];
  isMyTurn: boolean;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDetail {
  id: string;
  number: string;
  type: ApprovalType;
  title: string;
  content: string;
  status: ApprovalStatus;
  version: number;
  amount: string | null;
  requester: UserLite | null;
  currentStepOrder: number | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  projectId: string | null;
  budgetId: string | null;
  transactionId: string | null;
  project: { id: string; key: string; name: string } | null;
  budget: { id: string; name: string; fiscalYear: number; status: string; plannedAmount: string; approvedAmount: string } | null;
  transaction: { id: string; txDate: string; type: string; description: string; counterparty: string | null; totalAmount: string; status: string } | null;
  steps: { id: string; order: number; status: StepStatus; actedAt: string | null; approver: UserLite }[];
  actions: { id: string; action: ActionType; comment: string | null; stepId: string | null; createdAt: string; actor: UserLite | null }[];
  attachments: { id: string; originalName: string; mimeType: string; size: number; uploadedById: string; createdAt: string }[];
  can: { approve: boolean; edit: boolean; submit: boolean; cancel: boolean; delete: boolean };
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  WAITING: '대기', PENDING: '결재 중', APPROVED: '승인', REJECTED: '반려', CHANGES_REQUESTED: '보완 요청', SKIPPED: '생략',
};
export const ACTION_LABELS: Record<ActionType, string> = {
  SUBMIT: '상신', APPROVE: '승인', REJECT: '반려', REQUEST_CHANGES: '보완 요청', RESUBMIT: '재상신', CANCEL: '취소', COMMENT: '의견',
};
