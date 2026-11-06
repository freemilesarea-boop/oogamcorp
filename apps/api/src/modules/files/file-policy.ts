/**
 * 업로드 허용 정책: MIME 타입 허용 목록 + 확장자 일치 검사 + 위험 확장자 차단 + 파일명 정규화.
 * 실제 내용(매직 바이트) 판별은 common/storage/file-signature.ts 에서 수행한다.
 */
export const ALLOWED_TYPES: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/x-hwp': ['hwp'],
  'application/haansofthwp': ['hwp'],
  'application/vnd.hancom.hwpx': ['hwpx'],
  'text/plain': ['txt', 'md', 'log'],
  'text/markdown': ['md'],
  'text/csv': ['csv'],
  'application/csv': ['csv'],
  'application/zip': ['zip'],
  'application/x-zip-compressed': ['zip'],
};

/**
 * 브라우저에서 inline 으로 표시해도 안전한 형식 (판별된 실제 형식 기준).
 * SVG/HTML 은 허용 목록에 없고, 그 외 형식은 모두 attachment 로 내려준다.
 */
export const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

/** 이름 어디에 있어도 업로드를 거부하는 확장자 (이중 확장자 위장 포함) */
export const DANGEROUS_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'js', 'mjs', 'cjs', 'jsx', 'vbs', 'vbe', 'wsf', 'wsh', 'hta',
  'php', 'phtml', 'php3', 'php4', 'php5', 'phar', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'rb',
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psm1', 'com', 'scr', 'pif', 'cpl', 'lnk', 'reg', 'inf',
  'exe', 'dll', 'sys', 'msi', 'msp', 'jar', 'class', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'iso', 'img', 'elf', 'so', 'dylib', 'bin', 'run',
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm',
]);

/** 제어문자(C0/C1) 및 양방향 텍스트 조작 문자 (RLO 를 이용한 확장자 위장 등) */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function hasControlChars(raw: string): boolean {
  CONTROL_OR_BIDI.lastIndex = 0;
  return CONTROL_OR_BIDI.test(raw);
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 이름에 포함된 모든 확장자 조각 (예: invoice.pdf.exe → ['pdf', 'exe']) */
export function allExtensions(name: string): string[] {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts.slice(1).map((p) => p.trim()).filter(Boolean) : [];
}

export function hasDangerousExtension(name: string): boolean {
  return allExtensions(name).some((e) => DANGEROUS_EXTENSIONS.has(e));
}

/**
 * 표시용 원본 파일명 정규화: NFC 정규화, 경로 구분자·제어문자 제거, 앞뒤 점/공백 제거, 200자 제한.
 * (스토리지 키에는 파일명을 사용하지 않으므로 경로 조작 위험은 없지만 응답 헤더/표시를 위해 정리)
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  let name = base.replace(CONTROL_OR_BIDI, '').replace(/["<>|:*?]/g, '').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '').trim();
  if (!name) name = 'file';
  if (name.length > 200) {
    const ext = extensionOf(name);
    name = name.slice(0, 190) + (ext && ext.length <= 9 ? `.${ext}` : '');
  }
  return name;
}

export function isAllowed(mimeType: string, fileName: string): boolean {
  const exts = ALLOWED_TYPES[mimeType];
  if (!exts) return false;
  return exts.includes(extensionOf(fileName));
}

/**
 * 선언된 형식(MIME)별로 허용되는 실제(판별) 형식.
 * 목록에 없으면 판별 결과가 선언과 정확히 같아야 한다.
 */
const ZIP_FAMILY = [
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.hancom.hwpx',
];
const COMPATIBLE_DETECTED: Record<string, string[]> = {
  'application/zip': ZIP_FAMILY,
  'application/x-zip-compressed': ZIP_FAMILY,
  'application/haansofthwp': ['application/x-hwp'],
  'text/markdown': ['text/plain'],
  'text/csv': ['text/plain'],
  'application/csv': ['text/plain'],
};

/** 선언 형식과 판별 형식이 일치하는지 */
export function detectedMatchesDeclared(declaredMime: string, detectedMime: string): boolean {
  return (COMPATIBLE_DETECTED[declaredMime] ?? [declaredMime]).includes(detectedMime);
}

/** 저장할 실제 형식: 텍스트는 확장자로 세분화 (csv/md), ZIP 컨테이너는 선언이 zip 이면 zip 으로 저장 */
export function canonicalDetectedMime(detectedMime: string, declaredMime: string, fileName: string): string {
  if (detectedMime === 'text/plain') {
    const ext = extensionOf(fileName);
    if (ext === 'csv') return 'text/csv';
    if (ext === 'md') return 'text/markdown';
    return 'text/plain';
  }
  if (ZIP_FAMILY.includes(detectedMime) && (declaredMime === 'application/zip' || declaredMime === 'application/x-zip-compressed')) {
    return 'application/zip';
  }
  return detectedMime;
}

/** RFC 5987/6266 Content-Disposition (한글 파일명 지원) */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
