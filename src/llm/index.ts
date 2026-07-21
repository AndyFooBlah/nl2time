/**
 * LLM adapter helpers. nl2time never makes network calls: the application
 * supplies a fallback function (its own LLM client); this module supplies the
 * IR JSON schema for constrained decoding, the prompt (which always carries
 * the clock), and strict validation of whatever comes back. The LLM can only
 * ever emit a TimeExpr — never a concrete date — so all arithmetic stays in
 * the deterministic engine.
 */
import { createRequire } from 'node:module';

import type { TimeContext } from '../context.js';
import { validateExpr } from '../ir/validate.js';
import { parse, type ParseResult } from '../parse/index.js';

const require = createRequire(import.meta.url);

/** The TimeExpr JSON Schema — pass to constrained decoding / tool definitions. */
export function irJsonSchema(): object {
  return require('../../schema/timeexpr.schema.json') as object;
}

export interface CtxSummary {
  referenceInstant: string;
  timeZone: string;
  locale: string;
  weekStart: string;
  localDateTime: string;
}

export function ctxSummary(ctx: TimeContext): CtxSummary {
  const z = ctx.zonedNow;
  return {
    referenceInstant: ctx.now.toString(),
    timeZone: ctx.timeZone,
    locale: ctx.locale,
    weekStart: ctx.weekStart,
    localDateTime: z.toPlainDateTime().toString(),
  };
}

/**
 * A prompt for translating one natural-language expression into a TimeExpr.
 * Inject alongside irJsonSchema() via your provider's structured-output
 * mechanism.
 */
export function buildPrompt(text: string, ctx: TimeContext): string {
  const s = ctxSummary(ctx);
  return [
    'Translate the natural-language time expression into a TimeExpr JSON object',
    'conforming to the provided schema. Emit ONLY the symbolic expression —',
    'never compute concrete dates yourself; the deterministic engine resolves',
    'the expression against the reference context.',
    '',
    `Reference context (for disambiguation only):`,
    `- reference instant (UTC): ${s.referenceInstant}`,
    `- user local date/time: ${s.localDateTime} (${s.timeZone})`,
    `- locale: ${s.locale}, week starts on: ${s.weekStart}`,
    '',
    'Guidance:',
    '- "last week" → {"op":"snap","base":{"op":"offset","base":{"op":"now"},"amount":-1,"unit":"week"},"unit":"week"}',
    '- "the last 3 days" → {"op":"span","anchor":{"op":"now"},"amount":{"days":-3}}',
    '- "next Tuesday at 4" → {"op":"intersect","parts":[{"op":"seek","base":{"op":"now"},"dir":"next","target":{"kind":"weekday","weekday":"tue"}},{"op":"literal","time":{"hour":4,"meridiem":"unknown"}}]}',
    '- Ambiguous readings stay symbolic: keep meridiem "unknown", omit unstated date components.',
    '',
    `Expression: ${JSON.stringify(text)}`,
  ].join('\n');
}

export type LLMFallback = (text: string, summary: CtxSummary) => Promise<unknown>;

/**
 * parse() with an LLM fallback: rules first; if no confident rule match, the
 * fallback is asked for a TimeExpr, which is schema-validated before use.
 * Invalid LLM output is dropped (the result just has no matches) — the engine
 * never guesses.
 */
export async function parseWithFallback(
  text: string,
  ctx: TimeContext,
  fallback: LLMFallback,
): Promise<ParseResult> {
  const ruleResult = parse(text, ctx);
  if (ruleResult.matches.length > 0) return ruleResult;

  let raw: unknown;
  try {
    raw = await fallback(text, ctxSummary(ctx));
  } catch {
    return ruleResult;
  }
  try {
    const expr = validateExpr(raw);
    return {
      matches: [
        {
          text,
          start: 0,
          end: text.length,
          expr,
          confidence: 0.6,
          source: 'llm',
        },
      ],
    };
  } catch {
    return ruleResult;
  }
}
