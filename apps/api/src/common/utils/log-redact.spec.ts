import { redactUrl } from './log-redact';

describe('redactUrl', () => {
  it('masks sensitive query params only', () => {
    expect(redactUrl('/api/v1/auth/invitation?token=abc123')).toBe('/api/v1/auth/invitation?token=[REDACTED]');
    expect(redactUrl('/x?page=2&password=pw&q=hi')).toBe('/x?page=2&password=[REDACTED]&q=hi');
    expect(redactUrl('/x?Recovery_Code=1&API-KEY=2')).toBe('/x?Recovery_Code=[REDACTED]&API-KEY=[REDACTED]');
    expect(redactUrl('/plain')).toBe('/plain');
  });
});
