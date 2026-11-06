import * as argon2 from 'argon2';

/** Argon2id (OWASP 권장 파라미터 수준) */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string | null | undefined, plain: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** 존재하지 않는 계정에서도 동일한 시간이 걸리도록 하기 위한 더미 해시 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('dummy-password-for-timing-1');
  return dummy;
}
