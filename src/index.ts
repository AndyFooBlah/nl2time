export {
  TimeContext,
  ConfigError,
  type TimeContextOptions,
  type DateOrder,
  type Bias,
  type NextWeekdayPolicy,
  type PartialPeriodPolicy,
} from './context.js';

export type {
  TimeExpr,
  Grain,
  Unit,
  Weekday,
  DayPeriod,
  CalendarAmount,
  Mod,
  Target,
  PartialDate,
  PartialTime,
} from './ir/types.js';
export { IR_VERSION } from './ir/types.js';
export { validateExpr, IRValidationError } from './ir/validate.js';

export {
  resolve,
  resolveOne,
  NotResolvableError,
  AmbiguityError,
  type TimeValue,
  type Resolution,
} from './engine/resolve.js';

export { parse, type ParseResult, type ParseMatch } from './parse/index.js';

export {
  describe,
  type Description,
  type DescribeOptions,
  type Framing,
} from './describe/index.js';

export { Temporal } from './clock/index.js';
