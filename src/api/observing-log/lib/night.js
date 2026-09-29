'use strict';

/**
 * Pure helpers for the observing log. No Strapi access here so they can be
 * unit-tested with plain Node (`node --test tests/`).
 */

const NIGHT_TOKEN = /_NIGHT_(\d{4}-\d{2}-\d{2})/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * NINA stamps the observing night into the filename via $$DATEMINUS12$$
 * (e.g. `..._NIGHT_2026-09-28_...`). That is the most reliable source because
 * it is computed on the rig, in the rig's own clock and timezone.
 */
function nightFromFilename(filename) {
  if (typeof filename !== 'string') return null;
  const match = filename.match(NIGHT_TOKEN);
  return match ? match[1] : null;
}

/**
 * Fallback: the local calendar date, in `timeZone`, twelve hours before the
 * timestamp. A session running 22:00 -> 04:00 therefore stays on the evening
 * it started.
 */
function nightFromDate(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() - 12 * 60 * 60 * 1000);
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(shifted);
  } catch {
    return shifted.toISOString().slice(0, 10);
  }
}

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(n, places = 3) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Incrementally fold a numeric reading into a { min, max, sum, count, mean }
 * summary. Returns a new summary object; the input is not mutated.
 */
function foldSummary(summary, value) {
  const n = toNumber(value);
  if (n === null) return summary || null;
  const prev = summary || { min: n, max: n, sum: 0, count: 0, mean: n };
  const sum = (toNumber(prev.sum) ?? 0) + n;
  const count = (toNumber(prev.count) ?? 0) + 1;
  return {
    min: Math.min(toNumber(prev.min) ?? n, n),
    max: Math.max(toNumber(prev.max) ?? n, n),
    sum: round(sum),
    count,
    mean: round(sum / count),
  };
}

/** Fold every listed metric of `reading` into `summaries` (keyed by metric). */
function foldSummaries(summaries, reading, metrics) {
  const next = { ...(summaries || {}) };
  for (const key of metrics) {
    const folded = foldSummary(next[key], reading ? reading[key] : undefined);
    if (folded) next[key] = folded;
  }
  return next;
}

function earliest(a, b) {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta)) return b || null;
  if (Number.isNaN(tb)) return a || null;
  return ta <= tb ? a : b;
}

function latest(a, b) {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta)) return b || null;
  if (Number.isNaN(tb)) return a || null;
  return ta >= tb ? a : b;
}

function sessionKey(night, targetName) {
  return `${night}|${String(targetName).trim().toLowerCase()}`;
}

module.exports = {
  nightFromFilename,
  nightFromDate,
  isIsoDate,
  toNumber,
  round,
  foldSummary,
  foldSummaries,
  earliest,
  latest,
  sessionKey,
};
