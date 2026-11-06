import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { EntityType, File as FileRow, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { EntityAccessService, type Need } from '../access/entity-access.service';
import { isAllowed, magicMatches, sanitizeFileName } from './file-policy';
import { FileQueryDto, UploadFileDto } from './files.dto';

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

export function presentFile(f: Pick<FileRow, 'id' | 'originalName' | 'mimeType' | 'size' | 'createdAt' | 'targetType' | 'targetId' | 'uploadedById'>) {
  return {
    id: f.id,
    originalName: f.originalName,
    mimeType: f.mimeType,
    size: f.size,
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
  ) {}

  async upload(auth: AuthContext, file: Express.Multer.File | undefined, dto: UploadFileDto) {
    if (!file || !file.buffer?.length) throw new BadRequestException('업로드할 파일이 없습니다.');
    const originalName = sanitizeFileName(file.originalname ?? 'file');
    const mimeType = (file.mimetype ?? '').toLowerCase().split(';')[0].trim();
    if (!isAllowed(mimeType, originalName)) {
      throw new UnsupportedMediaTypeException('허용되지 않는 파일 형식입니다. (이미지, PDF, 오피스 문서, 텍스트, CSV, ZIP 만 가능)');
    }
    if (!magicMatches(mimeType, file.buffer)) throw new UnsupportedMediaTypeException('파일 내용이 형식과 일치하지 않습니다.');

    if (dto.targetType && dto.targetId) {
      const need = UPLOAD_NEED[dto.targetType] ?? 'view';
      if (!(await this.entityAccess.can(auth, dto.targetType, dto.targetId, need))) {
        throw new ForbiddenException('해당 대상에 파일을 첨부할 권한이 없습니다.');
      }
    }

    const key = this.storage.generateKey(auth.organizationId);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.put(key, file.buffer, mimeType);
    try {
      const row = await this.prisma.file.create({
        data: {
          organizationId: auth.organizationId,
          storageKey: key,
          originalName,
          mimeType,
          size: file.size,
          checksum,
          targetType: dto.targetType ?? null,
          targetId: dto.targetId ?? null,
          uploadedById: auth.userId,
        },
      });
      return presentFile(row);
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
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
