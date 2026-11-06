import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 30초, 6자리) + RFC 4648 Base32 — 외부 의존성 없이 구현 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('잘못된 Base32 문자');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * 코드 검증. ±window 단계 허용, lastUsedStep 이하 단계는 재사용으로 거부.
 * 성공 시 일치한 단계 번호 반환, 실패 시 null.
 */
export function verifyTotp(secret: string, code: string, opts: { window?: number; lastUsedStep?: number | null; now?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const window = opts.window ?? 1;
  const step = currentStep(opts.now);
  for (let w = -window; w <= window; w++) {
    const s = step + w;
    if (opts.lastUsedStep != null && s <= opts.lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secret, s));
    if (timingSafeEqual(expected, Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
