/**
 * 업로드 허용 정책: MIME 타입 허용 목록 + 확장자 일치 검사 + 파일명 정규화.
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

/** 브라우저에서 inline 으로 표시해도 안전한 형식 (SVG/HTML 은 허용 목록에 없음) */
export const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 표시용 원본 파일명 정규화: 경로 구분자·제어문자 제거, 길이 제한.
 * (스토리지 키에는 파일명을 사용하지 않으므로 경로 조작 위험은 없지만 응답 헤더/표시를 위해 정리)
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/^\.+/, '').trim();
  if (!name) name = 'file';
  if (name.length > 200) {
    const ext = extensionOf(name);
    name = name.slice(0, 190) + (ext ? `.${ext}` : '');
  }
  return name.normalize('NFC');
}

export function isAllowed(mimeType: string, fileName: string): boolean {
  const exts = ALLOWED_TYPES[mimeType];
  if (!exts) return false;
  return exts.includes(extensionOf(fileName));
}

/** 매직 바이트 검사 (대표 형식만): 확장자/헤더 위장 업로드 차단 */
export function magicMatches(mimeType: string, buf: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  switch (mimeType) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/gif':
      return starts(0x47, 0x49, 0x46, 0x38);
    case 'image/webp':
      return starts(0x52, 0x49, 0x46, 0x46) && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46);
    case 'application/zip':
    case 'application/x-zip-compressed':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/vnd.hancom.hwpx':
      return starts(0x50, 0x4b);
    default:
      return true;
  }
}

/** RFC 5987/6266 Content-Disposition (한글 파일명 지원) */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
