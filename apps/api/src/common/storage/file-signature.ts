/**
 * 의존성 없는 파일 형식 판별기 (매직 바이트 기반).
 * 클라이언트가 보낸 Content-Type / 확장자는 신뢰하지 않고 실제 내용으로 형식을 판별한다.
 */

export interface DetectedType {
  /** 판별된 MIME (알 수 없으면 application/octet-stream) */
  mime: string;
  /** 실행 파일·스크립트·마크업 등 업로드를 절대 허용하지 않는 형식 */
  dangerous: boolean;
  /** 사람이 읽을 수 있는 설명 (로그/오류용) */
  label: string;
}

export const OCTET = 'application/octet-stream';

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwpx: 'application/vnd.hancom.hwpx',
  ole: 'application/x-ole-storage',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  hwp: 'application/x-hwp',
  text: 'text/plain',
  pe: 'application/x-msdownload',
  elf: 'application/x-executable',
  macho: 'application/x-mach-binary',
  javaClass: 'application/java-vm',
  jar: 'application/java-archive',
  apk: 'application/vnd.android.package-archive',
  script: 'text/x-shellscript',
  html: 'text/html',
  svg: 'image/svg+xml',
  xml: 'application/xml',
} as const;

export const DETECTED_MIME = MIME;

const safe = (mime: string, label: string): DetectedType => ({ mime, dangerous: false, label });
const danger = (mime: string, label: string): DetectedType => ({ mime, dangerous: true, label });

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

/** OLE(CFB) 디렉터리 엔트리 이름은 UTF-16LE 로 저장된다 */
function hasUtf16(buf: Buffer, s: string): boolean {
  return buf.includes(Buffer.from(s, 'utf16le'));
}

function detectZip(buf: Buffer): DetectedType {
  // ZIP 의 로컬 헤더/중앙 디렉터리 파일명은 압축되지 않으므로 바이트 검색으로 구성 확인 가능
  const has = (s: string) => buf.includes(Buffer.from(s, 'latin1'));
  if (has('AndroidManifest.xml') || has('classes.dex')) return danger(MIME.apk, 'Android 패키지(APK)');
  if (has('META-INF/MANIFEST.MF')) return danger(MIME.jar, 'Java 아카이브(JAR)');
  if (has('[Content_Types].xml')) {
    if (has('word/')) return safe(MIME.docx, 'Word 문서(docx)');
    if (has('xl/')) return safe(MIME.xlsx, 'Excel 문서(xlsx)');
    if (has('ppt/')) return safe(MIME.pptx, 'PowerPoint 문서(pptx)');
  }
  if (has('mimetype') && has('application/hwp+zip')) return safe(MIME.hwpx, '한글 문서(hwpx)');
  return safe(MIME.zip, 'ZIP 압축 파일');
}

function detectOle(buf: Buffer): DetectedType {
  if (hasUtf16(buf, 'WordDocument')) return safe(MIME.doc, 'Word 문서(doc)');
  if (hasUtf16(buf, 'Workbook') || hasUtf16(buf, 'Book')) return safe(MIME.xls, 'Excel 문서(xls)');
  if (hasUtf16(buf, 'PowerPoint Document')) return safe(MIME.ppt, 'PowerPoint 문서(ppt)');
  if (hasUtf16(buf, 'FileHeader') && hasUtf16(buf, 'BodyText')) return safe(MIME.hwp, '한글 문서(hwp)');
  // MSI 등 기타 복합 문서 — 허용 형식으로 인정하지 않는다
  return safe(MIME.ole, 'OLE 복합 문서');
}

/** 앞부분이 HTML/SVG/XML 마크업으로 시작하는지 (브라우저가 렌더링할 수 있는 형식) */
function detectMarkup(text: string): DetectedType | null {
  const head = text.replace(/^\uFEFF/, '').trimStart().slice(0, 512).toLowerCase();
  if (/^<svg[\s>]/.test(head) || (head.startsWith('<?xml') && head.includes('<svg'))) return danger(MIME.svg, 'SVG 이미지');
  if (/^<!doctype\s+html/.test(head) || /^<(html|head|body|script|iframe|object|embed)[\s>]/.test(head)) return danger(MIME.html, 'HTML 문서');
  if (head.startsWith('<?xml')) return danger(MIME.xml, 'XML 문서');
  return null;
}

/** CP949/EUC-KR 바이트 구조 검사 (엑셀 등에서 내보낸 한글 CSV 대응) */
function isCp949(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    if (b < 0x81 || b > 0xfe) return false;
    const t = buf[i + 1];
    if (t === undefined) return false;
    const trailOk = (t >= 0x41 && t <= 0x5a) || (t >= 0x61 && t <= 0x7a) || (t >= 0x81 && t <= 0xfe);
    if (!trailOk) return false;
    i += 1;
  }
  return true;
}

/** 텍스트에 허용하지 않는 C0 제어문자 (탭/개행/CR/FF/VT/ESC 제외) */
function hasBadControlChars(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c && b !== 0x0b && b !== 0x1b) return true;
  }
  return false;
}

function detectText(buf: Buffer): DetectedType | null {
  // UTF-16 (BOM 필수)
  if (startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff])) {
    if (buf.length % 2 !== 0) return null;
    const le = buf[0] === 0xff;
    const body = buf.subarray(2);
    const swapped = le ? body : Buffer.from(body).swap16();
    const text = swapped.toString('utf16le');
    if (text.includes('\u0000')) return null;
    return detectMarkup(text) ?? safe(MIME.text, '텍스트(UTF-16)');
  }
  if (buf.includes(0)) return null;
  if (hasBadControlChars(buf)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    if (!isCp949(buf)) return null;
    text = buf.toString('latin1');
  }
  if (text.replace(/^\uFEFF/, '').startsWith('#!')) return danger(MIME.script, '실행 스크립트(shebang)');
  return detectMarkup(text) ?? safe(MIME.text, '텍스트');
}

/** 버퍼 내용으로 실제 형식을 판별한다 */
export function detectFileType(buf: Buffer): DetectedType {
  if (!buf || buf.length === 0) return safe(OCTET, '빈 파일');

  // 실행 파일
  if (startsWith(buf, [0x4d, 0x5a])) return danger(MIME.pe, 'Windows 실행 파일(MZ/PE)');
  if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return danger(MIME.elf, 'ELF 실행 파일');
  for (const sig of [[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]]) {
    if (startsWith(buf, sig)) return danger(MIME.macho, 'Mach-O 실행 파일');
  }
  // 0xCAFEBABE: Mach-O fat binary 또는 Java class — 둘 다 차단
  if (startsWith(buf, [0xca, 0xfe, 0xba, 0xbe])) return danger(MIME.macho, 'Mach-O fat / Java class');
  if (startsWith(buf, [0x23, 0x21])) return danger(MIME.script, '실행 스크립트(shebang)');

  // 이미지
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return safe(MIME.png, 'PNG 이미지');
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return safe(MIME.jpeg, 'JPEG 이미지');
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return safe(MIME.gif, 'GIF 이미지');
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return safe(MIME.webp, 'WebP 이미지');
  if (ascii(buf, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(buf, 8, 12))) return safe(MIME.avif, 'AVIF 이미지');

  // 문서
  if (ascii(buf, 0, 5) === '%PDF-') return safe(MIME.pdf, 'PDF 문서');
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) return detectZip(buf);
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return detectOle(buf);

  return detectText(buf) ?? safe(OCTET, '알 수 없는 바이너리');
}

/** 텍스트 계열 MIME 여부 */
export function isTextMime(mime: string): boolean {
  return mime === MIME.text;
}
