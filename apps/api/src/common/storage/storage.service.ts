import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { loadConfig } from '../../config/configuration';
import { LocalStorageDriver } from './local.driver';
import { S3StorageDriver } from './s3.driver';
import type { StorageDriver } from './storage.types';

export function createStorageDriver(cfg = loadConfig().storage): StorageDriver {
  return cfg.driver === 's3' ? new S3StorageDriver(cfg) : new LocalStorageDriver(cfg.localDir);
}

/** 설정(STORAGE_DRIVER)에 따라 local / s3 드라이버를 선택하는 스토리지 파사드 */
@Injectable()
export class StorageService {
  private readonly driver: StorageDriver = createStorageDriver();

  get driverName() {
    return this.driver.name;
  }

  /** 추측 불가능한 무작위 키 생성: org/yyyy/mm/uuid */
  generateKey(organizationId: string, now = new Date()): string {
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${organizationId}/${yyyy}/${mm}/${randomUUID()}`;
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  getStream(key: string): Promise<Readable> {
    return this.driver.getStream(key);
  }

  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
