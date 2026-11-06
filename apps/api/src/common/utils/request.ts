import { createHash } from 'node:crypto';
import type { Request } from 'express';

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export function reqMeta(req: Request) {
  return { ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined };
}
