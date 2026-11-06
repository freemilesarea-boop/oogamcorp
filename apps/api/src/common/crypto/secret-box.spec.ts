import { open, seal } from './secret-box';

describe('secret-box', () => {
  it('round-trips and does not expose plaintext', () => {
    const s = seal('invite-token-abc', 'invite');
    expect(s).not.toContain('invite-token-abc');
    expect(open(s, 'invite')).toBe('invite-token-abc');
  });
  it('rejects tampering and wrong AAD', () => {
    const s = seal('secret', 'a');
    expect(() => open(s, 'b')).toThrow();
    const parts = s.split('.');
    parts[3] = Buffer.from('xx').toString('base64url');
    expect(() => open(parts.join('.'), 'a')).toThrow();
  });
});
