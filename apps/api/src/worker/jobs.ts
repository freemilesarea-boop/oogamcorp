import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/configuration';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}

const DAY = 86400_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function absoluteLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const base = process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return link.startsWith('http') ? link : `${base.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}`;
}

/** 'email' 작업: 알림 1건을 이메일로 발송 (SMTP 비활성 시 건너뜀) */
export async function sendNotificationEmail(
  deps: { prisma: PrismaClient; cfg: AppConfig; mailer: Mailer | null; log: Logger },
  notificationId: string,
): Promise<'sent' | 'skipped' | 'missing'> {
  const n = await deps.prisma.notification.findUnique({
    where: { id: notificationId },
    include: { user: { select: { email: true, name: true, status: true, deletedAt: true } } },
  });
  if (!n) return 'missing';
  if (n.emailedAt) return 'skipped';
  if (!deps.cfg.smtp.enabled || !deps.mailer) {
    deps.log.info({ notificationId }, 'SMTP 비활성 — 이메일 발송 건너뜀');
    return 'skipped';
  }
  if (n.user.status !== 'ACTIVE' || n.user.deletedAt) return 'skipped';
  const pref = await deps.prisma.systemSetting.findUnique({ where: { organizationId_key: { organizationId: n.organizationId, key: 'notifications.email' } } });
  const prefValue = (pref?.value ?? null) as { enabled?: boolean } | null;
  if (prefValue && prefValue.enabled === false) {
    deps.log.info({ notificationId }, '조직 설정에서 이메일 알림 비활성 — 건너뜀');
    return 'skipped';
  }
  const link = absoluteLink(n.link);
  const text = [n.title, n.body ?? '', link ? `\n바로가기: ${link}` : ''].filter(Boolean).join('\n');
  const html = `<p><strong>${escapeHtml(n.title)}</strong></p>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}${link ? `<p><a href="${escapeHtml(link)}">바로가기</a></p>` : ''}`;
  await deps.mailer.send({ to: n.user.email, subject: `[OOGAM] ${n.title}`, text, html });
  await deps.prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
  deps.log.info({ notificationId }, '알림 이메일 발송 완료');
  return 'sent';
}

/** 'invitation-email' 작업: 초대 링크 메일 발송 */
export async function sendInvitationEmail(
  deps: { prisma: PrismaClient; cfg: AppConfig; mailer: Mailer | null; log: Logger },
  invitationId: string,
  token: string,
): Promise<'sent' | 'skipped'> {
  const inv = await deps.prisma.invitation.findUnique({ where: { id: invitationId }, include: { organization: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return 'skipped';
  if (!deps.cfg.smtp.enabled || !deps.mailer) {
    deps.log.info({ invitationId }, 'SMTP 비활성 — 초대 메일 건너뜀');
    return 'skipped';
  }
  const link = absoluteLink(`/admin/accept-invite?token=${encodeURIComponent(token)}`)!;
  await deps.mailer.send({
    to: inv.email,
    subject: `[${inv.organization.name}] 워크스페이스 초대`,
    text: `${inv.name ?? ''}님, ${inv.organization.name} 워크스페이스에 초대되었습니다.\n아래 링크에서 7일 이내에 계정을 활성화하세요.\n${link}`,
    html: `<p>${escapeHtml(inv.name ?? '')}님, <strong>${escapeHtml(inv.organization.name)}</strong> 워크스페이스에 초대되었습니다.</p><p><a href="${escapeHtml(link)}">계정 활성화</a> (7일 이내)</p>`,
  });
  deps.log.info({ invitationId }, '초대 메일 발송 완료');
  return 'sent';
}

/**
 * 'due-reminders' 작업: 24시간 이내 마감(오늘·내일)이며 완료되지 않은 업무의 담당자에게 TASK_DUE 알림 생성.
 * 같은 업무·사용자에 대해 최근 24시간 내 알림이 있으면 중복 생성하지 않는다.
 */
export async function runDueReminders(prisma: PrismaClient, now = new Date()): Promise<{ created: string[] }> {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  const until = new Date(today.getTime() + 2 * DAY); // 오늘 + 내일 (DATE 컬럼)
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { not: 'DONE' },
      dueDate: { gte: today, lt: until },
      OR: [{ projectId: null }, { project: { deletedAt: null } }],
    },
    select: {
      id: true, organizationId: true, title: true, dueDate: true, projectId: true,
      assignees: { select: { userId: true, user: { select: { status: true } } } },
    },
    take: 5000,
  });
  const since = new Date(now.getTime() - DAY);
  const created: string[] = [];
  for (const t of tasks) {
    for (const a of t.assignees) {
      if (a.user.status !== 'ACTIVE') continue;
      const dup = await prisma.notification.count({
        where: { userId: a.userId, type: 'TASK_DUE', entityType: 'TASK', entityId: t.id, createdAt: { gte: since } },
      });
      if (dup) continue;
      const isToday = t.dueDate!.getTime() === today.getTime();
      const n = await prisma.notification.create({
        data: {
          organizationId: t.organizationId,
          userId: a.userId,
          type: 'TASK_DUE',
          title: `마감 ${isToday ? '오늘' : '내일'}: ${t.title}`.slice(0, 200),
          body: `업무 마감일이 ${isToday ? '오늘' : '내일'}입니다.`,
          link: t.projectId ? `/admin/projects/${t.projectId}?task=${t.id}` : `/admin/my-tasks?task=${t.id}`,
          entityType: 'TASK',
          entityId: t.id,
        },
        select: { id: true },
      });
      created.push(n.id);
    }
  }
  return { created };
}

/** 유지보수: 만료/폐기 후 7일 지난 세션 삭제, 만료 후 30일 지난 미수락 초대 삭제 */
export async function runMaintenance(prisma: PrismaClient, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const sessions = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] },
  });
  const invitations = await prisma.invitation.deleteMany({
    where: { acceptedAt: null, OR: [{ expiresAt: { lt: monthAgo } }, { revokedAt: { lt: monthAgo } }] },
  });
  return { sessions: sessions.count, invitations: invitations.count };
}
