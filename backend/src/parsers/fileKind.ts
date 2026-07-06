import { decodeBuffer } from '../lib/encoding';

export type FileKind = 'norma43' | 'excel' | 'html' | 'unknown';

/**
 * Bank exports arrive in wildly different container formats regardless of
 * file extension (OpenBank's ".xls" is actually an HTML table; BBVA's is a
 * real xlsx-in-disguise). Sniff the actual bytes rather than trusting the
 * extension.
 */
export function detectFileKind(buffer: ArrayBuffer): FileKind {
  const bytes = new Uint8Array(buffer.slice(0, 8));

  // xlsx/zip signature "PK\x03\x04"
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'excel';
  }
  // Old binary OLE xls signature
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'excel';
  }

  const text = decodeBuffer(buffer);
  const sample = text.slice(0, 4000);
  if (/<html[\s>]/i.test(sample) || /<!DOCTYPE\s+html/i.test(sample)) {
    return 'html';
  }

  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  if (/^11\d{8}/.test(firstLine) && firstLine.length >= 79 && firstLine.length <= 81) {
    return 'norma43';
  }

  return 'unknown';
}
