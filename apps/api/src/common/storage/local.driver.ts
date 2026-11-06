import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { assertSafeKey, type StorageDriver } from './storage.types';

/**
 * 로컬 디스크 드라이버 (개발/단일 서버용).
 * 키 형식 검증 + 루트 디렉터리 이탈 검사로 경로 조작(path traversal)을 이중으로 차단한다.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('스토리지 경로 이탈 차단');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true, mode: 0o750 });
    await writeFile(p, body, { mode: 0o640, flag: 'wx' });
  }

  async getStream(key: string): Promise<Readable> {
    const p = this.pathFor(key);
    await stat(p); // 존재 확인 (없으면 ENOENT)
    return createReadStream(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
