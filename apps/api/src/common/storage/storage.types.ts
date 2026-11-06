import type { Readable } from 'node:stream';

/** 오브젝트 스토리지 드라이버 공통 인터페이스 (local / s3) */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** 스토리지 키 형식: <orgId>/<yyyy>/<mm>/<uuid> — 사용자 입력(파일명)은 키에 절대 포함하지 않는다 */
export const STORAGE_KEY_RE = /^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export function assertSafeKey(key: string): void {
  if (!STORAGE_KEY_RE.test(key)) throw new Error('잘못된 스토리지 키');
}
