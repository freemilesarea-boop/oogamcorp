import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';

@Module({ controllers: [AuthController, MfaController], providers: [AuthService, MfaService], exports: [AuthService, MfaService] })
export class AuthModule {}
