/**
 * Recognition: text → TimeExpr matches. Pure with respect to the reference
 * instant — parsing uses ctx.locale/dateOrder only; ctx.now matters at
 * resolve() time. (Recognition/resolution separation, docs/design.md §4.)
 */
import type { TimeContext } from '../context.js';
import type { TimeExpr } from '../ir/types.js';
import { EN_RULES, type RuleMatch } from './en.js';
import { tokenize, type Token } from './tokenizer.js';

export interface ParseMatch {
  /** The matched source text span. */
  text: string;
  start: number;
  end: number;
  expr: TimeExpr;
  confidence: number;
  source: 'rules' | 'llm';
}

export interface ParseResult {
  matches: ParseMatch[];
}

interface Positioned extends RuleMatch {
  tokenStart: number;
  tokenEnd: number; // exclusive
}

const CONNECTORS = ['at', 'on', 'in', 'of', 'the', 'for', 'from', 'around', 'about', '-'];

export function parse(text: string, ctx: TimeContext): ParseResult {
  const tokens = tokenize(text);
  const raw: Positioned[] = [];

  let i = 0;
  while (i < tokens.length) {
    let best: Positioned | undefined;
    for (const rule of EN_RULES) {
      const m = rule(tokens, i, ctx);
      if (!m) continue;
      if (!best || m.consumed > best.consumed || (m.consumed === best.consumed && m.confidence > best.confidence)) {
        best = { ...m, tokenStart: i, tokenEnd: i + m.consumed };
      }
    }
    if (best) {
      raw.push(best);
      i = best.tokenEnd;
    } else {
      i += 1;
    }
  }

  // Merge to fixpoint: [date, duration, time] needs two passes.
  let merged = mergeAdjacent(raw, tokens);
  for (let pass = 0; pass < 2; pass += 1) {
    const again = mergeAdjacent(merged, tokens);
    if (again.length === merged.length) break;
    merged = again;
  }
  const matches: ParseMatch[] = merged
    .filter((m) => m.confidence >= 0.5)
    .map((m) => {
      const startTok = tokens[m.tokenStart]!;
      const endTok = tokens[m.tokenEnd - 1]!;
      return {
        text: text.slice(startTok.start, endTok.end),
        start: startTok.start,
        end: endTok.end,
        expr: m.expr,
        confidence: m.confidence,
        source: 'rules' as const,
      };
    });
  return { matches };
}

/**
 * Refiner: merge a date-ish match with an adjacent time-ish match (optionally
 * separated by a connector token) into intersect(date, time) — "yesterday at
 * 9pm", "next Tuesday morning", "May 29 at noon".
 */
function mergeAdjacent(matches: Positioned[], tokens: Token[]): Positioned[] {
  const out: Positioned[] = [];
  let k = 0;
  while (k < matches.length) {
    const cur = matches[k]!;
    const next = matches[k + 1];
    // Anchored span: time + duration ("from 2pm for 2 hours") or duration +
    // time ("for 2.5 hours from 9") → span(anchor, amount).
    const spanPair =
      next &&
      ((isTimeish(cur.role) && next.role === 'duration' && connectedBy(cur, next, tokens, ['for'])) ||
        (cur.role === 'duration' && isTimeish(next.role) && connectedBy(cur, next, tokens, ['from', 'starting', 'at'])) ||
        // "for a week starting tomorrow"
        (cur.role === 'duration' && next.role === 'date' && connectedBy(cur, next, tokens, ['starting', 'from'])));
    if (next && spanPair) {
      const [anchorPart, durPart] = cur.role === 'duration' ? [next, cur] : [cur, next];
      const amount = amountOf(durPart.expr);
      if (amount) {
        out.push({
          expr: { op: 'span', anchor: anchorPart.expr, amount },
          consumed: next.tokenEnd - cur.tokenStart,
          confidence: Math.max(cur.confidence, next.confidence),
          // A span anchored at a time-of-day is still time-of-day-ish: it can
          // merge with an adjacent date ("14th Feb from 9:30am for 7 hours").
          role: anchorPart.role,
          tokenStart: cur.tokenStart,
          tokenEnd: next.tokenEnd,
        });
        k += 2;
        continue;
      }
    }
    // Week + weekday: "previous week - Monday" → that weekday within the week.
    if (
      next &&
      isWeekExpr(cur.expr) &&
      next.expr.op === 'seek' &&
      next.expr.target.kind === 'weekday' &&
      isAdjacent(cur, next, tokens)
    ) {
      out.push({
        expr: { op: 'seek', base: cur.expr, dir: 'next', target: next.expr.target, n: 1 },
        consumed: next.tokenEnd - cur.tokenStart,
        confidence: Math.max(cur.confidence, next.confidence),
        role: 'date',
        tokenStart: cur.tokenStart,
        tokenEnd: next.tokenEnd,
      });
      k += 2;
      continue;
    }
    if (next && canMerge(cur, next) && isAdjacent(cur, next, tokens)) {
      const [datePart, timePart] = cur.role === 'time' ? [next, cur] : [cur, next];
      let dateExpr = datePart.expr;
      let timeExpr = inferMeridiem(dateExpr, timePart.expr);
      // A day-period on the date side pushes its meridiem into an explicit
      // time range and then steps aside: "Monday morning 6-8" is Monday
      // 06:00–08:00, not clipped to the morning boundaries.
      if (timeExpr.op === 'between') {
        const period = findDayPeriod(dateExpr);
        if (period) {
          timeExpr = {
            ...timeExpr,
            start: forceMeridiem(timeExpr.start, period),
            end: forceMeridiem(timeExpr.end, period),
          };
          dateExpr = stripDayPeriod(dateExpr) ?? dateExpr;
        }
      }
      out.push({
        expr: { op: 'intersect', parts: [dateExpr, timeExpr] },
        consumed: next.tokenEnd - cur.tokenStart,
        confidence: Math.max(cur.confidence, next.confidence),
        role: 'datetime',
        tokenStart: cur.tokenStart,
        tokenEnd: next.tokenEnd,
      });
      k += 2;
      continue;
    }
    out.push(cur);
    k += 1;
  }
  return out;
}

function canMerge(a: Positioned, b: Positioned): boolean {
  const dateish = (r: string): boolean => r === 'date' || r === 'datetime';
  return (dateish(a.role) && b.role === 'time') || (a.role === 'time' && dateish(b.role));
}

function isTimeish(role: string): boolean {
  return role === 'time' || role === 'datetime';
}

function isWeekExpr(expr: TimeExpr): boolean {
  return expr.op === 'snap' && expr.unit === 'week';
}

function connectedBy(a: Positioned, b: Positioned, tokens: Token[], words: string[]): boolean {
  const between = tokens.slice(a.tokenEnd, b.tokenStart);
  if (between.length > 2) return false;
  return between.every((t) => t.type === 'word' && (words.includes(t.value) || t.value === 'the'));
}

/** Extract a calendar amount from a duration-role expression. */
function amountOf(expr: TimeExpr): Record<string, number> | undefined {
  if (expr.op === 'amount') return { ...expr.amount } as Record<string, number>;
  if (expr.op === 'duration') {
    const m = expr.iso.match(/^PT(\d+)S$/);
    if (m) return { seconds: Number(m[1]) };
  }
  return undefined;
}

/**
 * "tonight at 10": a day part that carries a day period narrows an ambiguous
 * clock reading (night/evening/afternoon → pm, morning → am).
 */
function inferMeridiem(dateExpr: TimeExpr, timeExpr: TimeExpr): TimeExpr {
  if (timeExpr.op !== 'literal' || timeExpr.time?.meridiem !== 'unknown') return timeExpr;
  const period = findDayPeriod(dateExpr);
  if (!period) return timeExpr;
  const hour = timeExpr.time.hour ?? 12;
  // "tonight around 3" is 3am (small hours belong to the night); "tonight at
  // 10" is 10pm.
  const meridiem =
    period === 'morning' ? 'am' : (period === 'night' || period === 'evening') && hour <= 5 ? 'am' : 'pm';
  return {
    ...timeExpr,
    time: { ...timeExpr.time, meridiem },
  };
}

function forceMeridiem(expr: TimeExpr, period: string): TimeExpr {
  if (expr.op !== 'literal' || !expr.time || (expr.time.meridiem && expr.time.meridiem !== 'unknown')) {
    return expr;
  }
  const hour = expr.time.hour ?? 12;
  const meridiem =
    period === 'morning' ? 'am' : (period === 'night' || period === 'evening') && hour <= 5 ? 'am' : 'pm';
  return { ...expr, time: { ...expr.time, meridiem } };
}

/** Remove day-period literals from an intersect; undefined if nothing remains. */
function stripDayPeriod(expr: TimeExpr): TimeExpr | undefined {
  if (expr.op === 'literal' && expr.dayPeriod && !expr.date && !expr.time) return undefined;
  if (expr.op === 'intersect') {
    const parts = expr.parts.map(stripDayPeriod).filter((p): p is TimeExpr => p !== undefined);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return { ...expr, parts };
  }
  return expr;
}

function findDayPeriod(expr: TimeExpr): string | undefined {
  if (expr.op === 'literal' && expr.dayPeriod) return expr.dayPeriod;
  if (expr.op === 'intersect') {
    for (const p of expr.parts) {
      const found = findDayPeriod(p);
      if (found) return found;
    }
  }
  if (expr.op === 'seek' && expr.target.kind === 'dayPeriod') return expr.target.period;
  return undefined;
}

const REDUNDANT_BETWEEN = new Set([
  'mon', 'tue', 'tues', 'wed', 'weds', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

function isAdjacent(a: Positioned, b: Positioned, tokens: Token[]): boolean {
  const between = tokens.slice(a.tokenEnd, b.tokenStart);
  if (between.length > 2) return false;
  // A parenthesized weekday between date and time ("May/22 (Tue) 11:30") is
  // redundant with the date and doesn't block the merge.
  return between.every(
    (t) => t.type === 'word' && (CONNECTORS.includes(t.value) || REDUNDANT_BETWEEN.has(t.value)),
  );
}
