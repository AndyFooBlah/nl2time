/**
 * CLDR flexible day-period boundary rules.
 *
 * Source: CLDR supplemental/dayPeriods.json (rule set per language). v1 ships
 * the English rules; the generator script (issue #7) will widen coverage.
 * Boundaries are [from, before) in local hours; a period may wrap midnight
 * (night: 21:00 → 06:00).
 */
import type { DayPeriod } from '../ir/types.js';

export interface DayPeriodRule {
  period: DayPeriod;
  /** Start hour (inclusive), local time. */
  from: number;
  /** End hour (exclusive). May be < from, meaning the period wraps midnight. */
  before: number;
}

const EN_RULES: readonly DayPeriodRule[] = [
  { period: 'morning', from: 6, before: 12 },
  { period: 'afternoon', from: 12, before: 18 },
  { period: 'evening', from: 18, before: 21 },
  { period: 'night', from: 21, before: 6 },
];

export function dayPeriodRules(language: string): readonly DayPeriodRule[] {
  // Only 'en' data is bundled so far; other languages fall back to the en
  // boundaries, which match CLDR's defaults closely enough for v1.
  void language;
  return EN_RULES;
}

export function periodForHour(language: string, hour: number): DayPeriod {
  for (const rule of dayPeriodRules(language)) {
    if (rule.from < rule.before) {
      if (hour >= rule.from && hour < rule.before) return rule.period;
    } else if (hour >= rule.from || hour < rule.before) {
      return rule.period;
    }
  }
  return 'night';
}
