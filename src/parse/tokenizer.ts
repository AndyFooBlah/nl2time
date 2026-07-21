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

const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(am|pm|a|p)?$/;
const HOUR_MERIDIEM_RE = /^(\d{1,2})(am|pm|a|p)$/;
const ORDINAL_RE = /^(\d{1,2})(st|nd|rd|th)$/;
const NUMDATE_RE = /^(\d{1,4})([/\-.])(\d{1,2})(?:\2(\d{1,4}))?$/;
const NUMBER_RE = /^\d{1,4}$/;
const RAW_TOKEN_RE = /[a-z0-9:/\-.'~\u00bc\u00bd\u00be]+/gi;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(RAW_TOKEN_RE)) {
    const raw = m[0]
      .toLowerCase()
      .replace(/^-(?=\d)/, '') // "(Tue)-11:30" → clock token after paren split
      .replace(/[.]+$/, '')
      .replace(/[''`]s$/, '') // "fortnight's" → fortnight
      .replace(/['']+$/, '') // "workers'" → workers
      .replace(/^a\.m$/, 'am')
      .replace(/^p\.m$/, 'pm')
      .replace(/^(\d{1,2}(?::\d{2})?)\.(am|pm|a|p)$/, '$1$2'); // "9.am" → 9am
    if (raw === '') continue;
    const start = m.index;
    const end = start + m[0].length;

    // Split dash-joined mixed tokens ("18-dec", "nov-feb", "friday-jun-15")
    // into parts with explicit "-" connectors so the range machinery sees
    // them. Pure-numeric joins (11-4, 2014-2018) and "mid-…" stay intact.
    if (raw.includes('-') && !raw.startsWith('mid')) {
      const segments = raw.split('-');
      // Word-ish segments include month/year compounds ("dec/2018"); pure
      // digit-with-suffix segments like "4.30pm" must NOT count, so joined
      // time ranges stay intact.
      const alpha = segments.filter((s) => /^[a-z']{2,}(\/\d{1,4})?$/.test(s)).length;
      const numeric = segments.filter((s) => /^[\d.:]+$/.test(s)).length;
      const splittable =
        segments.length >= 2 &&
        segments.every((s) => s.length > 0) &&
        alpha + numeric === segments.length &&
        alpha > 0;
      if (splittable) {
        for (const [si, seg] of segments.entries()) {
          if (si > 0) tokens.push({ type: 'word', value: '-', start, end });
          pushToken(tokens, seg, start, end);
        }
        continue;
      }
    }
    pushToken(tokens, raw, start, end);
  }
  return tokens;
}

function pushToken(tokens: Token[], raw: string, start: number, end: number): void {
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
    if (match[4]) token.meridiem = match[4].startsWith('a') ? 'am' : 'pm';
    tokens.push(token);
    return;
  }
  match = raw.match(HOUR_MERIDIEM_RE);
  if (match) {
    tokens.push({
      type: 'clock',
      hour: Number(match[1]),
      minute: 0,
      explicitMinute: false,
      meridiem: match[2]!.startsWith('a') ? 'am' : 'pm',
      start,
      end,
    });
    return;
  }
  match = raw.match(ORDINAL_RE);
  if (match) {
    tokens.push({ type: 'number', value: Number(match[1]), ordinal: true, start, end });
    return;
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
    return;
  }
  if (match && match[2] === '/') {
    // Two-part numeric date like 5/29 (only with slash — 5-29 is too odd).
    tokens.push({
      type: 'numdate',
      parts: [Number(match[1]), Number(match[3])],
      sep: '/',
      start,
      end,
    });
    return;
  }
  if (NUMBER_RE.test(raw)) {
    tokens.push({ type: 'number', value: Number(raw), ordinal: false, start, end });
    return;
  }
  tokens.push({ type: 'word', value: raw, start, end });
}
