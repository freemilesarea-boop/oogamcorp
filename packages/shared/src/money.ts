/**
 * 금액 유틸리티. 부동소수점 오차 방지를 위해 금액은 문자열(Decimal 직렬화) 또는
 * 최소 단위(전/원 * 100) BigInt 로 다룬다. DB 는 DECIMAL(18,2) 을 사용한다.
 */
const SCALE = 100n;

/** "1234.5" -> 123450n (센트 단위). 소수 셋째 자리 이상은 허용하지 않는다. */
export function toMinor(amount: string | number | bigint): bigint {
  if (typeof amount === 'bigint') return amount * SCALE;
  const s = typeof amount === 'number' ? amountNumberToString(amount) : amount.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`유효하지 않은 금액: ${amount}`);
  const neg = s.startsWith('-');
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(intPart) * SCALE + BigInt((frac + '00').slice(0, 2));
  return neg ? -v : v;
}

function amountNumberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error('유효하지 않은 금액');
  return n.toFixed(2);
}

/** 123450n -> "1234.50" */
export function fromMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const int = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int.toString()}.${frac}`;
}

export function addAmounts(...amounts: (string | number)[]): string {
  return fromMinor(amounts.reduce<bigint>((acc, a) => acc + toMinor(a), 0n));
}

export function subtractAmounts(a: string | number, b: string | number): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** 부가세 계산 (공급가액 * rate%), 원 단위 미만 절사(반올림 아님) — 한국 관행에 맞춰 원 단위로 절사 */
export function calcVat(supplyAmount: string | number, ratePercent = 10): string {
  const minor = toMinor(supplyAmount);
  const vat = (minor * BigInt(Math.round(ratePercent * 100))) / 10000n;
  // 원 단위 절사
  const truncated = (vat / SCALE) * SCALE;
  return fromMinor(truncated);
}

/** 비율(%) 계산, 소수 첫째 자리까지. 분모 0 이면 0 */
export function percentOf(part: string | number, whole: string | number): number {
  const w = toMinor(whole);
  if (w === 0n) return 0;
  const p = toMinor(part);
  return Number((p * 1000n) / w) / 10;
}

export function formatKRW(amount: string | number): string {
  const minor = toMinor(amount);
  const won = minor / SCALE;
  return `₩${won.toLocaleString('ko-KR')}`;
}

export function compareAmounts(a: string | number, b: string | number): -1 | 0 | 1 {
  const x = toMinor(a);
  const y = toMinor(b);
  return x === y ? 0 : x > y ? 1 : -1;
}
