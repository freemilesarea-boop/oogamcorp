import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from './permissions';

describe('default role permissions', () => {
  it('OWNER and EXECUTIVE are not identical', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.OWNER.length).toBe(PERMISSION_KEYS.length);
    expect(DEFAULT_ROLE_PERMISSIONS.EXECUTIVE).not.toContain('permissions.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.EXECUTIVE).not.toContain('hr.sensitive.read');
  });
  it('employees and managers cannot read finance by default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.EMPLOYEE).not.toContain('finance.read');
    expect(DEFAULT_ROLE_PERMISSIONS.MANAGER).not.toContain('finance.read');
  });
  it('only references defined permission keys', () => {
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) expect(PERMISSION_KEYS).toContain(p);
    }
  });
});
