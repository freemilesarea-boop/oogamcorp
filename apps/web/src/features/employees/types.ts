export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED';
export type AccountStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

export interface RoleLite { id: string; key: string; name: string; rank: number; isSystem?: boolean }

export interface Employee {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  accountStatus: AccountStatus;
  lastLoginAt: string | null;
  title: string | null;
  department: { id: string; name: string } | null;
  role: RoleLite;
  employmentStatus: EmploymentStatus;
  hireDate: string | null;
  employeeNumber?: string | null;
  phone?: string | null;
}

export interface EmployeeDetail extends Employee {
  projects: { id: string; key: string; name: string; status: string; endDate: string | null; memberRole: string }[];
  openTaskCount: number;
  openTasks: { id: string; title: string; status: string; priority: string; dueDate: string | null; project: { id: string; key: string; name: string } | null }[];
  recentActivity: { id: string; action: string; entityType: string; entityId: string; label: string | null; createdAt: string }[];
}

export interface Invitation {
  id: string;
  email: string;
  name: string | null;
  title: string | null;
  role: { id: string; key: string; name: string };
  department: { id: string; name: string } | null;
  invitedBy: { id: string; name: string } | null;
  expiresAt: string;
  createdAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}

export interface InviteResult { id: string; email: string; expiresAt: string; inviteUrl: string; emailQueued: boolean }

export interface HrRecord {
  annualSalary: string | null;
  salaryNote: string | null;
  bankAccount: string | null;
  emergencyInfo: string | null;
  updatedAt: string | null;
}

export const EMPLOYMENT_LABELS: Record<EmploymentStatus, string> = { ACTIVE: '재직', ON_LEAVE: '휴직', RESIGNED: '퇴사' };
export const ACCOUNT_LABELS: Record<AccountStatus, string> = { INVITED: '초대됨', ACTIVE: '활성', DISABLED: '비활성' };
