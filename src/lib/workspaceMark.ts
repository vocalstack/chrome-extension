/** The Dashboard's own functions for a workspace's mark, copied as they
 *  are (transcribe: app/src/lib/workspaceMark.ts): the same initials and
 *  the same colour for the same workspace everywhere. */

export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const first = (w: string) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '';
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]!.replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase() || '?';
  return (first(words[0]!) + first(words[1]!)).toUpperCase();
}

const HUES = [252, 200, 160, 128, 85, 40, 12, 330, 296];

export function workspaceHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return HUES[(h >>> 0) % HUES.length]!;
}
