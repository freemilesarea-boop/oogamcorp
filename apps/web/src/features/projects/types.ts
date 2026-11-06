import type { Priority, ProjectStatus, TaskStatus } from '@oogam/shared';

export interface UserLite { id: string; name: string; email?: string; avatarUrl?: string | null }

export interface ProjectListItem {
  id: string; key: string; name: string; description: string | null; status: ProjectStatus; priority: Priority; progress: number;
  startDate: string | null; endDate: string | null; updatedAt: string;
  department: { id: string; name: string } | null; manager: UserLite | null; _count: { tasks: number; members: number };
}

export interface CustomStatus { id: string; name: string; category: TaskStatus; color: string | null; position: number }
export interface Milestone { id: string; name: string; description: string | null; dueDate: string | null; status: 'OPEN' | 'DONE' }

export interface ProjectDetail extends Omit<ProjectListItem, '_count'> {
  access: 'view' | 'edit' | 'manage';
  members: { id: string; role: 'MANAGER' | 'MEMBER' | 'VIEWER'; user: UserLite }[];
  milestones: Milestone[];
  statuses: CustomStatus[];
  taskCounts: Partial<Record<TaskStatus, number>>;
  documents: { id: string; title: string; icon: string | null }[];
  budget: { id: string; name: string; approvedAmount: string; fiscalYear: number } | null;
  budgetId: string | null;
}

export interface ChecklistItem { id: string; text: string; done: boolean }

export interface Task {
  id: string; title: string; description: string | null; status: TaskStatus; priority: Priority;
  projectId: string | null; parentId: string | null; milestoneId: string | null;
  startDate: string | null; dueDate: string | null; position: number; completedAt: string | null;
  checklist: ChecklistItem[]; assignees: UserLite[]; subtaskCount: number;
  customStatus: { id: string; name: string; color: string | null; category: TaskStatus } | null;
  project: { id: string; key: string; name: string } | null;
  createdAt: string; updatedAt: string;
}

export interface TaskDetail extends Task {
  milestone: { id: string; name: string } | null;
  parent: { id: string; title: string } | null;
  subtasks: Task[];
  dependencies: { id: string; task: { id: string; title: string; status: TaskStatus } }[];
  documents: { id: string; title: string; icon: string | null; linkId?: string }[];
  history: { id: string; action: string; actorId: string | null; changes: Record<string, { from: unknown; to: unknown }> | null; createdAt: string }[];
}
