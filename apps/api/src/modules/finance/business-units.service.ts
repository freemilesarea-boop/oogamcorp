import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BusinessUnitQueryDto, CreateBusinessUnitDto, UpdateBusinessUnitDto } from './dto/finance.dto';

/** 사업 구분 (내부 관리 단위). 모델에 deletedAt 이 없으므로 참조 중이면 비활성화, 아니면 삭제 */
@Injectable()
export class BusinessUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, q: BusinessUnitQueryDto) {
    return this.prisma.businessUnit.findMany({
      where: { organizationId: auth.organizationId, ...(q.includeInactive === 'true' ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { budgets: { where: { deletedAt: null } }, transactions: { where: { deletedAt: null } } } } },
    });
  }

  private async find(auth: AuthContext, id: string) {
    const unit = await this.prisma.businessUnit.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!unit) throw new NotFoundException('사업 구분을 찾을 수 없습니다.');
    return unit;
  }

  async create(auth: AuthContext, dto: CreateBusinessUnitDto) {
    const dup = await this.prisma.businessUnit.count({ where: { organizationId: auth.organizationId, code: dto.code } });
    if (dup) throw new ConflictException('이미 사용 중인 코드입니다.');
    const unit = await this.prisma.businessUnit.create({
      data: { organizationId: auth.organizationId, name: dto.name, code: dto.code, description: dto.description ?? null, isActive: dto.isActive ?? true },
    });
    await this.audit.forUser(auth, 'finance.business_unit.created', { entityType: 'business_unit', entityId: unit.id, metadata: { code: unit.code } });
    return unit;
  }

  async update(auth: AuthContext, id: string, dto: UpdateBusinessUnitDto) {
    const before = await this.find(auth, id);
    if (dto.code && dto.code !== before.code) {
      const dup = await this.prisma.businessUnit.count({ where: { organizationId: auth.organizationId, code: dto.code } });
      if (dup) throw new ConflictException('이미 사용 중인 코드입니다.');
    }
    const unit = await this.prisma.businessUnit.update({
      where: { id },
      data: { name: dto.name, code: dto.code, description: dto.description, isActive: dto.isActive },
    });
    await this.audit.forUser(auth, 'finance.business_unit.updated', { entityType: 'business_unit', entityId: id });
    return unit;
  }

  async remove(auth: AuthContext, id: string) {
    await this.find(auth, id);
    const [budgets, txs] = await Promise.all([
      this.prisma.budget.count({ where: { businessUnitId: id } }),
      this.prisma.financialTransaction.count({ where: { businessUnitId: id } }),
    ]);
    if (budgets + txs > 0) {
      await this.prisma.businessUnit.update({ where: { id }, data: { isActive: false } });
      await this.audit.forUser(auth, 'finance.business_unit.deactivated', { entityType: 'business_unit', entityId: id });
      return { ok: true, deactivated: true };
    }
    await this.prisma.businessUnit.delete({ where: { id } });
    await this.audit.forUser(auth, 'finance.business_unit.deleted', { entityType: 'business_unit', entityId: id });
    return { ok: true, deactivated: false };
  }
}
