import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '../../config/configuration';

/**
 * AES-256-GCM 대칭 암호화. 형식: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * 키는 APP_ENCRYPTION_KEY (32바이트 base64 또는 hex). 길이가 다르면 SHA-256 으로 정규화한다.
 * 용도: MFA TOTP 비밀키 저장, Redis 작업 큐 내 민감 페이로드(초대 토큰) 보호.
 */
function key(): Buffer {
  const raw = loadConfig().encryptionKey;
  let buf: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) buf = createHash('sha256').update(raw).digest();
  return buf;
}

export function seal(plain: string, aad = 'oogam'): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function open(sealed: string, aad = 'oogam'): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('잘못된 암호문 형식');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
