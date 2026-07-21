import {
  Temporal,
  systemNow,
  systemTimeZone,
  toZoned,
  type Instant,
  type Zoned,
} from './clock/index.js';
import type { DayPeriodRule } from './data/dayPeriods.js';
import { firstDayForRegion } from './data/weekData.js';
import type { Weekday } from './ir/types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type DateOrder = 'MDY' | 'DMY' | 'YMD';
export type Bias = 'past' | 'future' | 'none';
/** The dialectal "next Tuesday" question: nearest upcoming vs Tuesday of next week. */
export type NextWeekdayPolicy = 'nearest' | 'week-after';
/** Does "the last 3 days" include the partial current day? */
export type PartialPeriodPolicy = 'include' | 'exclude';

export interface TimeContextOptions {
  /**
   * Reference instant. Defaults to the system clock; pass an explicit value
   * (Temporal.Instant or ISO string) for reproducible resolution and tests.
   */
  now?: Instant | string;
  /** IANA timezone of the *user/utterance*, not the machine. Defaults to system. */
  timeZone?: string;
  /** BCP-47 language-REGION tag. Region drives week-start & date-order defaults. */
  locale?: string;
  weekStart?: Weekday;
  dateOrder?: DateOrder;
  /** Direction preference for underspecified expressions ("Friday", "May 29"). */
  bias?: Bias;
  nextWeekday?: NextWeekdayPolicy;
  partialPeriod?: PartialPeriodPolicy;
  /** Override the locale's day-period boundaries (e.g. to match another system's conventions). */
  dayPeriods?: DayPeriodRule[];
}

const MDY_REGIONS = ['US', 'PH', 'UM', 'VI', 'GU', 'AS', 'PR'];
const YMD_REGIONS = ['CN', 'JP', 'KR', 'TW', 'HU', 'MN', 'LT'];

export class TimeContext {
  readonly now: Instant;
  readonly timeZone: string;
  readonly locale: string;
  readonly language: string;
  readonly region: string | undefined;
  readonly weekStart: Weekday;
  readonly dateOrder: DateOrder;
  readonly bias: Bias;
  readonly nextWeekday: NextWeekdayPolicy;
  readonly partialPeriod: PartialPeriodPolicy;
  readonly dayPeriods: DayPeriodRule[] | undefined;

  private constructor(opts: TimeContextOptions) {
    const rawNow = opts.now ?? systemNow();
    try {
      this.now = typeof rawNow === 'string' ? parseInstant(rawNow) : rawNow;
    } catch (e) {
      throw new ConfigError(`invalid now: ${String(e)}`);
    }
    this.timeZone = opts.timeZone ?? systemTimeZone();
    this.locale = opts.locale ?? 'en-US';

    let language: string;
    let region: string | undefined;
    try {
      const tag = new Intl.Locale(this.locale);
      language = tag.language;
      region = tag.region;
    } catch {
      throw new ConfigError(`invalid locale: ${this.locale}`);
    }
    this.language = language;
    this.region = region;

    this.weekStart = opts.weekStart ?? firstDayForRegion(region);
    this.dateOrder =
      opts.dateOrder ??
      (region && MDY_REGIONS.includes(region)
        ? 'MDY'
        : region && YMD_REGIONS.includes(region)
          ? 'YMD'
          : 'DMY');
    this.bias = opts.bias ?? 'none';
    this.nextWeekday = opts.nextWeekday ?? 'nearest';
    this.partialPeriod = opts.partialPeriod ?? 'include';
    this.dayPeriods = opts.dayPeriods;

    // Validate the timezone eagerly so failures surface at construction.
    try {
      toZoned(this.now, this.timeZone);
    } catch {
      throw new ConfigError(`invalid timeZone: ${this.timeZone}`);
    }
  }

  static make(opts: TimeContextOptions = {}): TimeContext {
    return new TimeContext(opts);
  }

  /** The reference instant projected into the context timezone. */
  get zonedNow(): Zoned {
    return toZoned(this.now, this.timeZone);
  }
}

function parseInstant(s: string): Instant {
  return Temporal.Instant.from(s);
}
