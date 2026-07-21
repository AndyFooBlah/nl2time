/**
 * CLDR supplemental weekData slice (firstDay by territory).
 *
 * Source: CLDR supplemental/weekData.json. Territories not listed use the
 * world default (001): Monday. This file is intended to be regenerated from
 * CLDR by scripts/generate-cldr.ts (issue #7); the slice below covers the
 * common territories so v1 behaves correctly for them.
 */
import type { Weekday } from '../ir/types.js';

export const DEFAULT_FIRST_DAY: Weekday = 'mon';

const SUN: readonly string[] = [
  'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CO', 'DM', 'DO', 'ET',
  'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA',
  'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR',
  'PT', 'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS',
  'YE', 'ZA', 'ZW',
];

const SAT: readonly string[] = [
  'AE', 'AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA',
  'SD', 'SY',
];

const FRI: readonly string[] = ['MV'];

export function firstDayForRegion(region: string | undefined): Weekday {
  if (!region) return DEFAULT_FIRST_DAY;
  const r = region.toUpperCase();
  if (SUN.includes(r)) return 'sun';
  if (SAT.includes(r)) return 'sat';
  if (FRI.includes(r)) return 'fri';
  return DEFAULT_FIRST_DAY;
}
