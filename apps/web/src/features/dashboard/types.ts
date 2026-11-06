export interface DashboardData {
  tasks: {
    open: number; overdue: number; today: number; week: number;
    upcoming: { id: string; title: string; status: string; priority: string; dueDate: string | null; project: { id: string; key: string; name: string } | null }[];
  };
  projects: { id: string; key: string; name: string; status: string; progress: number; endDate: string | null; updatedAt: string; _count: { tasks: number } }[];
  approvals: {
    count: number;
    items: { stepId: string; order: number; id: string; number: string; title: string; type: string; submittedAt: string | null; requester: { id: string; name: string } | null }[];
  };
  documents: { id: string; title: string; icon: string | null; updatedAt: string }[];
  announcements: { id: string; title: string; scope: string; pinned: boolean; read: boolean; publishedAt: string; author: { name: string } | null }[];
  unreadNotifications: number;
  finance: null | {
    month: string; currency: string; revenue: string; expense: string; net: string;
    previous: { revenue: string; expense: string; net: string };
  };
}
