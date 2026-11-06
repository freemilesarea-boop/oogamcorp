import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
export const PASSWORD_MESSAGE = '비밀번호는 10자 이상이며 영문과 숫자를 모두 포함해야 합니다.';

export class LoginDto {
  @IsEmail({}, { message: '올바른 이메일을 입력하세요.' }) @MaxLength(254)
  email: string;

  @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128)
  currentPassword: string;

  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class AcceptInvitationDto {
  @IsString() @MinLength(20) @MaxLength(200)
  token: string;

  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;
}

export class MfaPasswordDto {
  @IsString() @MinLength(1) @MaxLength(128)
  password: string;
}

export class MfaCodeDto {
  @Matches(/^\d{6}$/, { message: '6자리 인증 코드를 입력하세요.' })
  code: string;
}

export class MfaVerifyDto {
  @IsOptional() @Matches(/^\d{6}$/, { message: '6자리 인증 코드를 입력하세요.' })
  code?: string;

  @IsOptional() @IsString() @MaxLength(40)
  recoveryCode?: string;
}

export class MfaSensitiveDto {
  @IsString() @MinLength(1) @MaxLength(128)
  password: string;

  @Matches(/^\d{6}$/, { message: '6자리 인증 코드를 입력하세요.' })
  code: string;
}
