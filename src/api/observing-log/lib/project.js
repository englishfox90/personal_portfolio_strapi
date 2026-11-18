'use strict';

/**
 * Pure helpers for imaging projects: naming, slugs and folding session
 * totals into a project. No Strapi access here so the tests stay plain.
 */

const { toNumber, earliest, latest } = require('./night');

/** Trimmed project name, or null when there is nothing usable */
function normaliseProjectName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return trimmed || null;
}

/** "The Butterfly Nebula" -> "the-butterfly-nebula"; ASCII only, never empty */
function slugify(name) {
  const slug = String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** Add one frame's worth to a project's per-filter totals (same shape as a session's) */
function bumpFilters(filters, filter, exposureSeconds) {
  const out = { ...(filters || {}) };
  const bucket = out[filter] || { frames: 0, seconds: 0, exposureSeconds };
  out[filter] = {
    frames: (toNumber(bucket.frames) || 0) + 1,
    seconds: (toNumber(bucket.seconds) || 0) + exposureSeconds,
    exposureSeconds,
  };
  return out;
}

/** Merge a whole session's per-filter totals into a project's */
function mergeFilters(filters, sessionFilters) {
  const out = { ...(filters || {}) };
  for (const [name, bucket] of Object.entries(sessionFilters || {})) {
    if (!bucket) continue;
    const current = out[name] || { frames: 0, seconds: 0, exposureSeconds: toNumber(bucket.exposureSeconds) || 0 };
    out[name] = {
      frames: (toNumber(current.frames) || 0) + (toNumber(bucket.frames) || 0),
      seconds: (toNumber(current.seconds) || 0) + (toNumber(bucket.seconds) || 0),
      exposureSeconds: toNumber(bucket.exposureSeconds) || current.exposureSeconds || 0,
    };
  }
  return out;
}

/** Sorted, de-duplicated list of target names with one more added */
function addTarget(targetNames, targetName) {
  const set = new Set(Array.isArray(targetNames) ? targetNames.filter((t) => typeof t === 'string') : []);
  if (typeof targetName === 'string' && targetName.trim()) set.add(targetName.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Project totals with one session folded in: used both when a session is
 * attached late (its frames so far were not counted) and by the rebuild.
 */
function foldSession(project, session) {
  return {
    frameCount: (toNumber(project.frameCount) || 0) + (toNumber(session.frameCount) || 0),
    integrationSeconds: (toNumber(project.integrationSeconds) || 0) + (toNumber(session.integrationSeconds) || 0),
    sessionCount: (toNumber(project.sessionCount) || 0) + 1,
    firstFrameAt: earliest(project.firstFrameAt, session.firstFrameAt),
    lastFrameAt: latest(project.lastFrameAt, session.lastFrameAt),
    filters: mergeFilters(project.filters, session.filters),
    targetNames: addTarget(project.targetNames, session.targetName),
  };
}

// ---------------------------------------------------------------------------
// Target-named projects (rigs with no scheduler, e.g. the Seestar)
// ---------------------------------------------------------------------------

/** Statuses a new session may still join; complete/abandoned projects stay closed */
const OPEN_STATUSES = new Set(['active', 'paused']);

/** "(mosaic)", "Panel 2", "mosaic" decorations that do not change the subject */
const DECORATION = /\(\s*mosaic\s*\)|\bmosaic\b|\bpanel\s*\d+\b/gi;

function compactKey(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Comparable keys for a target name, so spellings of one subject match:
 * "SH2-171" / "Sh2-171" -> sh2171; "NGC 6992 Panel 1" -> ngc6992;
 * "California Nebula (NGC 1499)" -> californianebula + ngc1499.
 */
function targetKeys(targetName) {
  if (typeof targetName !== 'string') return [];
  const cleaned = targetName.replace(DECORATION, ' ');
  const keys = new Set();
  const inner = [];
  const outer = cleaned.replace(/\(([^)]*)\)/g, (_, group) => {
    inner.push(group);
    return ' ';
  });
  for (const part of [outer, ...inner]) {
    const key = compactKey(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Project name for a target with no scheduler project: decorations and catalogue brackets dropped */
function projectNameForTarget(targetName) {
  if (typeof targetName !== 'string') return null;
  const outer = targetName.replace(DECORATION, ' ').replace(/\([^)]*\)/g, ' ');
  return normaliseProjectName(outer) || normaliseProjectName(targetName.replace(DECORATION, ' '));
}

/** True when the project is open and already images this target (or is named after it) */
function projectMatchesTarget(project, targetName) {
  if (!project || !OPEN_STATUSES.has(project.projectStatus || 'active')) return false;
  const wanted = new Set(targetKeys(targetName));
  if (wanted.size === 0) return false;
  const names = [...(Array.isArray(project.targetNames) ? project.targetNames : []), project.name];
  return names.some((n) => targetKeys(n).some((k) => wanted.has(k)));
}

const EMPTY_TOTALS = Object.freeze({
  frameCount: 0,
  integrationSeconds: 0,
  sessionCount: 0,
  firstFrameAt: null,
  lastFrameAt: null,
  filters: {},
  targetNames: [],
});

module.exports = {
  normaliseProjectName,
  slugify,
  bumpFilters,
  mergeFilters,
  addTarget,
  foldSession,
  targetKeys,
  projectNameForTarget,
  projectMatchesTarget,
  OPEN_STATUSES,
  EMPTY_TOTALS,
};
