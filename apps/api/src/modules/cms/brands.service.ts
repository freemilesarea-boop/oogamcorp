import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertEditable, assertTransition, deletedSlug, resolveSlug, transitionAction } from './cms.shared';
import { ContentQueryDto, CreateBrandDto, ReorderDto, StatusChangeDto, UpdateBrandDto } from './dto/cms.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ContentQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.BrandWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const orderBy: Prisma.BrandOrderByWithRelationInput[] = q.sort
      ? [orderByArg(q, ['sortOrder', 'name', 'updatedAt', 'createdAt', 'status'] as const, 'sortOrder')]
      : [{ sortOrder: 'asc' }, { createdAt: 'asc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({
        where, skip, take, orderBy,
        include: { _count: { select: { portfolioItems: { where: { deletedAt: null } } } } },
      }),
      this.prisma.brand.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(auth: AuthContext, id: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!brand) throw new NotFoundException('브랜드를 찾을 수 없습니다.');
    return brand;
  }

  private async assertSlugFree(auth: AuthContext, slug: string, exceptId?: string) {
    const dup = await this.prisma.brand.findFirst({
      where: { organizationId: auth.organizationId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new ConflictException('이미 사용 중인 슬러그입니다.');
  }

  async create(auth: AuthContext, dto: CreateBrandDto) {
    const slug = resolveSlug(dto.slug, dto.name);
    await this.assertSlugFree(auth, slug);
    const sortOrder = dto.sortOrder ?? ((await this.prisma.brand.aggregate({
      where: { organizationId: auth.organizationId, deletedAt: null }, _max: { sortOrder: true },
    }))._max.sortOrder ?? -1) + 1;
    const brand = await this.prisma.brand.create({
      data: { ...dto, slug, sortOrder, organizationId: auth.organizationId, status: 'DRAFT', createdById: auth.userId, updatedById: auth.userId },
    });
    await this.audit.forUser(auth, 'cms.brand.created', { entityType: 'brand', entityId: brand.id, metadata: { slug } });
    return brand;
  }

  async update(auth: AuthContext, id: string, dto: UpdateBrandDto) {
    const brand = await this.get(auth, id);
    assertEditable(auth, brand.status);
    if (dto.slug && dto.slug !== brand.slug) await this.assertSlugFree(auth, dto.slug, id);
    return this.prisma.brand.update({ where: { id }, data: { ...dto, updatedById: auth.userId } });
  }

  async changeStatus(auth: AuthContext, id: string, dto: StatusChangeDto) {
    const brand = await this.get(auth, id);
    assertTransition(auth, brand.status, dto.status);
    if (dto.status === 'PUBLISHED' && brand.relationshipNote?.trim() && !dto.acknowledgeRelationship) {
      throw new BadRequestException('관계 확인 메모가 있는 브랜드입니다. 공식 계열사·자회사로 표기하지 않음을 확인(acknowledgeRelationship)한 뒤 게시하세요.');
    }
    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        status: dto.status,
        updatedById: auth.userId,
        ...(dto.status === 'PUBLISHED' ? { publishedAt: brand.publishedAt ?? new Date() } : {}),
      },
    });
    await this.audit.forUser(auth, transitionAction('brand', brand.status, dto.status), {
      entityType: 'brand', entityId: id, metadata: { from: brand.status, to: dto.status, slug: brand.slug, acknowledgeRelationship: dto.acknowledgeRelationship ?? false },
    });
    return updated;
  }

  async reorder(auth: AuthContext, dto: ReorderDto) {
    const ids = [...new Set(dto.ids)];
    const count = await this.prisma.brand.count({ where: { id: { in: ids }, organizationId: auth.organizationId, deletedAt: null } });
    if (count !== ids.length) throw new BadRequestException('존재하지 않는 브랜드가 포함되어 있습니다.');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.brand.update({ where: { id }, data: { sortOrder: i } })));
    await this.audit.forUser(auth, 'cms.brand.reordered', { entityType: 'brand', metadata: { count: ids.length } });
    return { ok: true };
  }

  async remove(auth: AuthContext, id: string) {
    const brand = await this.get(auth, id);
    assertEditable(auth, brand.status);
    await this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date(), slug: deletedSlug(brand.slug, id), updatedById: auth.userId } });
    await this.audit.forUser(auth, 'cms.brand.deleted', { entityType: 'brand', entityId: id, metadata: { slug: brand.slug, name: brand.name } });
    return { ok: true };
  }
}
