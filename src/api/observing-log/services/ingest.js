'use strict';

/**
 * Observing-log ingest.
 *
 * The rig (NINA) rewrites the `currently-imaging` single type on every event,
 * so nothing is kept historically. This service is called from the Document
 * Service middleware registered in `src/index.js` each time that document is
 * written, and turns the transient payload into durable rows:
 *
 *   imaging-frame    one per saved light frame (idempotent on NINA filename)
 *   imaging-session  one per target per observing night (aggregates)
 *   observing-night  one per night: totals + weather-station summary/samples
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
  sameTarget,
  isIsoDate,
  toNumber,
  foldSummaries,
  earliest,
  latest,
  sessionKey,
} = require('../lib/night');

const UID = {
  currentlyImaging: 'api::currently-imaging.currently-imaging',
  night: 'api::observing-night.observing-night',
  session: 'api::imaging-session.imaging-session',
  frame: 'api::imaging-frame.imaging-frame',
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

const CURRENTLY_IMAGING_POPULATE = [
  'target',
  'project',
  'acquisition',
  'preview.single.stats',
  'environment.weather',
];

module.exports = ({ strapi }) => {
  const log = strapi.log;
  const timeZone = process.env.OBSERVING_LOG_TIMEZONE || 'America/Chicago';
  const sampleMinutes = Number(process.env.OBSERVING_LOG_WEATHER_SAMPLE_MINUTES) || 10;
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

    const frameResult = await recordFrame(payload);
    const weatherResult = await sampleWeather(payload);
    return { frame: frameResult, weather: weatherResult };
  }

  function hasUsefulData(data) {
    return Boolean(data && (data.preview || data.environment));
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
    const projectName = context.projectName;
    const exposureSeconds = Math.max(0, Math.round(toNumber(single.exposureSeconds) || 0));
    const filter = firstString(single.filter, acquisition.activeFilter) || 'Unknown';
    const stats = single.stats || {};

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

    await bumpSession(sessionDoc, { capturedAt, filter, exposureSeconds, stats, context });
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
    const found = await strapi.documents(UID.session).findFirst({ filters: { sessionKey: key } });
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
   * Samples the weather-station reading into the current night's row, at
   * most once per `sampleMinutes`. Only nights that already have a frame get
   * samples, so the log does not fill up with rows for idle days.
   */
  async function sampleWeather(payload) {
    const weather = payload.environment && payload.environment.weather;
    if (!weather || weather.connected === false || !weather.timestamp) return false;

    const at = new Date(weather.timestamp);
    if (Number.isNaN(at.getTime())) return false;

    const single = payload.preview && payload.preview.single;
    const night =
      nightFromFilename(single && single.filename) || nightFromDate(at, timeZone);
    if (!isIsoDate(night)) return false;

    const nightDoc = await strapi.documents(UID.night).findFirst({ filters: { night } });
    if (!nightDoc) return false;

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

  function firstString(...values) {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  function intOrNull(value) {
    const n = toNumber(value);
    return n === null ? null : Math.round(n);
  }

  return { enqueue, ingest, UID, WEATHER_METRICS, FRAME_STATS };
};
