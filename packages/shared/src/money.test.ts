import { describe, expect, it } from 'vitest';
import { addAmounts, calcVat, fromMinor, percentOf, subtractAmounts, toMinor } from './money';

describe('money', () => {
  it('avoids floating point errors', () => {
    expect(addAmounts('0.1', '0.2')).toBe('0.30');
    expect(addAmounts(1000000000.01, '2.99')).toBe('1000000003.00');
  });
  it('round trips minor units', () => {
    expect(toMinor('1,234.5')).toBe(123450n);
    expect(fromMinor(-5n)).toBe('-0.05');
  });
  it('rejects invalid amounts', () => {
    expect(() => toMinor('1.234')).toThrow();
    expect(() => toMinor('abc')).toThrow();
  });
  it('calculates VAT truncated to won', () => {
    expect(calcVat('10000')).toBe('1000.00');
    expect(calcVat('12345')).toBe('1234.00');
  });
  it('subtracts and computes percent', () => {
    expect(subtractAmounts('100', '33.33')).toBe('66.67');
    expect(percentOf('250', '1000')).toBe(25);
    expect(percentOf('1', '0')).toBe(0);
  });
});
