import './config/env-loader';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { loadConfig } from './config/configuration';
import { QUEUE_NAMES } from './common/queue/queue.service';
import { runDueReminders, runMaintenance, sendInvitationEmail, sendNotificationEmail, type Mailer } from './worker/jobs';

/**
 * 백그라운드 워커 (BullMQ, 큐: oogam-notifications)
 * - email: 알림 이메일 발송 (SMTP_ENABLED=true 일 때만 실제 발송)
 * - invitation-email: 초대 메일 발송 (SMTP 활성 시)
 * - due-reminders: 1시간마다 마감 임박 업무 알림 생성
 * - maintenance: 6시간마다 만료 세션/초대 정리
 */
type WorkerJob =
  | { kind: 'email'; notificationId: string }
  | { kind: 'due-reminders' }
  | { kind: 'maintenance' }
  | { kind: 'invitation-email'; invitationId: string; sealedToken: string };

const cfg = loadConfig();
const log = pino({ level: cfg.logLevel, base: { service: 'oogam-worker' }, redact: ['token', '*.token', 'data.token'] });

function createMailer(): Mailer | null {
  if (!cfg.smtp.enabled) return null;
  if (!cfg.smtp.host || !cfg.smtp.from) {
    log.warn('SMTP_ENABLED=true 이지만 SMTP_HOST/SMTP_FROM 이 없어 이메일을 발송하지 않습니다.');
    return null;
  }
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.port === 465,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
  });
  return {
    async send(msg) {
      await transport.sendMail({ from: cfg.smtp.from, ...msg });
    },
  };
}

async function main() {
  const prisma = new PrismaClient();
  const connection = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (e) => log.warn({ err: e.message }, 'Redis 연결 오류'));
  const mailer = createMailer();
  const deps = { prisma, cfg, mailer, log };

  const queue = new Queue<WorkerJob>(QUEUE_NAMES.notifications, { connection });
  await queue.upsertJobScheduler('due-reminders', { every: 60 * 60_000 }, { name: 'due-reminders', data: { kind: 'due-reminders' }, opts: { removeOnComplete: 100, removeOnFail: 100 } });
  await queue.upsertJobScheduler('maintenance', { every: 6 * 60 * 60_000 }, { name: 'maintenance', data: { kind: 'maintenance' }, opts: { removeOnComplete: 50, removeOnFail: 50 } });

  const worker = new Worker<WorkerJob>(
    QUEUE_NAMES.notifications,
    async (job: Job<WorkerJob>) => {
      const data = job.data;
      const started = Date.now();
      switch (data.kind) {
        case 'email': {
          const r = await sendNotificationEmail(deps, data.notificationId);
          log.info({ jobId: job.id, kind: data.kind, result: r, ms: Date.now() - started }, '작업 완료');
          return r;
        }
        case 'invitation-email': {
          const r = await sendInvitationEmail(deps, data.invitationId, data.sealedToken);
          log.info({ jobId: job.id, kind: data.kind, invitationId: data.invitationId, result: r, ms: Date.now() - started }, '작업 완료');
          return r;
        }
        case 'due-reminders': {
          const { created } = await runDueReminders(prisma);
          // 이메일 발송은 SMTP 활성 시에만 큐잉
          if (cfg.smtp.enabled) {
            for (const id of created) await queue.add('email', { kind: 'email', notificationId: id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000 });
          }
          log.info({ jobId: job.id, kind: data.kind, created: created.length, ms: Date.now() - started }, '마감 알림 생성');
          return { created: created.length };
        }
        case 'maintenance': {
          const r = await runMaintenance(prisma);
          log.info({ jobId: job.id, kind: data.kind, ...r, ms: Date.now() - started }, '유지보수 완료');
          return r;
        }
        default:
          log.warn({ jobId: job.id, name: job.name }, '알 수 없는 작업');
          return null;
      }
    },
    { connection, concurrency: 5 },
  );
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, err: err.message }, '작업 실패'));
  worker.on('error', (err) => log.error({ err: err.message }, '워커 오류'));
  log.info({ queue: QUEUE_NAMES.notifications, smtp: cfg.smtp.enabled }, '워커 시작');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, '워커 종료 중');
    const timer = setTimeout(() => {
      log.error('종료 시간 초과 — 강제 종료');
      process.exit(1);
    }, 30_000);
    try {
      await worker.close();
      await queue.close();
      await prisma.$disconnect();
      await connection.quit();
    } catch (e) {
      log.error({ err: (e as Error).message }, '종료 중 오류');
    } finally {
      clearTimeout(timer);
      log.info('워커 종료');
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  log.fatal({ err: (e as Error).message }, '워커 기동 실패');
  process.exit(1);
});
