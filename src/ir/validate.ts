import {
  DAY_PERIODS,
  HOLIDAY_NAMES,
  UNITS,
  WEEKDAYS,
  type TimeExpr,
} from './types.js';

export class IRValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'IRValidationError';
  }
}

const MODS = ['approx', 'start', 'mid', 'end'];
const DIRS = ['next', 'prev', 'nearest'];

/**
 * Structural validation of untrusted input (LLM output, stored IR, network)
 * into a typed TimeExpr. Mirrors schema/timeexpr.schema.json; the JSON Schema
 * is the language-neutral spec, this is the fast in-process check.
 */
export function validateExpr(input: unknown, path = '$'): TimeExpr {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new IRValidationError('expected an object', path);
  }
  const obj = input as Record<string, unknown>;
  if ('mod' in obj && obj.mod !== undefined && !MODS.includes(obj.mod as string)) {
    throw new IRValidationError(`invalid mod ${JSON.stringify(obj.mod)}`, path);
  }
  const op = obj.op;
  switch (op) {
    case 'now':
      return obj as unknown as TimeExpr;
    case 'literal': {
      if (obj.date !== undefined) validatePartialDate(obj.date, `${path}.date`);
      if (obj.time !== undefined) validatePartialTime(obj.time, `${path}.time`);
      if (obj.dayPeriod !== undefined && !DAY_PERIODS.includes(obj.dayPeriod as never)) {
        throw new IRValidationError(`invalid dayPeriod`, `${path}.dayPeriod`);
      }
      if (obj.date === undefined && obj.time === undefined && obj.dayPeriod === undefined) {
        throw new IRValidationError('literal requires date, time, or dayPeriod', path);
      }
      return obj as unknown as TimeExpr;
    }
    case 'offset': {
      validateExpr(obj.base, `${path}.base`);
      requireInt(obj.amount, `${path}.amount`);
      requireUnit(obj.unit, `${path}.unit`);
      return obj as unknown as TimeExpr;
    }
    case 'snap': {
      validateExpr(obj.base, `${path}.base`);
      requireUnit(obj.unit, `${path}.unit`);
      if (obj.edge !== undefined && obj.edge !== 'start' && obj.edge !== 'end') {
        throw new IRValidationError('edge must be "start" or "end"', `${path}.edge`);
      }
      return obj as unknown as TimeExpr;
    }
    case 'span': {
      validateExpr(obj.anchor, `${path}.anchor`);
      validateAmount(obj.amount, `${path}.amount`);
      if (obj.business !== undefined && typeof obj.business !== 'boolean') {
        throw new IRValidationError('business must be boolean', `${path}.business`);
      }
      return obj as unknown as TimeExpr;
    }
    case 'between': {
      validateExpr(obj.start, `${path}.start`);
      validateExpr(obj.end, `${path}.end`);
      return obj as unknown as TimeExpr;
    }
    case 'seek': {
      validateExpr(obj.base, `${path}.base`);
      if (!DIRS.includes(obj.dir as string)) {
        throw new IRValidationError('dir must be next|prev|nearest', `${path}.dir`);
      }
      validateTarget(obj.target, `${path}.target`);
      if (obj.n !== undefined) requireInt(obj.n, `${path}.n`);
      return obj as unknown as TimeExpr;
    }
    case 'intersect': {
      if (!Array.isArray(obj.parts) || obj.parts.length < 2) {
        throw new IRValidationError('intersect requires >= 2 parts', `${path}.parts`);
      }
      obj.parts.forEach((p, i) => validateExpr(p, `${path}.parts[${i}]`));
      return obj as unknown as TimeExpr;
    }
    case 'duration': {
      if (typeof obj.iso !== 'string' || !/^-?P/.test(obj.iso)) {
        throw new IRValidationError('duration requires an ISO-8601 string', `${path}.iso`);
      }
      return obj as unknown as TimeExpr;
    }
    case 'amount': {
      validateAmount(obj.amount, `${path}.amount`);
      return obj as unknown as TimeExpr;
    }
    case 'holiday': {
      if (!HOLIDAY_NAMES.includes(obj.name as never)) {
        throw new IRValidationError(`unknown holiday ${JSON.stringify(obj.name)}`, `${path}.name`);
      }
      if (obj.year !== undefined) requireInt(obj.year, `${path}.year`);
      if (obj.dir !== undefined && obj.dir !== 'prev' && obj.dir !== 'next') {
        throw new IRValidationError('dir must be prev|next', `${path}.dir`);
      }
      return obj as unknown as TimeExpr;
    }
    case 'recur': {
      requireUnit(obj.every, `${path}.every`);
      if (obj.filter !== undefined) validateExpr(obj.filter, `${path}.filter`);
      return obj as unknown as TimeExpr;
    }
    default:
      throw new IRValidationError(`unknown op ${JSON.stringify(op)}`, path);
  }
}

function requireInt(v: unknown, path: string): void {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new IRValidationError('expected an integer', path);
  }
}

function requireUnit(v: unknown, path: string): void {
  if (!UNITS.includes(v as never)) {
    throw new IRValidationError(`invalid unit ${JSON.stringify(v)}`, path);
  }
}

function validateTarget(v: unknown, path: string): void {
  if (typeof v !== 'object' || v === null) {
    throw new IRValidationError('expected a target object', path);
  }
  const t = v as Record<string, unknown>;
  switch (t.kind) {
    case 'weekday':
      if (!WEEKDAYS.includes(t.weekday as never)) {
        throw new IRValidationError('invalid weekday', `${path}.weekday`);
      }
      return;
    case 'month':
      requireInt(t.month, `${path}.month`);
      if ((t.month as number) < 1 || (t.month as number) > 12) {
        throw new IRValidationError('month out of range', `${path}.month`);
      }
      return;
    case 'dayPeriod':
      if (!DAY_PERIODS.includes(t.period as never)) {
        throw new IRValidationError('invalid dayPeriod', `${path}.period`);
      }
      return;
    case 'unit':
      requireUnit(t.unit, `${path}.unit`);
      return;
    default:
      throw new IRValidationError('target kind must be weekday|month|dayPeriod|unit', path);
  }
}

const AMOUNT_FIELDS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];

function validateAmount(v: unknown, path: string): void {
  if (typeof v !== 'object' || v === null) {
    throw new IRValidationError('expected a calendar amount object', path);
  }
  const keys = Object.keys(v);
  if (keys.length === 0) throw new IRValidationError('amount must have at least one field', path);
  for (const k of keys) {
    if (!AMOUNT_FIELDS.includes(k)) throw new IRValidationError(`unknown field "${k}"`, path);
    requireInt((v as Record<string, unknown>)[k], `${path}.${k}`);
  }
}

function validatePartialDate(v: unknown, path: string): void {
  if (typeof v !== 'object' || v === null) throw new IRValidationError('expected object', path);
  const d = v as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (!['year', 'month', 'day'].includes(k)) {
      throw new IRValidationError(`unknown field "${k}"`, path);
    }
    requireInt(d[k], `${path}.${k}`);
  }
  if (typeof d.month === 'number' && (d.month < 1 || d.month > 12)) {
    throw new IRValidationError('month out of range', `${path}.month`);
  }
  if (typeof d.day === 'number' && (d.day < 1 || d.day > 31)) {
    throw new IRValidationError('day out of range', `${path}.day`);
  }
}

function validatePartialTime(v: unknown, path: string): void {
  if (typeof v !== 'object' || v === null) throw new IRValidationError('expected object', path);
  const t = v as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (!['hour', 'minute', 'second', 'meridiem'].includes(k)) {
      throw new IRValidationError(`unknown field "${k}"`, path);
    }
  }
  if (t.hour !== undefined) requireInt(t.hour, `${path}.hour`);
  if (t.minute !== undefined) requireInt(t.minute, `${path}.minute`);
  if (t.second !== undefined) requireInt(t.second, `${path}.second`);
  if (t.meridiem !== undefined && !['am', 'pm', 'unknown'].includes(t.meridiem as string)) {
    throw new IRValidationError('meridiem must be am|pm|unknown', `${path}.meridiem`);
  }
}
