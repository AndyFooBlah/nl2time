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

const CONNECTORS = ['at', 'on', 'in', 'of', 'the'];

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

  const merged = mergeAdjacent(raw, tokens);
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
    if (next && canMerge(cur, next) && isAdjacent(cur, next, tokens)) {
      const [datePart, timePart] = cur.role === 'date' ? [cur, next] : [next, cur];
      out.push({
        expr: { op: 'intersect', parts: [datePart.expr, timePart.expr] },
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
  return (a.role === 'date' && b.role === 'time') || (a.role === 'time' && b.role === 'date');
}

function isAdjacent(a: Positioned, b: Positioned, tokens: Token[]): boolean {
  const between = tokens.slice(a.tokenEnd, b.tokenStart);
  if (between.length > 2) return false;
  return between.every((t) => t.type === 'word' && CONNECTORS.includes(t.value));
}
