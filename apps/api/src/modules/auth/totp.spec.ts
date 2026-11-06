import { base32Decode, base32Encode, totpAt, verifyTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B 테스트 벡터 (SHA1, 비밀키 "12345678901234567890")
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('time %i → %s', (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code);
  });
  it('base32 round trip', () => {
    const b = Buffer.from('hello world!');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it('accepts ±1 step and rejects replay', () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30000);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, { now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), { now })).toBeNull();
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now })).toBeNull();
  });
});
