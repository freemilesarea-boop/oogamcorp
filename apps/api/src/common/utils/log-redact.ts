/** 로그에 남는 URL 에서 민감한 쿼리 파라미터 값을 마스킹 (초대 토큰, 비밀번호 등) */
const SENSITIVE = /^(token|password|pass|pwd|code|secret|key|api[_-]?key|access[_-]?token|refresh[_-]?token|recovery[_-]?code|otp)$/i;

export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = url.slice(q + 1).split('&').map((pair) => {
    const [k, ...rest] = pair.split('=');
    let name = k;
    try {
      name = decodeURIComponent(k);
    } catch {
      /* keep raw */
    }
    return rest.length && SENSITIVE.test(name) ? `${k}=[REDACTED]` : pair;
  });
  return `${url.slice(0, q)}?${params.join('&')}`;
}
