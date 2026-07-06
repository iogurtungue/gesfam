/**
 * Bank export files are sometimes UTF-8, sometimes Windows-1252 (Norma 43 text
 * files in particular). Try strict UTF-8 first; if the bytes aren't valid
 * UTF-8, fall back to Windows-1252 rather than silently mangling accents.
 */
export function decodeBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}
