/**
 * Tokenizer for the rule-based parsers. Regexes here are deliberately simple
 * (character classes and anchors only) so they port to any regex dialect;
 * everything above this layer is table-driven token matching (docs/porting.md).
 */

export type Token =
  | { type: 'word'; value: string; start: number; end: number }
  | { type: 'number'; value: number; ordinal: boolean; start: number; end: number }
  | { type: 'clock'; hour: number; minute: number; explicitMinute: boolean; second?: number; meridiem?: 'am' | 'pm'; start: number; end: number }
  | { type: 'numdate'; parts: number[]; sep: string; start: number; end: number };

const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(am|pm)?$/;
const HOUR_MERIDIEM_RE = /^(\d{1,2})(am|pm)$/;
const ORDINAL_RE = /^(\d{1,2})(st|nd|rd|th)$/;
const NUMDATE_RE = /^(\d{1,4})([/\-.])(\d{1,2})(?:\2(\d{1,4}))?$/;
const NUMBER_RE = /^\d{1,4}$/;
const RAW_TOKEN_RE = /[a-z0-9:/\-.'~]+/gi;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(RAW_TOKEN_RE)) {
    let raw = m[0]
      .toLowerCase()
      .replace(/[.]+$/, '')
      .replace(/[''`]s$/, '') // "fortnight's" → fortnight
      .replace(/^a\.m$/, 'am')
      .replace(/^p\.m$/, 'pm');
    if (raw === '') continue;
    const start = m.index;
    const end = start + m[0].length;

    let match = raw.match(CLOCK_RE);
    if (match) {
      const token: Token = {
        type: 'clock',
        hour: Number(match[1]),
        minute: Number(match[2]),
        explicitMinute: true,
        start,
        end,
      };
      if (match[3] !== undefined) token.second = Number(match[3]);
      if (match[4]) token.meridiem = match[4] as 'am' | 'pm';
      tokens.push(token);
      continue;
    }
    match = raw.match(HOUR_MERIDIEM_RE);
    if (match) {
      tokens.push({
        type: 'clock',
        hour: Number(match[1]),
        minute: 0,
        explicitMinute: false,
        meridiem: match[2] as 'am' | 'pm',
        start,
        end,
      });
      continue;
    }
    match = raw.match(ORDINAL_RE);
    if (match) {
      tokens.push({ type: 'number', value: Number(match[1]), ordinal: true, start, end });
      continue;
    }
    match = raw.match(NUMDATE_RE);
    if (match && match[4] !== undefined) {
      tokens.push({
        type: 'numdate',
        parts: [Number(match[1]), Number(match[3]), Number(match[4])],
        sep: match[2]!,
        start,
        end,
      });
      continue;
    }
    if (match) {
      // Two-part numeric date like 5/29 (only with slash — 5-29 is too odd).
      if (match[2] === '/') {
        tokens.push({
          type: 'numdate',
          parts: [Number(match[1]), Number(match[3])],
          sep: '/',
          start,
          end,
        });
        continue;
      }
    }
    if (NUMBER_RE.test(raw)) {
      tokens.push({ type: 'number', value: Number(raw), ordinal: false, start, end });
      continue;
    }
    tokens.push({ type: 'word', value: raw, start, end });
  }
  return tokens;
}
