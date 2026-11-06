import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,
  PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { EntityType, File as FileRow, FileScanStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { detectFileType } from '../../common/storage/file-signature';
import { containsEicar, MalwareScanner, type ScanOutcome } from '../../common/storage/malware-scanner';
import { StorageService } from '../../common/storage/storage.service';
import { EntityAccessService, type Need } from '../access/entity-access.service';
import {
  canonicalDetectedMime, detectedMatchesDeclared, hasControlChars, hasDangerousExtension, isAllowed, sanitizeFileName,
} from './file-policy';
import { FileQueryDto, UploadFileDto } from './files.dto';
import { maxUploadBytes, tooLargeMessage } from './upload.interceptor';

/** 대상 엔터티에 파일을 첨부할 때 필요한 접근 수준 */
const UPLOAD_NEED: Partial<Record<EntityType, Need>> = {
  TRANSACTION: 'edit',
  BUDGET: 'edit',
  CMS: 'edit',
  USER: 'edit',
  DEPARTMENT: 'edit',
  PAGE: 'comment',
  DATABASE: 'edit',
  DATABASE_ROW: 'edit',
};

/** 다운로드를 허용하지 않는 검사 상태 (검사 대기/엔진 오류/감염) */
const BLOCKED_SCAN: FileScanStatus[] = ['PENDING', 'ERROR', 'INFECTED'];

export function presentFile(
  f: Pick<FileRow, 'id' | 'originalName' | 'mimeType' | 'size' | 'createdAt' | 'targetType' | 'targetId' | 'uploadedById'> &
    Partial<Pick<FileRow, 'detectedMime' | 'scanStatus'>>,
) {
  return {
    id: f.id,
    originalName: f.originalName,
    mimeType: f.mimeType,
    detectedMime: f.detectedMime ?? null,
    size: f.size,
    scanStatus: f.scanStatus ?? 'SKIPPED',
    downloadable: !BLOCKED_SCAN.includes(f.scanStatus ?? 'SKIPPED'),
    createdAt: f.createdAt,
    targetType: f.targetType,
    targetId: f.targetId,
    uploadedById: f.uploadedById,
    url: `/api/v1/files/${f.id}/download`,
  };
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly entityAccess: EntityAccessService,
    private readonly audit: AuditService,
    private readonly scanner: MalwareScanner,
  ) {}

  async upload(auth: AuthContext, file: Express.Multer.File | undefined, dto: UploadFileDto) {
    if (auth.roleKey === 'GUEST' || !auth.permissions.has('files.write')) throw new ForbiddenException('파일을 업로드할 권한이 없습니다.');
    if (!file) throw new BadRequestException('업로드할 파일이 없습니다.');
    const buf = file.buffer;
    if (!buf?.length || file.size === 0) throw new BadRequestException('빈 파일은 업로드할 수 없습니다.');
    if (buf.length > maxUploadBytes()) throw new PayloadTooLargeException(tooLargeMessage());

    // 파일명: 제어문자/양방향 조작 문자 포함 시 거부, 이후 정규화
    const rawName = file.originalname ?? 'file';
    if (hasControlChars(rawName)) throw new BadRequestException('파일 이름에 허용되지 않는 문자(제어문자)가 포함되어 있습니다.');
    const originalName = sanitizeFileName(rawName);
    if (hasDangerousExtension(originalName)) {
      throw new UnsupportedMediaTypeException('실행 파일·스크립트·웹 문서(HTML/SVG 등) 형식은 업로드할 수 없습니다.');
    }
    const mimeType = (file.mimetype ?? '').toLowerCase().split(';')[0].trim();
    if (!isAllowed(mimeType, originalName)) {
      throw new UnsupportedMediaTypeException('허용되지 않는 파일 형식입니다. (이미지, PDF, 오피스 문서, 텍스트, CSV, ZIP 만 가능)');
    }

    // 실제 내용(매직 바이트) 판별
    const detected = detectFileType(buf);
    if (detected.dangerous) {
      throw new UnsupportedMediaTypeException(`실행 파일·스크립트·웹 문서 형식은 업로드할 수 없습니다. (감지된 형식: ${detected.label})`);
    }
    if (!detectedMatchesDeclared(mimeType, detected.mime)) {
      throw new BadRequestException(`파일 내용이 확장자/형식과 일치하지 않습니다. (감지된 형식: ${detected.label})`);
    }
    const detectedMime = canonicalDetectedMime(detected.mime, mimeType, originalName);

    if (dto.targetType && dto.targetId) {
      const need = UPLOAD_NEED[dto.targetType] ?? 'view';
      if (!(await this.entityAccess.can(auth, dto.targetType, dto.targetId, need))) {
        throw new ForbiddenException('해당 대상에 파일을 첨부할 권한이 없습니다.');
      }
    }

    const checksum = createHash('sha256').update(buf).digest('hex');
    const scan = await this.scanForUpload(auth, buf, { name: originalName, checksum, size: buf.length });

    const key = this.storage.generateKey(auth.organizationId);
    await this.storage.put(key, buf, detectedMime);
    try {
      const row = await this.prisma.file.create({
        data: {
          organizationId: auth.organizationId,
          storageKey: key,
          originalName,
          mimeType,
          detectedMime,
          size: buf.length,
          checksum,
          scanStatus: scan.status,
          scanEngine: scan.engine,
          scannedAt: scan.scannedAt,
          targetType: dto.targetType ?? null,
          targetId: dto.targetId ?? null,
          uploadedById: auth.userId,
        },
      });
      if (scan.status === 'ERROR') {
        await this.audit.forUser(auth, 'file.scan_failed', { entityType: 'file', entityId: row.id, metadata: { name: originalName, error: scan.error } });
      }
      return presentFile(row);
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }

  /**
   * 업로드 악성코드 정책.
   * - 내장 EICAR 검사는 모드와 무관하게 항상 수행
   * - off: SKIPPED / clamav: 엔진 오류 시 ERROR 로 저장(다운로드 차단) / required: 엔진 오류 시 업로드 거부(503)
   * - 감염 판정 시 저장하지 않고 422 + 감사 로그
   */
  private async scanForUpload(
    auth: AuthContext,
    buf: Buffer,
    info: { name: string; checksum: string; size: number },
  ): Promise<{ status: FileScanStatus; engine: string | null; scannedAt: Date | null; error?: string }> {
    const infected = async (engine: string, signature: string): Promise<never> => {
      await this.audit.forUser(auth, 'file.malware_detected', { entityType: 'file', metadata: { ...info, engine, signature } });
      this.logger.warn(`악성코드 업로드 차단 user=${auth.userId} sig=${signature} sha256=${info.checksum}`);
      throw new UnprocessableEntityException('악성코드가 탐지되어 업로드할 수 없습니다.');
    };
    if (containsEicar(buf)) await infected('builtin-eicar', 'EICAR-Test-File');

    const mode = this.scanner.mode();
    if (mode === 'off') return { status: 'SKIPPED', engine: null, scannedAt: null };

    const r: ScanOutcome = await this.scanner.scanWithEngine(buf);
    if (r.status === 'INFECTED') await infected(r.engine, r.signature);
    if (r.status === 'CLEAN') return { status: 'CLEAN', engine: r.engine, scannedAt: new Date() };
    // 엔진 오류
    const error = r.status === 'ERROR' ? r.error : 'unknown';
    this.logger.error(`악성코드 검사 실패(mode=${mode}): ${error}`);
    if (mode === 'required') throw new ServiceUnavailableException('악성코드 검사 서비스를 사용할 수 없어 업로드할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    return { status: 'ERROR', engine: r.engine, scannedAt: null, error };
  }

  /** 파일 접근 판단: files.read + (업로더 본인 또는 연결 대상 열람 가능) */
  async canView(auth: AuthContext, f: FileRow): Promise<boolean> {
    if (f.organizationId !== auth.organizationId || f.deletedAt) return false;
    if (!auth.permissions.has('files.read')) return false;
    if (f.uploadedById === auth.userId) return true;
    if (f.targetType && f.targetId) return this.entityAccess.can(auth, f.targetType, f.targetId, 'view');
    return false;
  }

  private async requireViewable(auth: AuthContext, id: string): Promise<FileRow> {
    const f = await this.prisma.file.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!f || !(await this.canView(auth, f))) throw new NotFoundException('파일을 찾을 수 없습니다.');
    return f;
  }

  async meta(auth: AuthContext, id: string) {
    return presentFile(await this.requireViewable(auth, id));
  }

  async open(auth: AuthContext, id: string): Promise<{ file: FileRow; stream: Readable }> {
    const file = await this.requireViewable(auth, id);
    if (BLOCKED_SCAN.includes(file.scanStatus)) {
      throw new HttpException(
        file.scanStatus === 'INFECTED'
          ? '악성코드가 탐지된 파일은 다운로드할 수 없습니다.'
          : '악성코드 검사가 완료되지 않아 다운로드할 수 없습니다. 재검사 후 다시 시도해 주세요.',
        HttpStatus.LOCKED,
      );
    }
    try {
      return { file, stream: await this.storage.getStream(file.storageKey) };
    } catch (e) {
      this.logger.error(`스토리지 읽기 실패 ${file.id}: ${(e as Error).message}`);
      throw new NotFoundException('파일 내용을 찾을 수 없습니다.');
    }
  }

  async list(auth: AuthContext, q: FileQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    let where: Prisma.FileWhereInput;
    if (q.targetType && q.targetId) {
      if (!(await this.entityAccess.can(auth, q.targetType, q.targetId, 'view'))) throw new NotFoundException('대상을 찾을 수 없습니다.');
      where = {
        organizationId: auth.organizationId,
        deletedAt: null,
        targetType: q.targetType,
        targetId: q.targetId,
        ...(q.mine === 'true' ? { uploadedById: auth.userId } : {}),
      };
    } else {
      // 대상 미지정: 본인이 올린 파일만
      where = { organizationId: auth.organizationId, deletedAt: null, uploadedById: auth.userId };
    }
    if (q.q) where = { ...where, originalName: { contains: q.q, mode: 'insensitive' } };
    const sortField = ['createdAt', 'originalName', 'size'].includes(q.sort ?? '') ? q.sort! : 'createdAt';
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({ where, skip, take, orderBy: { [sortField]: q.order ?? 'desc' } }),
      this.prisma.file.count({ where }),
    ]);
    const uploaders = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uploadedById))] } }, select: { id: true, name: true } });
    const u = new Map(uploaders.map((x) => [x.id, x]));
    return paginated(rows.map((r) => ({ ...presentFile(r), uploadedBy: u.get(r.uploadedById) ?? null, canDelete: r.uploadedById === auth.userId })), total, page, pageSize);
  }

  /** 재검사: 검사 미완료(ERROR/PENDING) 또는 미검사(SKIPPED) 파일을 엔진으로 다시 검사. 업로더 본인 또는 settings.manage */
  async rescan(auth: AuthContext, id: string) {
    const f = await this.requireViewable(auth, id);
    if (!auth.permissions.has('files.write') || (f.uploadedById !== auth.userId && !auth.permissions.has('settings.manage'))) {
      throw new ForbiddenException('파일을 재검사할 권한이 없습니다.');
    }
    if (f.scanStatus === 'CLEAN') return presentFile(f);
    if (this.scanner.mode() === 'off') throw new ConflictException('악성코드 검사 엔진이 비활성화되어 있어 재검사할 수 없습니다.');

    const chunks: Buffer[] = [];
    try {
      for await (const c of await this.storage.getStream(f.storageKey)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    } catch (e) {
      this.logger.error(`스토리지 읽기 실패 ${f.id}: ${(e as Error).message}`);
      throw new NotFoundException('파일 내용을 찾을 수 없습니다.');
    }
    const buf = Buffer.concat(chunks);
    const r: ScanOutcome = containsEicar(buf)
      ? { status: 'INFECTED', engine: 'builtin-eicar', signature: 'EICAR-Test-File' }
      : await this.scanner.scanWithEngine(buf);
    if (r.status === 'ERROR') {
      this.logger.error(`재검사 실패 ${f.id}: ${r.error}`);
      throw new ServiceUnavailableException('악성코드 검사 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (r.status === 'INFECTED') {
      // 감염 파일은 보관하지 않는다: 오브젝트 삭제 + 소프트 삭제
      await this.storage.delete(f.storageKey).catch((e) => this.logger.warn(`감염 오브젝트 삭제 실패 ${f.id}: ${(e as Error).message}`));
      await this.prisma.file.update({ where: { id }, data: { scanStatus: 'INFECTED', scanEngine: r.engine, scannedAt: new Date(), deletedAt: new Date() } });
      await this.audit.forUser(auth, 'file.malware_detected', { entityType: 'file', entityId: id, metadata: { name: f.originalName, engine: r.engine, signature: r.signature, checksum: f.checksum, rescan: true } });
      throw new UnprocessableEntityException('악성코드가 탐지되어 파일을 삭제했습니다.');
    }
    const row = await this.prisma.file.update({ where: { id }, data: { scanStatus: 'CLEAN', scanEngine: r.engine, scannedAt: new Date() } });
    await this.audit.forUser(auth, 'file.rescanned', { entityType: 'file', entityId: id, metadata: { result: 'CLEAN', engine: r.engine } });
    return presentFile(row);
  }

  /** 삭제: 업로더 본인, 또는 files.write + 대상 편집 권한 */
  async remove(auth: AuthContext, id: string) {
    const f = await this.requireViewable(auth, id);
    const own = f.uploadedById === auth.userId;
    const targetEditor = !!f.targetType && !!f.targetId && (await this.entityAccess.can(auth, f.targetType, f.targetId, 'edit'));
    if (!auth.permissions.has('files.write') || (!own && !targetEditor)) throw new ForbiddenException('파일을 삭제할 권한이 없습니다.');
    await this.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.delete(f.storageKey).catch((e) => this.logger.warn(`오브젝트 삭제 실패(지연 정리 필요) ${f.id}: ${(e as Error).message}`));
    await this.audit.forUser(auth, 'file.deleted', { entityType: 'file', entityId: id, metadata: { name: f.originalName, targetType: f.targetType, targetId: f.targetId } });
    return { ok: true };
  }
}
