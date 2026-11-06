import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { SessionService } from './session.service';

@Global()
@Module({ providers: [AccessService, SessionService], exports: [AccessService, SessionService] })
export class AuthCoreModule {}
