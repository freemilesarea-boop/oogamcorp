import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { CreateGrantDto, CreateRoleDto, GrantQueryDto, SetRolePermissionsDto, SystemSettingDto } from './settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@RequirePermissions('permissions.manage')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('roles')
  roles(@CurrentUser() u: AuthContext) {
    return this.settings.roles(u);
  }

  @Get('permissions')
  permissions() {
    return this.settings.permissionCatalog();
  }

  @Post('roles')
  createRole(@CurrentUser() u: AuthContext, @Body() dto: CreateRoleDto) {
    return this.settings.createRole(u, dto);
  }

  @Put('roles/:id/permissions')
  setPermissions(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto) {
    return this.settings.setRolePermissions(u, id, dto);
  }

  @Delete('roles/:id')
  deleteRole(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.deleteRole(u, id);
  }

  @Get('grants')
  grants(@CurrentUser() u: AuthContext, @Query() q: GrantQueryDto) {
    return this.settings.grants(u, q);
  }

  @Post('grants')
  createGrant(@CurrentUser() u: AuthContext, @Body() dto: CreateGrantDto) {
    return this.settings.createGrant(u, dto);
  }

  @Delete('grants/:id')
  deleteGrant(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.deleteGrant(u, id);
  }

  @RequirePermissions('settings.manage')
  @Get('system')
  listSystem(@CurrentUser() u: AuthContext) {
    return this.settings.listSystem(u);
  }

  @RequirePermissions('settings.manage')
  @Get('system/:key')
  getSystem(@CurrentUser() u: AuthContext, @Param('key') key: string) {
    return this.settings.getSystem(u, key);
  }

  @RequirePermissions('settings.manage')
  @Put('system/:key')
  putSystem(@CurrentUser() u: AuthContext, @Param('key') key: string, @Body() dto: SystemSettingDto) {
    return this.settings.putSystem(u, key, dto.value);
  }
}
