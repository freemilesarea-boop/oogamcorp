import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
