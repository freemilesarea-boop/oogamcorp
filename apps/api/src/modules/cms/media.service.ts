import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated, type PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface UploadedImage {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

/** 허용 입력 형식 (매직 바이트 기준). SVG·HTML 등 스크립트를 담을 수 있는 형식은 허용하지 않는다 */
export function sniffImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  return null;
}

/** 저장 키 형식 (경로 조작 방지) */
export const MEDIA_KEY_RE = /^cms\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/;

const MAX_EDGE = 2560;
const MAX_INPUT_PIXELS = 50_000_000;

function cfg() {
  return {
    driver: (process.env.MEDIA_STORAGE ?? 'local') as 'local' | 'supabase',
    maxBytes: Math.floor(Number(process.env.MEDIA_MAX_MB ?? 4) * 1024 * 1024),
    localDir: resolve(process.env.MEDIA_LOCAL_DIR ?? './storage/media'),
    supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    bucket: process.env.SUPABASE_MEDIA_BUCKET ?? 'oogam-public',
  };
}

/**
 * 공개 홈페이지용 이미지 업로드.
 * 1) 크기 제한 2) 매직 바이트로 형식 확인 3) sharp 로 재인코딩(WebP, 최대 2560px, EXIF·메타데이터 제거)
 *    → 원본 바이트를 그대로 저장하지 않으므로 폴리글랏/숨은 페이로드가 제거된다.
 * 4) 무작위 키로 저장 (사용자 파일명은 경로에 쓰지 않음)
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  maxBytes() {
    return cfg().maxBytes;
  }

  async upload(auth: AuthContext, file: UploadedImage | undefined, alt?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('이미지 파일(file)을 첨부하세요.');
    const c = cfg();
    if (file.size > c.maxBytes || file.buffer.length > c.maxBytes) {
      throw new PayloadTooLargeException(`이미지는 ${Math.round(c.maxBytes / 1024 / 1024)}MB 이하만 업로드할 수 있습니다.`);
    }
    const kind = sniffImage(file.buffer);
    if (!kind) throw new BadRequestException('JPG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.');

    const sharp = (await import('sharp')).default;
    let out: { data: Buffer; info: { width: number; height: number; size: number } };
    try {
      out = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException('이미지를 처리할 수 없습니다. 손상되었거나 지원하지 않는 이미지입니다.');
    }

    const now = new Date();
    const key = `cms/${auth.organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.webp`;
    const url = await this.put(key, out.data);
    const media = await this.prisma.cmsMedia.create({
      data: {
        organizationId: auth.organizationId, storageKey: key, url, mimeType: 'image/webp',
        width: out.info.width, height: out.info.height, sizeBytes: out.data.length,
        originalName: file.originalname?.slice(0, 255) ?? null, alt: alt?.trim().slice(0, 300) || null, createdById: auth.userId,
      },
    });
    await this.audit.forUser(auth, 'cms.media.uploaded', { entityType: 'cms_media', entityId: media.id, metadata: { sizeBytes: media.sizeBytes, inputType: kind } });
    return media;
  }

  async list(auth: AuthContext, q: PaginationQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = { organizationId: auth.organizationId, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cmsMedia.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.cmsMedia.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  /** 라이브러리에서 숨김 (이미 게시된 콘텐츠가 참조할 수 있으므로 파일은 지우지 않는다) */
  async remove(auth: AuthContext, id: string) {
    const m = await this.prisma.cmsMedia.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!m) throw new NotFoundException('이미지를 찾을 수 없습니다.');
    await this.prisma.cmsMedia.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.forUser(auth, 'cms.media.deleted', { entityType: 'cms_media', entityId: id });
    return { ok: true };
  }

  /** 로컬 드라이버 전용 공개 조회 */
  async readLocal(key: string): Promise<Buffer | null> {
    const c = cfg();
    if (c.driver !== 'local' || !MEDIA_KEY_RE.test(key)) return null;
    const path = join(c.localDir, key);
    if (!path.startsWith(c.localDir + '/')) return null;
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  private async put(key: string, data: Buffer): Promise<string> {
    const c = cfg();
    if (c.driver === 'supabase') {
      if (!c.supabaseUrl || !c.supabaseKey) throw new ServiceUnavailableException('이미지 저장소가 설정되지 않았습니다.');
      const res = await fetch(`${c.supabaseUrl}/storage/v1/object/${encodeURIComponent(c.bucket)}/${key}`, {
        method: 'POST',
        headers: {
          apikey: c.supabaseKey,
          // 새 형식 secret key(sb_secret_…)는 JWT 가 아니므로 apikey 헤더로만 전달, 레거시 service_role(JWT)은 Bearer 도 함께
          ...(c.supabaseKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${c.supabaseKey}` }),
          'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'false',
        },
        body: new Uint8Array(data),
      });
      if (!res.ok) {
        this.logger.error(`Supabase Storage 업로드 실패: ${res.status} ${(await res.text()).slice(0, 200)}`);
        throw new ServiceUnavailableException('이미지를 저장하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
      return `${c.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(c.bucket)}/${key}`;
    }
    const path = join(c.localDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o644 });
    // 로컬 드라이버(개발·테스트): 공개 사이트 출처 기준 절대 URL
    const origin = (process.env.PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    return `${origin}/api/v1/public/media/${key}`;
  }
}
