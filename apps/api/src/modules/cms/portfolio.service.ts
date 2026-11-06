import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertEditable, assertTransition, deletedSlug, resolveSlug, transitionAction } from './cms.shared';
import { CreatePortfolioDto, PortfolioQueryDto, StatusChangeDto, UpdatePortfolioDto } from './dto/cms.dto';

const brandRef = { select: { id: true, name: true, slug: true, status: true } } as const;

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: PortfolioQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.PortfolioItemWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.featured ? { featured: q.featured === 'true' } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { client: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const orderBy: Prisma.PortfolioItemOrderByWithRelationInput[] = q.sort
      ? [orderByArg(q, ['sortOrder', 'title', 'year', 'updatedAt', 'createdAt'] as const, 'sortOrder')]
      : [{ sortOrder: 'asc' }, { createdAt: 'desc' }];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.portfolioItem.findMany({ where, skip, take, orderBy, include: { brand: brandRef } }),
      this.prisma.portfolioItem.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(auth: AuthContext, id: string) {
    const item = await this.prisma.portfolioItem.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null }, include: { brand: brandRef } });
    if (!item) throw new NotFoundException('포트폴리오 항목을 찾을 수 없습니다.');
    return item;
  }

  private async assertRefs(auth: AuthContext, slug: string | undefined, brandId: string | null | undefined, exceptId?: string) {
    if (slug) {
      const dup = await this.prisma.portfolioItem.findFirst({
        where: { organizationId: auth.organizationId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true },
      });
      if (dup) throw new ConflictException('이미 사용 중인 슬러그입니다.');
    }
    if (brandId) {
      const ok = await this.prisma.brand.count({ where: { id: brandId, organizationId: auth.organizationId, deletedAt: null } });
      if (!ok) throw new BadRequestException('브랜드를 찾을 수 없습니다.');
    }
  }

  async create(auth: AuthContext, dto: CreatePortfolioDto) {
    const slug = resolveSlug(dto.slug, dto.title);
    await this.assertRefs(auth, slug, dto.brandId);
    const item = await this.prisma.portfolioItem.create({
      data: { ...dto, tags: dto.tags ?? [], slug, organizationId: auth.organizationId, status: 'DRAFT' },
      include: { brand: brandRef },
    });
    await this.audit.forUser(auth, 'cms.portfolio.created', { entityType: 'portfolio_item', entityId: item.id, metadata: { slug } });
    return item;
  }

  async update(auth: AuthContext, id: string, dto: UpdatePortfolioDto) {
    const item = await this.get(auth, id);
    assertEditable(auth, item.status);
    await this.assertRefs(auth, dto.slug && dto.slug !== item.slug ? dto.slug : undefined, dto.brandId, id);
    return this.prisma.portfolioItem.update({ where: { id }, data: dto, include: { brand: brandRef } });
  }

  async changeStatus(auth: AuthContext, id: string, dto: StatusChangeDto) {
    const item = await this.get(auth, id);
    assertTransition(auth, item.status, dto.status);
    const updated = await this.prisma.portfolioItem.update({
      where: { id },
      data: { status: dto.status, ...(dto.status === 'PUBLISHED' ? { publishedAt: item.publishedAt ?? new Date() } : {}) },
      include: { brand: brandRef },
    });
    await this.audit.forUser(auth, transitionAction('portfolio', item.status, dto.status), {
      entityType: 'portfolio_item', entityId: id, metadata: { from: item.status, to: dto.status, slug: item.slug },
    });
    return updated;
  }

  async remove(auth: AuthContext, id: string) {
    const item = await this.get(auth, id);
    assertEditable(auth, item.status);
    await this.prisma.portfolioItem.update({ where: { id }, data: { deletedAt: new Date(), slug: deletedSlug(item.slug, id) } });
    await this.audit.forUser(auth, 'cms.portfolio.deleted', { entityType: 'portfolio_item', entityId: id, metadata: { slug: item.slug, title: item.title } });
    return { ok: true };
  }
}
