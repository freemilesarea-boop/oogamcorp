import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { AppConfig } from '../../config/configuration';
import { assertSafeKey, type StorageDriver } from './storage.types';

/** S3 호환 오브젝트 스토리지 드라이버 (AWS S3, MinIO, R2, NCP 등) */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: AppConfig['storage']) {
    this.bucket = cfg.s3Bucket;
    this.client = new S3Client({
      region: cfg.s3Region,
      endpoint: cfg.s3Endpoint,
      forcePathStyle: cfg.s3ForcePathStyle,
      credentials: cfg.s3AccessKey && cfg.s3SecretKey ? { accessKeyId: cfg.s3AccessKey, secretAccessKey: cfg.s3SecretKey } : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = out.Body;
    if (!body) throw new Error('빈 오브젝트');
    if (body instanceof Readable) return body;
    // 브라우저/웹 스트림 형태가 반환된 경우 변환
    const web = (body as { transformToWebStream?: () => ReadableStream }).transformToWebStream?.();
    if (web) return Readable.fromWeb(web as unknown as import('node:stream/web').ReadableStream);
    throw new Error('지원하지 않는 스트림 형식');
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
