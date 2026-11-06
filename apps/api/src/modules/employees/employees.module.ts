import { Module } from '@nestjs/common';
import { EmployeesController, InvitationsController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { InvitationsService } from './invitations.service';

/** 직원 관리: 목록/상세/프로필·역할 변경/비활성화/초대/민감 인사정보 */
@Module({
  // InvitationsController 를 먼저 등록해 /employees/invitations 가 /employees/:id 보다 우선 매칭되도록 한다
  controllers: [InvitationsController, EmployeesController],
  providers: [EmployeesService, InvitationsService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
