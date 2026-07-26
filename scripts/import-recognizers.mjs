#!/usr/bin/env node
/**
 * Convert vendored microsoft/Recognizers-Text DateTime specs (MIT) into
 * unified forward corpus cases (corpus/forward/imported-recognizers-en.json).
 *
 * Mapping notes (see corpus/README.md):
 * - Spec values are civil-local; imported cases run with timeZone UTC and use
 *   *Local expectations.
 * - Multiple resolution values (past+future, am+pm) become unordered `values`
 *   expectations — every expected value must appear among our candidates.
 * - Skipped (counted below): multi-span utterances (runner grades one span),
 *   sets (recur resolves in v2, issue #5), timezone results, open-ended
 *   ranges (mod since/before — not yet in the IR), null-typed results.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const COMMIT = 'da7edcff59f669b2a460ab9d400e36298f0d658e';

const FILES = [
  { vendored: 'DateTimeModel.json', specPath: 'Specs/DateTime/English/DateTimeModel.json', locale: 'en-US', prefix: 'rt-dtm', tag: 'rt-en', out: 'en' },
  { vendored: 'DateTimeModel.EnglishOthers.json', specPath: 'Specs/DateTime/EnglishOthers/DateTimeModel.json', locale: 'en-GB', prefix: 'rt-gb', tag: 'rt-en-gb', out: 'en' },
  { vendored: 'DateTimeModelComplexCalendar.json', specPath: 'Specs/DateTime/English/DateTimeModelComplexCalendar.json', locale: 'en-US', prefix: 'rt-cc', tag: 'rt-complex', out: 'en' },
  { vendored: 'DateTimeModel.Spanish.json', specPath: 'Specs/DateTime/Spanish/DateTimeModel.json', locale: 'es-ES', prefix: 'rt-es', tag: 'rt-es', out: 'es' },
  { vendored: 'DateTimeModel.French.json', specPath: 'Specs/DateTime/French/DateTimeModel.json', locale: 'fr-FR', prefix: 'rt-fr', tag: 'rt-fr', out: 'fr' },
  { vendored: 'DateTimeModel.German.json', specPath: 'Specs/DateTime/German/DateTimeModel.json', locale: 'de-DE', prefix: 'rt-de', tag: 'rt-de', out: 'de' },
  { vendored: 'DateTimeModel.Japanese.json', specPath: 'Specs/DateTime/Japanese/DateTimeModel.json', locale: 'ja-JP', prefix: 'rt-ja', tag: 'rt-ja', out: 'ja' },
  { vendored: 'DateTimeModel.Chinese.json', specPath: 'Specs/DateTime/Chinese/DateTimeModel.json', locale: 'zh-CN', prefix: 'rt-zh', tag: 'rt-zh', out: 'zh' },
];

const GRAIN_BY_TIMEX_DURATION = {
  P1D: 'day',
  P1W: 'week',
  P1M: 'month',
  P1Y: 'year',
};

const skip = { multiResult: 0, set: 0, timezone: 0, openRange: 0, nullType: 0, noValues: 0, unmappable: 0 };
const casesByOut = new Map();

function pad(dt) {
  // "2019-01-04" → date only; "16:12:00" time only; "2016-11-07 16:12:00" → T
  return dt.replace(' ', 'T');
}

function datePlus1(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function mapValue(val, refDate) {
  const type = val.type;
  if (type === 'date') {
    if (!val.value || !/^\d{4}-\d{2}-\d{2}$/.test(val.value)) return undefined;
    return { startLocal: `${val.value}T00:00:00`, endLocal: `${datePlus1(val.value)}T00:00:00`, grain: 'day' };
  }
  if (type === 'daterange' || type === 'datetimerange' || type === 'timerange') {
    if (!val.start || !val.end) {
      skip.openRange += 1;
      return null; // marks whole case as skipped
    }
    if (type === 'daterange' && !/^\d{4}-\d{2}-\d{2}$/.test(val.start)) return undefined;
    const grain = type === 'daterange' ? (GRAIN_BY_TIMEX_DURATION[val.timex?.match(/,(P[^)]+)\)$/)?.[1]] ?? null) : null;
    const startLocal = type === 'timerange' ? `${refDate}T${val.start}` : pad(val.start) + (type === 'daterange' ? 'T00:00:00' : '');
    const endLocal = type === 'timerange' ? `${refDate}T${val.end}` : pad(val.end) + (type === 'daterange' ? 'T00:00:00' : '');
    const spec = { startLocal, endLocal };
    if (grain) spec.grain = grain;
    return spec;
  }
  if (type === 'datetime') {
    if (!val.value) return undefined;
    return { pointLocal: pad(val.value) };
  }
  if (type === 'time') {
    if (!val.value) return undefined;
    return { pointLocal: `${refDate}T${val.value}` };
  }
  return undefined;
}

for (const fileDef of FILES) {
  const raw = readFileSync(
    new URL(`../corpus/vendor/recognizers-text/${fileDef.vendored}`, import.meta.url),
    'utf8',
  );
  const specs = JSON.parse(raw.replace(/^\ufeff/, ''));
  if (!casesByOut.has(fileDef.out)) casesByOut.set(fileDef.out, []);
  const cases = casesByOut.get(fileDef.out);
  for (const [i, spec] of specs.entries()) {
  const results = spec.Results ?? [];
  if (results.length !== 1) {
    skip.multiResult += 1;
    continue;
  }
  const r = results[0];
  const typeName = r.TypeName ?? '';
  if (!typeName.startsWith('datetimeV2.')) {
    skip.nullType += 1;
    continue;
  }
  const kind = typeName.slice('datetimeV2.'.length);
  if (kind === 'set') {
    skip.set += 1;
    continue;
  }
  if (kind === 'timezone') {
    skip.timezone += 1;
    continue;
  }
  const values = r.Resolution?.values ?? [];
  if (values.length === 0) {
    skip.noValues += 1;
    continue;
  }

  const refDateTime = spec.Context?.ReferenceDateTime ?? '2016-11-07T00:00:00';
  const refDate = refDateTime.slice(0, 10);
  // The context encodes the upstream system's conventions so its expectations
  // resolve correctly: ISO Monday weeks, complete-period "next/last N days",
  // and Recognizers' fixed day-period boundaries (morning 8–12, afternoon
  // 12–16, evening 16–20, night 20–24).
  const ctx = {
    now: `${refDateTime}Z`,
    timeZone: 'UTC',
    locale: fileDef.locale,
    weekStart: 'mon',
    partialPeriod: 'exclude',
    nextWeekday: 'week-after',
    dayPeriods: [
      { period: 'morning', from: 8, before: 12 },
      { period: 'afternoon', from: 12, before: 16 },
      { period: 'evening', from: 16, before: 20 },
      { period: 'night', from: 20, before: 24 },
    ],
  };

  let expect;
  if (kind === 'duration') {
    const secs = Number(values[0].value);
    if (!Number.isFinite(secs)) {
      skip.unmappable += 1;
      continue;
    }
    expect = { durationSeconds: secs };
  } else {
    const mapped = values.map((v) => mapValue(v, refDate));
    if (mapped.includes(null) || mapped.some((m) => m === undefined)) {
      if (!mapped.includes(null)) skip.unmappable += 1;
      continue;
    }
    expect = { values: mapped };
  }

  cases.push({
    id: `${fileDef.prefix}-${String(i).padStart(4, '0')}`,
    text: spec.Input,
    ctx,
    expect,
    level: 'aspirational',
    source: {
      name: 'microsoft/Recognizers-Text',
      license: 'MIT',
      url: 'https://github.com/microsoft/Recognizers-Text',
      path: fileDef.specPath,
      commit: COMMIT,
      index: i,
    },
    tags: ['imported', fileDef.tag, `rt:${kind}`],
  });
  }
}

for (const [lang, cases] of casesByOut) {
  const out = {
    description:
      'Imported from microsoft/Recognizers-Text DateTimeModel specs (MIT). Civil-local expectations under UTC contexts; unordered `values` semantics. Regenerate with scripts/import-recognizers.mjs.',
    cases,
  };
  writeFileSync(
    new URL(`../corpus/forward/imported-recognizers-${lang}.json`, import.meta.url),
    JSON.stringify(out, null, 1) + '\n',
  );
  console.log(`${lang}: ${cases.length} cases`);
}
console.log('skipped:', skip);
