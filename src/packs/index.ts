/**
 * Domain packs: declarative vocabulary that extends the parser without
 * forking (docs/extending.md, issue #11).
 *
 * A pack maps phrases to TimeExpr templates. Phrases are whitespace-separated
 * segments matched against the token stream; `{n}` captures an integer,
 * `{yr}` captures a year (two-digit values normalize to 2000+). Captures may
 * appear standalone ("sprint {n}") or embedded in a word ("fy{yr}" matches
 * "FY26"). Inside a template, any integer position may be the capture
 * reference `{"$": "n", "scale"?: k, "offset"?: m}` → value = n·k + m.
 *
 * Compiled pack rules compete in the normal scanner (longest match, then
 * confidence, then order — packs run first, so at equal length and higher
 * confidence they shadow built-ins). Packs are plain JSON: portable to other
 * language ports, safe to load from config, and testable with the same corpus
 * format via `nl2time/corpus` (a pack should ship its own cases file).
 */
import type { TimeExpr } from '../ir/types.js';
import { IRValidationError, validateExpr } from '../ir/validate.js';
import type { Rule, RuleMatch } from '../parse/en.js';
import type { Token } from '../parse/tokenizer.js';

export interface VocabEntry {
  /** Alternative phrasings, matched case-insensitively over tokens. */
  phrases: string[];
  /** TimeExpr template; integers may be capture references (see module doc). */
  expr?: unknown;
  /**
   * Shorthand for a named time-of-day interval in local 24h hours
   * ("swing shift" 16→24). `before` ≤ `from` wraps past midnight.
   * Exactly one of `expr` / `period` is required.
   */
  period?: { from: number; before: number };
  /** How the match combines with neighbors (default: 'date'; periods: 'time'). */
  role?: 'date' | 'time' | 'datetime' | 'duration';
  /** Default 0.98 — above built-ins, so equal-length matches shadow them. */
  confidence?: number;
}

export interface DomainPack {
  name: string;
  /** Built-in rule names to turn off entirely (see EN_RULE_ENTRIES). */
  disable?: string[];
  vocabulary: VocabEntry[];
  /**
   * Suggested TimeContext options for this domain (weekStart, dayPeriods, …).
   * Not applied automatically — merge into TimeContext.make() yourself, since
   * the context may also carry per-user settings.
   */
  context?: Record<string, unknown>;
}

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

type Segment =
  | { kind: 'word'; value: string }
  | { kind: 'number'; capture: string }
  | { kind: 'embedded'; regex: RegExp; captures: string[] };

interface CompiledEntry {
  segments: Segment[];
  template: unknown;
  role: RuleMatch['role'];
  confidence: number;
}

const CAPTURE_RE = /\{(n|yr)\}/g;

function compilePhrase(phrase: string): Segment[] {
  return phrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((seg): Segment => {
      const captures = [...seg.matchAll(CAPTURE_RE)].map((m) => m[1]!);
      if (captures.length === 0) return { kind: 'word', value: seg };
      if (seg === '{n}' || seg === '{yr}') return { kind: 'number', capture: captures[0]! };
      // Embedded captures: "fy{yr}" → /^fy(\d{1,4})$/
      const source = seg
        .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '{' || c === '}' ? c : `\\${c}`))
        .replace(CAPTURE_RE, '(\\d{1,4})');
      return { kind: 'embedded', regex: new RegExp(`^${source}$`), captures };
    });
}

function normalizeCapture(name: string, raw: number): number {
  if (name === 'yr' && raw < 100) return 2000 + raw;
  return raw;
}

/** Deep-substitute capture references in a template; returns a fresh tree. */
function substitute(node: unknown, captures: Record<string, number>): unknown {
  if (Array.isArray(node)) return node.map((x) => substitute(x, captures));
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;
    if (typeof obj['$'] === 'string') {
      const base = captures[obj['$']];
      if (base === undefined) throw new PackError(`unbound capture "${obj['$']}"`);
      const scale = typeof obj['scale'] === 'number' ? obj['scale'] : 1;
      const offset = typeof obj['offset'] === 'number' ? obj['offset'] : 0;
      return base * scale + offset;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = substitute(v, captures);
    return out;
  }
  return node;
}

function periodTemplate(period: { from: number; before: number }): unknown {
  return {
    op: 'between',
    start: { op: 'literal', time: { hour: period.from } },
    end: { op: 'literal', time: { hour: period.before === 24 ? 0 : period.before } },
  };
}

function word(t: Token | undefined): string | undefined {
  return t?.type === 'word' ? t.value : undefined;
}

function compileEntry(entry: VocabEntry, packName: string, index: number): CompiledEntry[] {
  if ((entry.expr === undefined) === (entry.period === undefined)) {
    throw new PackError(`${packName}[${index}]: exactly one of expr/period is required`);
  }
  const template = entry.expr ?? periodTemplate(entry.period!);
  const role = entry.role ?? (entry.period ? 'time' : 'date');
  const confidence = entry.confidence ?? 0.98;
  // Fail fast: validate the template with sample captures.
  try {
    validateExpr(substitute(template, { n: 1, yr: 2026 }));
  } catch (e) {
    if (e instanceof IRValidationError || e instanceof PackError) {
      throw new PackError(`${packName}[${index}]: invalid template — ${e.message}`);
    }
    throw e;
  }
  return entry.phrases.map((p) => ({
    segments: compilePhrase(p),
    template,
    role,
    confidence,
  }));
}

/** Compile a pack's vocabulary into a single scanner rule. */
export function compilePack(pack: DomainPack): Rule {
  const entries = pack.vocabulary.flatMap((e, idx) => compileEntry(e, pack.name, idx));

  return (tokens, i) => {
    let best: RuleMatch | undefined;
    for (const entry of entries) {
      const captures: Record<string, number> = {};
      let ok = true;
      for (const [si, seg] of entry.segments.entries()) {
        const t = tokens[i + si];
        if (seg.kind === 'word') {
          const w = word(t);
          // Literal numeric segments ("4") also match number tokens.
          if (w !== seg.value && !(t?.type === 'number' && String(t.value) === seg.value)) {
            ok = false;
            break;
          }
        } else if (seg.kind === 'number') {
          if (t?.type !== 'number') {
            ok = false;
            break;
          }
          captures[seg.capture] = normalizeCapture(seg.capture, t.value);
        } else {
          const w = word(t);
          const m = w?.match(seg.regex);
          if (!m) {
            ok = false;
            break;
          }
          seg.captures.forEach((name, ci) => {
            captures[name] = normalizeCapture(name, Number(m[ci + 1]));
          });
        }
      }
      if (!ok) continue;
      const consumed = entry.segments.length;
      if (best && consumed <= best.consumed) continue;
      best = {
        expr: substitute(entry.template, captures) as TimeExpr,
        consumed,
        confidence: entry.confidence,
        role: entry.role,
      };
    }
    return best;
  };
}

/** Structural validation for untrusted pack JSON (config files, uploads). */
export function validatePack(input: unknown): DomainPack {
  if (typeof input !== 'object' || input === null) throw new PackError('pack must be an object');
  const p = input as Record<string, unknown>;
  if (typeof p.name !== 'string' || p.name === '') throw new PackError('pack.name required');
  if (!Array.isArray(p.vocabulary) || p.vocabulary.length === 0) {
    throw new PackError('pack.vocabulary must be a non-empty array');
  }
  if (p.disable !== undefined && !Array.isArray(p.disable)) {
    throw new PackError('pack.disable must be an array of rule names');
  }
  // compileEntry performs the deep checks (and template validation).
  const pack = input as DomainPack;
  pack.vocabulary.forEach((e, idx) => compileEntry(e, pack.name, idx));
  return pack;
}
