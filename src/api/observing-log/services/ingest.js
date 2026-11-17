'use strict';

/**
 * Observing-log ingest.
 *
 * The rig (NINA) rewrites the `currently-imaging` single type on every event,
 * so nothing is kept historically. This service is called from the Document
 * Service middleware registered in `src/index.js` each time that document is
 * written, and turns the transient payload into durable rows:
 *
 *   imaging-frame    one per saved light frame (idempotent on NINA filename,
 *                    or a synthetic `seestar_<run>_<index>` for Seestar subs)
 *   imaging-session  one per target per observing night (aggregates)
 *   observing-night  one per night: totals + weather-station summary/samples
 *   imaging-project  one per scheduler project: totals across every session
 *
 * Design rules:
 *  - Never throw into the rig's request. `enqueue()` swallows and logs.
 *  - Ingests are serialised through an in-process queue so the
 *    find-or-create steps cannot race each other (single Railway instance).
 *  - The rig's payload is the source of truth when present; when the
 *    middleware only sees a publish (no data), the published document is
 *    fetched instead.
 */

const {
  nightFromFilename,
  nightFromDate,
  targetFromFilename,
  targetFromActivityLog,
  roofEventsFromActivityLog,
  roofOpenFromStatus,
  sameTarget,
  hourInTimeZone,
  inNightWindow,
  isIsoDate,
  toNumber,
  foldSummaries,
  earliest,
  latest,
  sessionKey,
} = require('../lib/night');
const { normaliseProjectName, slugify, bumpFilters, addTarget, foldSession, EMPTY_TOTALS } = require('../lib/project');

const UID = {
  currentlyImaging: 'api::currently-imaging.currently-imaging',
  night: 'api::observing-night.observing-night',
  session: 'api::imaging-session.imaging-session',
  frame: 'api::imaging-frame.imaging-frame',
  project: 'api::imaging-project.imaging-project',
};

const WEATHER_METRICS = [
  'temperature',
  'humidity',
  'dewPoint',
  'pressure',
  'cloudCover',
  'windSpeed',
  'windDirection',
  'windGust',
  'rainRate',
  'skyBrightness',
  'skyQuality',
  'skyTemperature',
  'starFWHM',
];

const FRAME_STATS = ['hfr', 'hfrStDev', 'stars', 'mean', 'median', 'stdDev'];

const MAX_WEATHER_SAMPLES = 300;
const MAX_ROOF_EVENTS = 200;
// Upper bound on subs one Seestar snapshot may add (a full night of 10 s subs
// is ~4000); guards against a nonsense frame index.
const MAX_SEESTAR_FRAME_INDEX = 5000;
const BACKFILL_SLACK_MS = 60 * 1000;

const CURRENTLY_IMAGING_POPULATE = [
  'target',
  'project',
  'acquisition',
  'preview.stack',
  'preview.single.stats',
  'environment.weather',
  'environment.observatory.roof',
];

module.exports = ({ strapi }) => {
  const log = strapi.log;
  const timeZone = process.env.OBSERVING_LOG_TIMEZONE || 'America/Chicago';
  const sampleMinutes = Number(process.env.OBSERVING_LOG_WEATHER_SAMPLE_MINUTES) || 5;
  // Local hours (in `timeZone`) between which weather is sampled even when
  // no frame has been taken yet: generous enough to cover sunset..sunrise
  // year-round; the website trims the display to the astronomical night.
  const windowStart = clampHour(process.env.OBSERVING_LOG_WEATHER_WINDOW_START, 17);
  const windowEnd = clampHour(process.env.OBSERVING_LOG_WEATHER_WINDOW_END, 9);
  const enabled = (process.env.OBSERVING_LOG_ENABLED || 'true') !== 'false';

  let queue = Promise.resolve();

  /**
   * Fire-and-forget entry point used by the document middleware.
   * `data` is the incoming write payload (may be undefined on publish).
   */
  function enqueue(data) {
    if (!enabled) return queue;
    queue = queue
      .then(() => ingest(data))
      .catch((err) => {
        log.error(`[observing-log] ingest failed: ${(err && err.message) || err}`);
      });
    return queue;
  }

  async function ingest(data) {
    const payload = hasUsefulData(data) ? data : await loadPublished();
    if (!payload) return { frame: null, weather: false };

    const frameResult = (await recordFrame(payload)) || (await recordSeestarSubs(payload));
    const weatherResult = await sampleWeather(payload);
    const roofResult = await recordRoof(payload);
    return { frame: frameResult, weather: weatherResult, roof: roofResult };
  }

  function hasUsefulData(data) {
    return Boolean(data && (data.preview || data.environment || data.activityLog || data.equipment));
  }

  async function loadPublished() {
    try {
      return await strapi.documents(UID.currentlyImaging).findFirst({
        status: 'published',
        populate: CURRENTLY_IMAGING_POPULATE,
      });
    } catch (err) {
      log.warn(`[observing-log] could not load currently-imaging: ${(err && err.message) || err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------------------

  async function recordFrame(payload) {
    const single = payload.preview && payload.preview.single;
    if (!single || !single.filename || !single.capturedAt) return null;

    const capturedAt = new Date(single.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) return null;

    const filename = String(single.filename).trim();
    const existing = await strapi.documents(UID.frame).findFirst({
      filters: { filename },
      fields: ['id', 'documentId'],
    });
    if (existing) return { created: false, documentId: existing.documentId };

    const night = nightFromFilename(filename) || nightFromDate(capturedAt, timeZone);
    if (!isIsoDate(night)) return null;

    const acquisition = payload.acquisition || {};
    const stack = payload.preview.stack || {};

    // The rig pushes after the save; the scheduler may already have moved to
    // the next target, so prefer sources tied to the frame itself.
    const targetName =
      targetFromFilename(filename) ||
      targetFromActivityLog(payload.activityLog, capturedAt) ||
      firstString(payload.target && payload.target.name, stack.target) ||
      'Unknown target';
    const context = targetContext(payload, targetName);
    const exposureSeconds = Math.max(0, Math.round(toNumber(single.exposureSeconds) || 0));
    const filter = firstString(single.filter, acquisition.activeFilter) || 'Unknown';
    const stats = single.stats || {};

    return storeFrame({ filename, capturedAt, night, targetName, context, filter, exposureSeconds, stats, acquisition });
  }

  /**
   * Seestar (seestar_alp feed): the scope keeps no sub files, so the sync
   * sends only the live stack plus `acquisition.currentFrameIndex`, the
   * firmware's stacked-frame count for the current run. Every new index
   * becomes one frame row named `seestar_<run start>_<index>`, so the
   * existing unique-filename idempotency applies. Snapshots arrive about once
   * a minute against 10-30 s subs, so the gap since the last stored index is
   * backfilled, with capture times spread evenly between the previous frame
   * (or the run start) and `acquisition.timestamp`, when the latest sub
   * completed. Dropped subs are not in the stacked count and are not logged.
   */
  async function recordSeestarSubs(payload) {
    const acquisition = payload.acquisition || {};
    const index = intOrNull(acquisition.currentFrameIndex);
    if (index === null || index < 1 || index > MAX_SEESTAR_FRAME_INDEX) return null;

    const stack = (payload.preview && payload.preview.stack) || {};
    const startedAt = validDate(acquisition.startedAt);
    // When the latest sub completed. The sync stamps acquisition.timestamp
    // only when it sees a new Stack event, so after a restart or reconnect it
    // can be missing or stale; the stack's own update time, then the
    // snapshot time, are the next best evidence. The first one at or after
    // the run start wins (a stale value from before this run is useless).
    const lastAt = [acquisition.timestamp, stack.updatedAtTime, payload.metaData && payload.metaData.lastUpdated]
      .map(validDate)
      .find((d) => d && startedAt && d >= startedAt);
    if (!startedAt || !lastAt) {
      warnOnce(
        `seestar-time:${acquisition.startedAt}`,
        `[observing-log] Seestar snapshot (frame ${index}) has no usable run start or frame time; subs not logged`
      );
      return null;
    }

    const targetName = firstString(payload.target && payload.target.name, stack.target);
    if (!targetName) return null;
    const exposureSeconds = Math.max(0, Math.round(toNumber(acquisition.exposureSeconds) || 0));
    if (exposureSeconds === 0) return null;

    const run = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const nameFor = (i) => `seestar_${run}_${String(i).padStart(4, '0')}`;
    const findFrame = (i) =>
      strapi.documents(UID.frame).findFirst({
        filters: { filename: nameFor(i) },
        fields: ['id', 'documentId', 'capturedAt'],
      });

    // Usual case: this index is already stored (repeat push, idle daytime push)
    if (await findFrame(index)) return { created: false, frames: 0 };

    // Stored frames for a run are always a contiguous 1..k, so find k by
    // binary search rather than one lookup per index.
    let lo = 0;
    let hi = index;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await findFrame(mid)) lo = mid;
      else hi = mid;
    }
    const previous = lo > 0 ? await findFrame(lo) : null;
    const previousAt = previous && previous.capturedAt ? new Date(previous.capturedAt) : null;
    const anchor = previousAt && previousAt > startedAt && previousAt < lastAt ? previousAt : startedAt;

    const filter = firstString(acquisition.activeFilter, stack.filter) || 'Unknown';
    const context = targetContext(payload, targetName);
    const span = lastAt.getTime() - anchor.getTime();
    const count = index - lo;
    let last = null;
    for (let i = lo + 1; i <= index; i++) {
      const capturedAt = new Date(anchor.getTime() + Math.round((span * (i - lo)) / count));
      const night = nightFromDate(capturedAt, timeZone);
      if (!isIsoDate(night)) continue;
      last = await storeFrame({
        filename: nameFor(i),
        capturedAt,
        night,
        targetName,
        context,
        filter,
        exposureSeconds,
        stats: {},
        acquisition,
      });
    }
    return last ? { ...last, frames: count } : null;
  }

  async function storeFrame({ filename, capturedAt, night, targetName, context, filter, exposureSeconds, stats, acquisition }) {
    const projectName = context.projectName;
    const nightDoc = await findOrCreateNight(night);
    const sessionDoc = await findOrCreateSession(nightDoc, night, targetName, context);

    const frame = await strapi.documents(UID.frame).create({
      data: {
        filename,
        capturedAt: capturedAt.toISOString(),
        nightDate: night,
        targetName,
        projectName,
        filter,
        exposureSeconds,
        gain: intOrNull(acquisition.gain),
        sensorTemperature: toNumber(acquisition.temperature),
        hfr: toNumber(stats.hfr),
        hfrStDev: toNumber(stats.hfrStDev),
        stars: toNumber(stats.stars),
        mean: toNumber(stats.mean),
        median: toNumber(stats.median),
        stdDev: toNumber(stats.stdDev),
        session: sessionDoc.documentId,
      },
    });

    const session = await bumpSession(sessionDoc, { capturedAt, filter, exposureSeconds, stats, context });
    await bumpProject(session, { capturedAt, filter, exposureSeconds, targetName, context });
    await bumpNight(nightDoc, { capturedAt, exposureSeconds });

    return { created: true, documentId: frame.documentId, night, targetName };
  }

  async function findOrCreateNight(night) {
    const found = await strapi.documents(UID.night).findFirst({ filters: { night } });
    if (found) return found;
    return strapi.documents(UID.night).create({
      data: {
        night,
        timezone: timeZone,
        frameCount: 0,
        integrationSeconds: 0,
        targetCount: 0,
        weatherSummary: {},
        weatherSamples: [],
      },
    });
  }

  async function findOrCreateSession(nightDoc, night, targetName, context) {
    const key = sessionKey(night, targetName);
    const found = await strapi.documents(UID.session).findFirst({
      filters: { sessionKey: key },
      populate: ['project'],
    });
    if (found) return found;

    const created = await strapi.documents(UID.session).create({
      data: {
        sessionKey: key,
        nightDate: night,
        night: nightDoc.documentId,
        targetName,
        projectName: context.projectName,
        ra: context.ra,
        dec: context.dec,
        frameCount: 0,
        integrationSeconds: 0,
        filters: {},
        stats: {},
      },
    });

    const targetCount = (toNumber(nightDoc.targetCount) || 0) + 1;
    await strapi.documents(UID.night).update({
      documentId: nightDoc.documentId,
      data: { targetCount },
    });
    nightDoc.targetCount = targetCount;

    return created;
  }

  async function bumpSession(sessionDoc, { capturedAt, filter, exposureSeconds, stats, context }) {
    const filters = { ...(sessionDoc.filters || {}) };
    const bucket = filters[filter] || { frames: 0, seconds: 0, exposureSeconds };
    filters[filter] = {
      frames: (toNumber(bucket.frames) || 0) + 1,
      seconds: (toNumber(bucket.seconds) || 0) + exposureSeconds,
      exposureSeconds,
    };

    const iso = capturedAt.toISOString();
    const data = {
      frameCount: (toNumber(sessionDoc.frameCount) || 0) + 1,
      integrationSeconds: (toNumber(sessionDoc.integrationSeconds) || 0) + exposureSeconds,
      firstFrameAt: earliest(sessionDoc.firstFrameAt, iso),
      lastFrameAt: latest(sessionDoc.lastFrameAt, iso),
      filters,
      stats: foldSummaries(sessionDoc.stats, stats, FRAME_STATS),
    };

    // Fill coordinates/project once a push whose target matches this frame arrives
    if (!sessionDoc.ra && context.ra) data.ra = context.ra;
    if (!sessionDoc.dec && context.dec) data.dec = context.dec;
    if (!sessionDoc.projectName && context.projectName) data.projectName = context.projectName;

    await strapi.documents(UID.session).update({ documentId: sessionDoc.documentId, data });
    return { ...sessionDoc, ...data };
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  /**
   * Keeps the project row in step with its sessions. A session already linked
   * to a project adds this one frame; a session not yet linked (its first
   * frame, or the project name only arrived on a later push) is attached and
   * folded in whole, so frames counted before the link are not lost.
   */
  async function bumpProject(session, { capturedAt, filter, exposureSeconds, targetName, context }) {
    const linkedId = relationDocumentId(session.project);
    if (linkedId) {
      const project = await strapi.documents(UID.project).findOne({ documentId: linkedId });
      if (!project) return null;
      const iso = capturedAt.toISOString();
      await strapi.documents(UID.project).update({
        documentId: project.documentId,
        data: {
          frameCount: (toNumber(project.frameCount) || 0) + 1,
          integrationSeconds: (toNumber(project.integrationSeconds) || 0) + exposureSeconds,
          firstFrameAt: earliest(project.firstFrameAt, iso),
          lastFrameAt: latest(project.lastFrameAt, iso),
          filters: bumpFilters(project.filters, filter, exposureSeconds),
          targetNames: addTarget(project.targetNames, targetName),
        },
      });
      return { attached: false, documentId: project.documentId };
    }

    const name = normaliseProjectName(session.projectName || context.projectName);
    if (!name) return null;
    const project = await findOrCreateProject(name);
    await strapi.documents(UID.project).update({
      documentId: project.documentId,
      data: foldSession(project, session),
    });
    await strapi.documents(UID.session).update({
      documentId: session.documentId,
      data: { project: project.documentId },
    });
    return { attached: true, documentId: project.documentId };
  }

  async function findOrCreateProject(name) {
    const found = await strapi.documents(UID.project).findFirst({ filters: { name } });
    if (found) return found;

    const base = slugify(name);
    let slug = base;
    for (let n = 2; await strapi.documents(UID.project).findFirst({ filters: { slug }, fields: ['id'] }); n++) {
      slug = `${base}-${n}`;
    }
    return strapi.documents(UID.project).create({
      data: { name, slug, projectStatus: 'active', ...EMPTY_TOTALS },
    });
  }

  /** A populated relation is an object, an unpopulated one may be an id string */
  function relationDocumentId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return typeof value.documentId === 'string' ? value.documentId : null;
  }

  async function bumpNight(nightDoc, { capturedAt, exposureSeconds }) {
    const iso = capturedAt.toISOString();
    await strapi.documents(UID.night).update({
      documentId: nightDoc.documentId,
      data: {
        frameCount: (toNumber(nightDoc.frameCount) || 0) + 1,
        integrationSeconds: (toNumber(nightDoc.integrationSeconds) || 0) + exposureSeconds,
        firstFrameAt: earliest(nightDoc.firstFrameAt, iso),
        lastFrameAt: latest(nightDoc.lastFrameAt, iso),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Weather
  // ---------------------------------------------------------------------------

  /**
   * Samples the weather-station reading into the night's row, at most once
   * per `sampleMinutes`. Inside the local night window the night row is
   * created if it does not exist yet, so the hours before the first frame
   * (and fully clouded-out nights) are recorded too. Outside the window only
   * nights that already have a row get samples, so idle days stay empty.
   */
  async function sampleWeather(payload) {
    const weather = payload.environment && payload.environment.weather;
    if (!weather || weather.connected === false || !weather.timestamp) return false;

    const at = new Date(weather.timestamp);
    if (Number.isNaN(at.getTime())) return false;

    // The reading's own timestamp decides the night; the last frame's
    // filename may be from a previous night when the rig is idle.
    const night = nightFromDate(at, timeZone);
    if (!isIsoDate(night)) return false;

    const inWindow = inNightWindow(hourInTimeZone(at, timeZone), windowStart, windowEnd);
    let nightDoc = await strapi.documents(UID.night).findFirst({ filters: { night } });
    if (!nightDoc) {
      if (!inWindow) return false;
      nightDoc = await findOrCreateNight(night);
    }

    if (nightDoc.lastWeatherAt) {
      const since = at.getTime() - new Date(nightDoc.lastWeatherAt).getTime();
      if (since < sampleMinutes * 60 * 1000) return false;
    }

    const sample = { t: at.toISOString() };
    for (const key of WEATHER_METRICS) {
      const n = toNumber(weather[key]);
      if (n !== null) sample[key] = n;
    }
    if (Object.keys(sample).length === 1) return false; // nothing but a timestamp

    const samples = Array.isArray(nightDoc.weatherSamples) ? [...nightDoc.weatherSamples] : [];
    samples.push(sample);
    if (samples.length > MAX_WEATHER_SAMPLES) {
      samples.splice(0, samples.length - MAX_WEATHER_SAMPLES);
    }

    await strapi.documents(UID.night).update({
      documentId: nightDoc.documentId,
      data: {
        weatherSummary: foldSummaries(nightDoc.weatherSummary, sample, WEATHER_METRICS),
        weatherSamples: samples,
        lastWeatherAt: sample.t,
      },
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Roof
  // ---------------------------------------------------------------------------

  /**
   * Records roof open/close transitions on the night row. Two sources:
   * activity-log lines ("Safety monitor: SAFE|UNSAFE" from NINA, "Roof
   * open|closed" from PFR Sentinel), and a device state, either
   * `equipment.safetyMonitor.isSafe` or `environment.observatory.roof.status`
   * (a change of state against the last stored event is a transition).
   * Events are deduplicated by timestamp; a night row is created inside the
   * local night window, as for weather. Returns the number of events added.
   */
  async function recordRoof(payload) {
    const fromLog = roofEventsFromActivityLog(payload.activityLog);

    // Device state: NINA's safety monitor `isSafe`, else the observatory roof
    // status PFR Sentinel reports for the Seestar rig ("Open" / "Closed").
    const monitor = payload.equipment && payload.equipment.safetyMonitor;
    const observatory = (payload.environment && payload.environment.observatory) || {};
    const roofOpen = roofOpenFromStatus(observatory.roof && observatory.roof.status);
    let stateSafe = null;
    let stateAt = payload.metaData && payload.metaData.lastUpdated;
    if (monitor && typeof monitor.isSafe === 'boolean') {
      stateSafe = monitor.isSafe;
    } else if (roofOpen !== null) {
      stateSafe = roofOpen;
      stateAt = observatory.updatedAt || stateAt;
    }
    const hasState = stateSafe !== null && stateAt && !Number.isNaN(new Date(stateAt).getTime());

    if (fromLog.length === 0 && !hasState) return 0;

    // Group by night so a log spanning midnight lands on the right rows
    const byNight = new Map();
    for (const ev of fromLog) {
      const night = nightFromDate(ev.t, timeZone);
      if (!isIsoDate(night)) continue;
      if (!byNight.has(night)) byNight.set(night, []);
      byNight.get(night).push(ev);
    }
    if (hasState) {
      const night = nightFromDate(stateAt, timeZone);
      if (isIsoDate(night)) {
        if (!byNight.has(night)) byNight.set(night, []);
        byNight.get(night).push({ t: new Date(stateAt).toISOString(), safe: stateSafe, fromState: true });
      }
    }

    let added = 0;
    for (const [night, events] of byNight) {
      const inWindow = events.some((ev) => inNightWindow(hourInTimeZone(ev.t, timeZone), windowStart, windowEnd));
      let nightDoc = await strapi.documents(UID.night).findFirst({ filters: { night } });
      if (!nightDoc) {
        if (!inWindow) continue;
        nightDoc = await findOrCreateNight(night);
      }

      const existing = Array.isArray(nightDoc.roofEvents) ? [...nightDoc.roofEvents] : [];
      const seen = new Set(existing.map((e) => e && e.t));
      let lastSafe = existing.length > 0 ? existing[existing.length - 1].safe : nightDoc.lastRoofSafe;
      let changed = false;

      for (const ev of events) {
        if (ev.fromState) {
          // Only a change of state is an event; the first reading seeds the state
          if (typeof lastSafe === 'boolean' && lastSafe === ev.safe) continue;
          if (typeof lastSafe !== 'boolean' && existing.length === 0) {
            lastSafe = ev.safe;
            changed = true; // remember the seed state without an event
            continue;
          }
        }
        if (seen.has(ev.t)) continue;
        existing.push({ t: ev.t, safe: ev.safe });
        seen.add(ev.t);
        lastSafe = ev.safe;
        added += 1;
        changed = true;
      }

      if (!changed) continue;
      existing.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      if (existing.length > MAX_ROOF_EVENTS) existing.splice(0, existing.length - MAX_ROOF_EVENTS);
      await strapi.documents(UID.night).update({
        documentId: nightDoc.documentId,
        data: { roofEvents: existing, lastRoofSafe: typeof lastSafe === 'boolean' ? lastSafe : null },
      });
    }
    return added;
  }

  // ---------------------------------------------------------------------------

  /**
   * Coordinates and project from the payload, but only when the payload's
   * current target is the one the frame was shot on. Otherwise they belong to
   * the next target and are left null to be filled by a later push.
   */
  function targetContext(payload, targetName) {
    const target = payload.target || {};
    const project = payload.project || {};
    if (!sameTarget(target.name, targetName)) {
      return { ra: null, dec: null, projectName: null };
    }
    return {
      ra: firstString(target.ra),
      dec: firstString(target.dec),
      projectName: firstString(project.name),
    };
  }

  /** A Date for a real timestamp; null for null/empty/invalid (new Date(null) is 1970) */
  function validDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Idle snapshots repeat every minute; say each problem once per process
  const warned = new Set();
  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn(message);
  }

  function firstString(...values) {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  function clampHour(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
  }

  function intOrNull(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n);
  }

  // ---------------------------------------------------------------------------
  // Backfill
  // ---------------------------------------------------------------------------

  /**
   * Replays finished Seestar runs that were imaged before the live feed sent
   * a frame count (NINA Data Sync 1.2.11). Each run
   * `{ target, startedAt, endedAt, frames, filter, exposureSeconds, gain?, ra?, dec?, project? }`
   * goes through the live Seestar path as one synthetic snapshot, so it gets
   * the same `seestar_<startedAt>_<index>` rows and is idempotent: replaying
   * it adds nothing. Frames the log already holds for that target inside the
   * run's window (1.2.11 uploaded a few real subs) are subtracted so they are
   * not counted twice. Serialised on the ingest queue; never throws.
   */
  async function backfillRuns(runs) {
    const results = [];
    for (const run of Array.isArray(runs) ? runs : []) {
      try {
        results.push(await backfillRun(run));
      } catch (err) {
        log.error(`[observing-log] backfill of ${run && run.target} failed: ${(err && err.message) || err}`);
        results.push({ target: run && run.target, error: true });
      }
    }
    return results;
  }

  async function backfillRun(run) {
    const startedAt = new Date(run.startedAt);
    const endedAt = new Date(run.endedAt);
    const frames = intOrNull(run.frames);
    if (!run.target || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || !frames) {
      return { target: run.target || null, skipped: 'invalid' };
    }

    // Real subs already logged during the run. The scope images one thing at a
    // time, so match on the time window alone: 1.2.11 logged them under name
    // variants ("SH2-157", "M 31 (mosaic)") and sometimes under the next
    // target. A minute of slack covers save-time vs exposure-end skew.
    const from = startedAt.getTime() - BACKFILL_SLACK_MS;
    const to = endedAt.getTime() + BACKFILL_SLACK_MS;
    const nights = new Set([nightFromDate(startedAt, timeZone), nightFromDate(endedAt, timeZone)]);
    const real = [];
    for (const nightDate of nights) {
      const rows = await strapi.documents(UID.frame).findMany({
        filters: { nightDate },
        fields: ['filename', 'targetName', 'capturedAt'],
        limit: 10000,
      });
      for (const f of rows) {
        if (!f || String(f.filename).startsWith('seestar_')) continue;
        const t = new Date(f.capturedAt).getTime();
        if (t >= from && t <= to) real.push(f);
      }
    }
    const overlap = real.length;
    const count = frames - overlap;
    if (count < 1) return { target: run.target, skipped: 'already logged', overlap };

    // Keep one session per run: reuse the name the real subs were logged under
    const targetName = overlap > 0 ? mostCommon(real.map((f) => f.targetName)) || run.target : run.target;

    const result = await recordSeestarSubs({
      acquisition: {
        startedAt: startedAt.toISOString(),
        timestamp: endedAt.toISOString(),
        currentFrameIndex: count,
        activeFilter: run.filter || null,
        exposureSeconds: run.exposureSeconds,
        gain: run.gain === undefined ? null : run.gain,
      },
      target: { name: targetName, ra: run.ra || null, dec: run.dec || null },
      project: run.project ? { name: run.project } : {},
      preview: { type: 'stack', stack: {} },
    });
    return { target: targetName, startedAt: startedAt.toISOString(), overlap, added: result ? result.frames : 0 };
  }

  function mostCommon(values) {
    const counts = new Map();
    for (const v of values) if (typeof v === 'string' && v.trim()) counts.set(v, (counts.get(v) || 0) + 1);
    let best = null;
    for (const [v, n] of counts) if (best === null || n > counts.get(best)) best = v;
    return best;
  }

  /** Runs the backfill on the ingest queue so it never races live pushes */
  function enqueueBackfill(runs) {
    const done = queue.then(() => backfillRuns(runs));
    queue = done.catch((err) => {
      log.error(`[observing-log] backfill failed: ${(err && err.message) || err}`);
    });
    return done;
  }

  return { enqueue, ingest, backfillRuns, enqueueBackfill, findOrCreateProject, UID, WEATHER_METRICS, FRAME_STATS };
};
