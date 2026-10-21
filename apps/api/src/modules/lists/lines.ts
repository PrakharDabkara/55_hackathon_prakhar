import { LIST_LINE_MAX_CHARS, LIST_MAX_LINES } from '@askbuy/shared';

export type CleanLines =
  | { ok: true; lines: string[] }
  | { ok: false; code: 'no_lines' | 'too_many_lines' | 'line_too_long' };

/**
 * The lines of a typed list (ADR-0055 rule 2): each trimmed with inner spaces collapsed, empty
 * ones dropped, duplicates merged (the same words in any case; the first spelling stays, in order).
 * A line over LIST_LINE_MAX_CHARS, more than LIST_MAX_LINES distinct lines, or none at all is
 * refused: a line is never cut.
 */
export function cleanLines(raw: readonly string[]): CleanLines {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of raw) {
    const line = entry.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    if ([...line].length > LIST_LINE_MAX_CHARS) return { ok: false, code: 'line_too_long' };
    const key = line.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  if (lines.length === 0) return { ok: false, code: 'no_lines' };
  if (lines.length > LIST_MAX_LINES) return { ok: false, code: 'too_many_lines' };
  return { ok: true, lines };
}
