'use strict';

/**
 * Observing-log ingest tests. Run with:  node --test tests/
 *
 * Uses an in-memory stand-in for `strapi.documents()` so the logic can be
 * exercised without a database. The payload below is a trimmed copy of a real
 * currently-imaging push from the rig.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const night = require('../src/api/observing-log/lib/night');
const makeIngest = require('../src/api/observing-log/services/ingest');

// ---------------------------------------------------------------------------
// In-memory documents API
// ---------------------------------------------------------------------------

// Mirrors the `unique: true` attributes in the three schemas
const UNIQUE_BY_UID = {
  'api::observing-night.observing-night': 'night',
  'api::imaging-session.imaging-session': 'sessionKey',
  'api::imaging-frame.imaging-frame': 'filename',
};

function makeFakeStrapi() {
  const store = new Map(); // uid -> array of docs
  let nextId = 1;

  const matches = (doc, filters) =>
    Object.entries(filters || {}).every(([k, v]) => doc[k] === v);

  const documents = (uid) => {
    if (!store.has(uid)) store.set(uid, []);
    const rows = store.get(uid);
    return {
      async findFirst({ filters } = {}) {
        const found = rows.find((r) => matches(r, filters));
        return found ? { ...found } : null;
      },
      async findMany({ filters } = {}) {
        return rows.filter((r) => matches(r, filters)).map((r) => ({ ...r }));
      },
      async create({ data }) {
        const uniqueKey = UNIQUE_BY_UID[uid];
        if (uniqueKey && data[uniqueKey] !== undefined) {
          if (rows.some((r) => r[uniqueKey] === data[uniqueKey])) {
            throw new Error(`unique violation on ${uid}.${uniqueKey}`);
          }
        }
        const doc = { id: nextId, documentId: `doc-${nextId}`, ...data };
        nextId += 1;
        rows.push(doc);
        return { ...doc };
      },
      async update({ documentId, data }) {
        const doc = rows.find((r) => r.documentId === documentId);
        if (!doc) throw new Error(`no ${uid} ${documentId}`);
        Object.assign(doc, data);
        return { ...doc };
      },
    };
  };

  const logs = { error: [], warn: [] };
  return {
    documents,
    store,
    logs,
    log: {
      error: (m) => logs.error.push(m),
      warn: (m) => logs.warn.push(m),
      info: () => {},
      debug: () => {},
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture: what the rig pushes (trimmed)
// ---------------------------------------------------------------------------

function pushPayload({ seq, filter = 'Red', capturedAt, weatherAt, target = 'Trifid Nebula' }) {
  return {
    metaData: { lastUpdated: capturedAt, ninaConnected: true },
    acquisition: {
      startedAt: capturedAt,
      activeFilter: filter,
      gain: 100,
      temperature: -5,
      timestamp: capturedAt,
      exposureSeconds: 240,
    },
    target: { name: target, ra: '18:05:09', dec: "-23° 52' 35\"" },
    project: { name: 'M8 M20 Duo', phase: 'acquiring', exposurePlans: [] },
    environment: {
      weather: {
        connected: true,
        name: 'SFRO Weather Station',
        timestamp: weatherAt || capturedAt,
        temperature: 30,
        humidity: 52.4,
        dewPoint: 19.1,
        pressure: 957.2,
        cloudCover: null,
        windSpeed: 1,
        skyTemperature: 7.7,
        averagePeriod: 0,
      },
    },
    preview: {
      type: 'stack',
      stack: { frameCount: 2, filter, target, updatedAtTime: capturedAt },
      single: {
        capturedAt,
        filter,
        exposureSeconds: 240,
        filename: `LIGHT_2026-09-28_22-15-03_SUBJECT_${target}_NIGHT_2026-09-28_FILTER_${filter}_TEMP_-5.00_EXP_240.00s_${String(seq).padStart(4, '0')}_ROT_4.92.fits`,
        stats: { hfr: 1.48, hfrStDev: 0.19, stars: 502, mean: 3457.19, median: 3438, stdDev: 498.09 },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('nightFromFilename reads the NINA _NIGHT_ token', () => {
  assert.equal(
    night.nightFromFilename('LIGHT_2026-09-28_22-15-03_SUBJECT_X_NIGHT_2026-09-28_FILTER_Red.fits'),
    '2026-09-28'
  );
  assert.equal(night.nightFromFilename('no token here.fits'), null);
  assert.equal(night.nightFromFilename(undefined), null);
});

test('nightFromDate rolls over at local noon', () => {
  // 03:19 UTC on the 29th is 22:19 CDT on the 28th -> night of the 28th
  assert.equal(night.nightFromDate('2026-09-29T03:19:06.374Z', 'America/Chicago'), '2026-09-28');
  // 16:00 UTC on the 29th is 11:00 CDT -> still the night of the 28th
  assert.equal(night.nightFromDate('2026-09-29T16:00:00Z', 'America/Chicago'), '2026-09-28');
  // 17:30 UTC on the 29th is 12:30 CDT -> night of the 29th
  assert.equal(night.nightFromDate('2026-09-29T17:30:00Z', 'America/Chicago'), '2026-09-29');
  assert.equal(night.nightFromDate('garbage', 'America/Chicago'), null);
});

test('foldSummary keeps min/max/mean incrementally', () => {
  let s = night.foldSummary(null, 10);
  s = night.foldSummary(s, 20);
  s = night.foldSummary(s, 'not a number');
  s = night.foldSummary(s, 30);
  assert.deepEqual(s, { min: 10, max: 30, sum: 60, count: 3, mean: 20 });
});

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

test('first push creates night, session and frame', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const result = await ingest(pushPayload({ seq: 46, capturedAt: '2026-09-29T03:19:06.374Z' }));

  assert.equal(result.frame.created, true);
  assert.equal(result.frame.night, '2026-09-28');
  assert.equal(result.weather, true);

  const nights = strapi.store.get(UID.night);
  const sessions = strapi.store.get(UID.session);
  const frames = strapi.store.get(UID.frame);
  assert.equal(nights.length, 1);
  assert.equal(sessions.length, 1);
  assert.equal(frames.length, 1);

  assert.equal(nights[0].night, '2026-09-28');
  assert.equal(nights[0].frameCount, 1);
  assert.equal(nights[0].integrationSeconds, 240);
  assert.equal(nights[0].targetCount, 1);
  assert.equal(nights[0].weatherSamples.length, 1);
  assert.equal(nights[0].weatherSummary.temperature.mean, 30);
  assert.equal(nights[0].weatherSummary.cloudCover, undefined, 'null readings are not summarised');

  assert.equal(sessions[0].sessionKey, '2026-09-28|trifid nebula');
  assert.equal(sessions[0].night, nights[0].documentId);
  assert.deepEqual(sessions[0].filters, { Red: { frames: 1, seconds: 240, exposureSeconds: 240 } });
  assert.equal(sessions[0].stats.hfr.mean, 1.48);

  assert.equal(frames[0].session, sessions[0].documentId);
  assert.equal(frames[0].gain, 100);
  assert.equal(frames[0].sensorTemperature, -5);
});

test('re-sending the same frame is a no-op', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });
  const payload = pushPayload({ seq: 46, capturedAt: '2026-09-29T03:19:06.374Z' });

  await ingest(payload);
  const second = await ingest(payload);

  assert.equal(second.frame.created, false);
  assert.equal(second.weather, false, 'weather within the sample window is skipped');
  assert.equal(strapi.store.get(UID.frame).length, 1);
  assert.equal(strapi.store.get(UID.night)[0].frameCount, 1);
});

test('frames accumulate per filter and weather samples respect the interval', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(pushPayload({ seq: 1, filter: 'Blue', capturedAt: '2026-09-29T03:05:42Z' }));
  await ingest(pushPayload({ seq: 2, filter: 'Red', capturedAt: '2026-09-29T03:14:36Z' }));
  await ingest(pushPayload({ seq: 3, filter: 'Red', capturedAt: '2026-09-29T03:19:06Z' }));

  const session = strapi.store.get(UID.session)[0];
  assert.equal(session.frameCount, 3);
  assert.equal(session.integrationSeconds, 720);
  assert.deepEqual(session.filters, {
    Blue: { frames: 1, seconds: 240, exposureSeconds: 240 },
    Red: { frames: 2, seconds: 480, exposureSeconds: 240 },
  });
  assert.equal(session.firstFrameAt, '2026-09-29T03:05:42.000Z');
  assert.equal(session.lastFrameAt, '2026-09-29T03:19:06.000Z');

  const nightRow = strapi.store.get(UID.night)[0];
  // 03:05 sample, 03:14 skipped (<10 min), 03:19 stored (>10 min since 03:05)
  assert.equal(nightRow.weatherSamples.length, 2);
  assert.equal(nightRow.weatherSummary.temperature.count, 2);
});

test('two targets on one night become two sessions on one night row', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(pushPayload({ seq: 1, capturedAt: '2026-09-29T02:00:00Z', target: 'Trifid Nebula' }));
  await ingest(pushPayload({ seq: 1, capturedAt: '2026-09-29T05:00:00Z', target: 'Lagoon Nebula' }));

  assert.equal(strapi.store.get(UID.night).length, 1);
  assert.equal(strapi.store.get(UID.night)[0].targetCount, 2);
  assert.equal(strapi.store.get(UID.session).length, 2);
});

test('a push with no frame and no known night stores nothing', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T02:00:00Z' });
  delete payload.preview;

  const result = await ingest(payload);
  assert.equal(result.frame, null);
  assert.equal(result.weather, false);
  assert.equal(strapi.store.get(UID.night).length, 0);
});

test('falls back to the timezone rollover when the filename has no night token', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T03:19:06Z' });
  payload.preview.single.filename = 'LIGHT_0001.fits';

  const result = await ingest(payload);
  assert.equal(result.frame.night, '2026-09-28');
  assert.equal(strapi.store.get(UID.night)[0].night, '2026-09-28');
});

test('enqueue never throws and logs failures', async () => {
  const strapi = makeFakeStrapi();
  strapi.documents = () => {
    throw new Error('db down');
  };
  const { enqueue } = makeIngest({ strapi });

  await enqueue(pushPayload({ seq: 1, capturedAt: '2026-09-29T03:19:06Z' }));
  assert.equal(strapi.logs.error.length, 1);
  assert.match(strapi.logs.error[0], /db down/);
});
