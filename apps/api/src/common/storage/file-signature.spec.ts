import { detectFileType, DETECTED_MIME as M, OCTET } from './file-signature';
import { containsEicar, EICAR_TEST_SIGNATURE, parseClamdReply } from './malware-scanner';

const b = (...parts: (number[] | string | Buffer)[]) =>
  Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = 'PK\x03\x04';
const u16 = (s: string) => Buffer.from(s, 'utf16le');

describe('detectFileType', () => {
  it.each([
    ['png', b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), M.png],
    ['jpeg', b([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), M.jpeg],
    ['gif87a', b('GIF87a\x01\x00'), M.gif],
    ['gif89a', b('GIF89a\x01\x00'), M.gif],
    ['webp', b('RIFF\x10\x00\x00\x00WEBPVP8 '), M.webp],
    ['avif', b([0, 0, 0, 0x20], 'ftypavif'), M.avif],
    ['pdf', b('%PDF-1.7\n%\xe2\xe3\n'), M.pdf],
    ['docx', b(ZIP, '....[Content_Types].xml....word/document.xml'), M.docx],
    ['xlsx', b(ZIP, '[Content_Types].xml xl/workbook.xml'), M.xlsx],
    ['pptx', b(ZIP, '[Content_Types].xml ppt/presentation.xml'), M.pptx],
    ['hwpx', b(ZIP, 'mimetypeapplication/hwp+zip'), M.hwpx],
    ['plain zip', b(ZIP, 'readme.txt'), M.zip],
    ['empty zip', b('PK\x05\x06', Buffer.alloc(18)), M.zip],
    ['doc', b(OLE, Buffer.alloc(100), u16('WordDocument')), M.doc],
    ['xls', b(OLE, Buffer.alloc(100), u16('Workbook')), M.xls],
    ['ppt', b(OLE, Buffer.alloc(100), u16('PowerPoint Document')), M.ppt],
    ['hwp', b(OLE, u16('FileHeader'), u16('BodyText')), M.hwp],
    ['unknown OLE (e.g. msi)', b(OLE, Buffer.alloc(100)), M.ole],
    ['utf-8 text', Buffer.from('안녕하세요\nhello,world\r\n\t탭', 'utf8'), M.text],
    ['utf-8 BOM csv', Buffer.from('\uFEFF이름,금액\n홍길동,1000\n', 'utf8'), M.text],
    ['utf-16le BOM', b([0xff, 0xfe], u16('이름,금액')), M.text],
    ['cp949 csv', b('name,', [0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf], '\n'), M.text],
  ])('detects %s', (_n, buf, mime) => {
    const r = detectFileType(buf);
    expect(r.mime).toBe(mime);
    expect(r.dangerous).toBe(false);
  });

  it.each([
    ['PE/MZ', b('MZ\x90\x00\x03'), M.pe],
    ['ELF', b([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), M.elf],
    ['Mach-O 64', b([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]), M.macho],
    ['Mach-O 32 BE', b([0xfe, 0xed, 0xfa, 0xce]), M.macho],
    ['fat/class', b([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]), M.macho],
    ['shebang', b('#!/bin/sh\nrm -rf /\n'), M.script],
    ['BOM + shebang', Buffer.from('\uFEFF#!/usr/bin/env python\n', 'utf8'), M.script],
    ['html doctype', b('  <!DOCTYPE html><html></html>'), M.html],
    ['html script', b('<script>alert(1)</script>'), M.html],
    ['svg', b('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), M.svg],
    ['xml+svg', b('<?xml version="1.0"?>\n<svg></svg>'), M.svg],
    ['xml', b('<?xml version="1.0"?><root/>'), M.xml],
    ['jar', b(ZIP, 'META-INF/MANIFEST.MF'), M.jar],
    ['apk', b(ZIP, 'AndroidManifest.xml classes.dex'), M.apk],
  ])('flags %s as dangerous', (_n, buf, mime) => {
    const r = detectFileType(buf);
    expect(r.mime).toBe(mime);
    expect(r.dangerous).toBe(true);
  });

  it('treats binary garbage / NUL bytes / bad control chars as unknown', () => {
    expect(detectFileType(b('hello\x00world')).mime).toBe(OCTET);
    expect(detectFileType(b('abc\x01\x02')).mime).toBe(OCTET);
    expect(detectFileType(b([0x80, 0x20, 0xff])).mime).toBe(OCTET); // UTF-8/CP949 둘 다 아님
    expect(detectFileType(Buffer.alloc(0)).mime).toBe(OCTET);
  });

  it('does not mistake a text file mentioning <script> later on for HTML', () => {
    expect(detectFileType(Buffer.from('# 메모\n\n```html\n<script></script>\n```\n', 'utf8')).mime).toBe(M.text);
  });
});

describe('malware helpers', () => {
  it('detects the EICAR test signature anywhere in the buffer', () => {
    expect(EICAR_TEST_SIGNATURE).toHaveLength(68);
    expect(containsEicar(Buffer.from(`prefix ${EICAR_TEST_SIGNATURE} suffix`))).toBe(true);
    expect(containsEicar(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))).toBe(false);
  });

  it('parses clamd replies', () => {
    expect(parseClamdReply('stream: OK')).toMatchObject({ status: 'CLEAN' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND')).toMatchObject({ status: 'INFECTED', signature: 'Win.Test.EICAR_HDB-1' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR')).toMatchObject({ status: 'ERROR' });
    expect(parseClamdReply('')).toMatchObject({ status: 'ERROR' });
  });
});
