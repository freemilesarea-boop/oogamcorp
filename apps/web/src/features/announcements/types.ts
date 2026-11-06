export type AnnouncementScope = 'COMPANY' | 'DEPARTMENT' | 'PROJECT';

export interface Announcement {
  id: string;
  scope: AnnouncementScope;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
  updatedAt: string;
  authorId: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  department: { id: string; name: string } | null;
  project: { id: string; key: string; name: string } | null;
  read: boolean;
  readAt: string | null;
  canEdit: boolean;
  readCount?: number;
}

export const SCOPE_LABELS: Record<AnnouncementScope, string> = { COMPANY: '전사', DEPARTMENT: '부서', PROJECT: '프로젝트' };
