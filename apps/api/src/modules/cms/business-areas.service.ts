import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertEditable, assertTransition, deletedSlug, resolveSlug, transitionAction } from './cms.shared';
import { ContentQueryDto, CreateBusinessAreaDto, ReorderDto, StatusChangeDto, UpdateBusinessAreaDto } from './dto/cms.dto';

/** 사업 영역 (공개 사이트 Business Areas · /business/[slug]). 상태 워크플로는 브랜드와 동일 */
@Injectable()
export class BusinessAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ContentQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.BusinessAreaWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const orderBy: Prisma.BusinessAreaOrderByWithRelationInput[] = q.sort
      ? [orderByArg(q, ['sortOrder', 'title', 'updatedAt', 'createdAt', 'status'] as const, 'sortOrder')]
      : [{ sortOrder: 'asc' }, { createdAt: 'asc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.businessArea.findMany({ where, skip, take, orderBy }),
      this.prisma.businessArea.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(auth: AuthContext, id: string) {
    const area = await this.prisma.businessArea.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!area) throw new NotFoundException('사업 영역을 찾을 수 없습니다.');
    return area;
  }

  private async assertSlugFree(auth: AuthContext, slug: string, exceptId?: string) {
    const dup = await this.prisma.businessArea.findFirst({
      where: { organizationId: auth.organizationId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new ConflictException('이미 사용 중인 슬러그입니다.');
  }

  async create(auth: AuthContext, dto: CreateBusinessAreaDto) {
    const slug = resolveSlug(dto.slug, dto.title);
    await this.assertSlugFree(auth, slug);
    const sortOrder = dto.sortOrder ?? ((await this.prisma.businessArea.aggregate({
      where: { organizationId: auth.organizationId, deletedAt: null }, _max: { sortOrder: true },
    }))._max.sortOrder ?? -1) + 1;
    const area = await this.prisma.businessArea.create({
      data: { ...dto, highlights: dto.highlights ?? [], slug, sortOrder, organizationId: auth.organizationId, status: 'DRAFT', createdById: auth.userId, updatedById: auth.userId },
    });
    await this.audit.forUser(auth, 'cms.business_area.created', { entityType: 'business_area', entityId: area.id, metadata: { slug } });
    return area;
  }

  async update(auth: AuthContext, id: string, dto: UpdateBusinessAreaDto) {
    const area = await this.get(auth, id);
    assertEditable(auth, area.status);
    if (dto.slug && dto.slug !== area.slug) await this.assertSlugFree(auth, dto.slug, id);
    const updated = await this.prisma.businessArea.update({ where: { id }, data: { ...dto, updatedById: auth.userId } });
    await this.audit.forUser(auth, 'cms.business_area.updated', { entityType: 'business_area', entityId: id, metadata: { slug: updated.slug } });
    return updated;
  }

  async changeStatus(auth: AuthContext, id: string, dto: StatusChangeDto) {
    const area = await this.get(auth, id);
    assertTransition(auth, area.status, dto.status);
    const updated = await this.prisma.businessArea.update({
      where: { id },
      data: { status: dto.status, updatedById: auth.userId, ...(dto.status === 'PUBLISHED' ? { publishedAt: area.publishedAt ?? new Date() } : {}) },
    });
    await this.audit.forUser(auth, transitionAction('business_area', area.status, dto.status), {
      entityType: 'business_area', entityId: id, metadata: { from: area.status, to: dto.status, slug: area.slug },
    });
    return updated;
  }

  async reorder(auth: AuthContext, dto: ReorderDto) {
    const ids = [...new Set(dto.ids)];
    const count = await this.prisma.businessArea.count({ where: { id: { in: ids }, organizationId: auth.organizationId, deletedAt: null } });
    if (count !== ids.length) throw new BadRequestException('존재하지 않는 사업 영역이 포함되어 있습니다.');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.businessArea.update({ where: { id }, data: { sortOrder: i } })));
    await this.audit.forUser(auth, 'cms.business_area.reordered', { entityType: 'business_area', metadata: { count: ids.length } });
    return { ok: true };
  }

  async remove(auth: AuthContext, id: string) {
    const area = await this.get(auth, id);
    assertEditable(auth, area.status);
    await this.prisma.businessArea.update({ where: { id }, data: { deletedAt: new Date(), slug: deletedSlug(area.slug, id), updatedById: auth.userId } });
    await this.audit.forUser(auth, 'cms.business_area.deleted', { entityType: 'business_area', entityId: id, metadata: { slug: area.slug, title: area.title } });
    return { ok: true };
  }
}
