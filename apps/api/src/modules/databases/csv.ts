/**
 * CSV 직렬화 (RFC 4180) + 수식 주입(CSV/Formula Injection) 방어.
 * 스프레드시트가 수식으로 해석할 수 있는 선행 문자(= + - @ \t \r)로 시작하는 셀은 ' 를 붙인다.
 * 숫자 속성의 순수 숫자 값(예: -5, 3.14)은 수식이 될 수 없으므로 그대로 둔다.
 */
const DANGEROUS = /^[=+\-@\t\r]/;
const PURE_NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

export function protectCell(value: string, numeric = false): string {
  if (numeric && PURE_NUMBER.test(value)) return value;
  return DANGEROUS.test(value) ? `'${value}` : value;
}

export function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsvLine(cells: string[]): string {
  return cells.map(escapeCsv).join(',');
}

/** 가져오기 시 내보내기에서 붙인 보호용 ' 제거 */
export function unprotectCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
