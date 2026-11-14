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
const project = require('../src/api/observing-log/lib/project');
const makeIngest = require('../src/api/observing-log/services/ingest');
const makeProjects = require('../src/api/observing-log/services/projects');

// ---------------------------------------------------------------------------
// In-memory documents API
// ---------------------------------------------------------------------------

// Mirrors the `unique: true` attributes in the three schemas
const UNIQUE_BY_UID = {
  'api::observing-night.observing-night': 'night',
  'api::imaging-session.imaging-session': 'sessionKey',
  'api::imaging-frame.imaging-frame': 'filename',
  'api::imaging-project.imaging-project': 'name',
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
      async findMany({ filters, start = 0, limit } = {}) {
        const all = rows.filter((r) => matches(r, filters)).map((r) => ({ ...r }));
        return limit === undefined ? all.slice(start) : all.slice(start, start + limit);
      },
      async findOne({ documentId }) {
        const found = rows.find((r) => r.documentId === documentId);
        return found ? { ...found } : null;
      },
      async count({ filters } = {}) {
        return rows.filter((r) => matches(r, filters)).length;
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
  const apiTokens = [];
  const services = {
    'admin::api-token': {
      async list() {
        return apiTokens.map((t) => ({ ...t, permissions: [...t.permissions] }));
      },
      async update(id, attrs) {
        const token = apiTokens.find((t) => t.id === id);
        if (!token) throw new Error(`no token ${id}`);
        if (attrs.permissions) token.permissions = [...attrs.permissions];
        return { ...token };
      },
    },
  };
  return {
    documents,
    store,
    logs,
    apiTokens,
    service: (name) => services[name],
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

function pushPayload({
  seq,
  filter = 'Red',
  capturedAt,
  weatherAt,
  target = 'Trifid Nebula',
  // The target the rig has *moved on to* by the time it pushes (defaults to
  // the frame's own target, i.e. no switch)
  currentTarget = target,
  project = 'M8 M20 Duo',
}) {
  return {
    metaData: { lastUpdated: capturedAt, ninaConnected: true },
    activityLog: [
      { timestamp: capturedAt, message: `Image saved: ${target} (${filter}, 240s, -5°C)`, level: 'info' },
    ],
    acquisition: {
      startedAt: capturedAt,
      activeFilter: filter,
      gain: 100,
      temperature: -5,
      timestamp: capturedAt,
      exposureSeconds: 240,
    },
    target: { name: currentTarget, ra: '18:05:09', dec: "-23° 52' 35\"" },
    project: { name: project, phase: 'acquiring', exposurePlans: [] },
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
  assert.equal(second.weather, false, 'weather within the sample interval is skipped');
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
  // 03:05 stored, 03:14 stored (9 min later), 03:19 skipped (4.5 min after 03:14)
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

test('a weather-only push inside the night window creates the night row', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // 02:00Z = 21:00 CDT on the 28th: inside the 17:00-09:00 window
  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T02:00:00Z' });
  delete payload.preview;

  const result = await ingest(payload);
  assert.equal(result.frame, null);
  assert.equal(result.weather, true);
  const nights = strapi.store.get(UID.night);
  assert.equal(nights.length, 1);
  assert.equal(nights[0].night, '2026-09-28');
  assert.equal(nights[0].frameCount, 0, 'a clouded-out night has a row but no frames');
  assert.equal(nights[0].weatherSamples.length, 1);
});

test('a weather-only push outside the night window stores nothing', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // 18:00Z = 13:00 CDT: daytime
  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T18:00:00Z' });
  delete payload.preview;

  const result = await ingest(payload);
  assert.equal(result.weather, false);
  assert.equal(strapi.store.get(UID.night).length, 0);
});

test('weather night comes from the reading, not a stale frame filename', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // Frame from the night of the 28th...
  await ingest(pushPayload({ seq: 1, capturedAt: '2026-09-29T03:00:00Z' }));
  // ...still in the preview the next evening while the rig idles at 21:00 CDT on the 29th
  const idle = pushPayload({ seq: 1, capturedAt: '2026-09-29T03:00:00Z', weatherAt: '2026-09-30T02:00:00Z' });
  await ingest(idle);

  const nights = strapi.store.get(UID.night).map((n) => n.night).sort();
  assert.deepEqual(nights, ['2026-09-28', '2026-09-29']);
});

test('a frame pushed after the scheduler switched target stays with its own target', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // Real case from 2026-09-29 03:39Z: last Trifid sub saved, push already
  // carries target "NGC 6992 Panel 1" / project "Eastern Veil Nebula".
  const result = await ingest(
    pushPayload({
      seq: 51,
      filter: 'Green',
      capturedAt: '2026-09-29T03:39:33.384Z',
      target: 'Trifid Nebula',
      currentTarget: 'NGC 6992 Panel 1',
      project: 'Eastern Veil Nebula',
    })
  );

  assert.equal(result.frame.targetName, 'Trifid Nebula');
  const sessions = strapi.store.get(UID.session);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionKey, '2026-09-28|trifid nebula');
  assert.equal(sessions[0].projectName, null, 'project of the *next* target must not be copied');
  assert.equal(sessions[0].ra, null);
  assert.equal(strapi.store.get(UID.frame)[0].projectName, null);

  // A later push whose current target matches fills the gaps
  await ingest(
    pushPayload({ seq: 52, filter: 'Green', capturedAt: '2026-09-29T03:43:40Z', target: 'Trifid Nebula' })
  );
  assert.equal(sessions[0].projectName, 'M8 M20 Duo');
  assert.equal(sessions[0].ra, '18:05:09');
  assert.equal(sessions[0].frameCount, 2);
});

test('target falls back to the activity log, then the payload, when the filename lacks a subject', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const viaLog = pushPayload({ seq: 1, capturedAt: '2026-09-29T03:19:06Z', currentTarget: 'Next Target' });
  viaLog.preview.single.filename = 'LIGHT_NIGHT_2026-09-28_0001.fits';
  await ingest(viaLog);
  assert.equal(strapi.store.get(UID.frame)[0].targetName, 'Trifid Nebula');

  const viaPayload = pushPayload({ seq: 2, capturedAt: '2026-09-29T03:23:10Z', currentTarget: 'Next Target' });
  viaPayload.preview.single.filename = 'LIGHT_NIGHT_2026-09-28_0002.fits';
  viaPayload.activityLog = [];
  await ingest(viaPayload);
  assert.equal(strapi.store.get(UID.frame)[1].targetName, 'Next Target');
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

test('roof transitions from the activity log are stored once per timestamp', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const first = pushPayload({ seq: 1, capturedAt: '2026-09-29T03:19:06Z' });
  first.activityLog.push(
    { timestamp: '2026-09-29T01:05:00Z', message: 'Safety monitor: SAFE', level: 'info' },
    { timestamp: '2026-09-29T04:37:50.541Z', message: 'Safety monitor: UNSAFE', level: 'warning' }
  );
  const result = await ingest(first);
  assert.equal(result.roof, 2);

  // Same log again (the rig re-sends the last 25 lines on every push)
  const again = await ingest(first);
  assert.equal(again.roof, 0);

  const night = strapi.store.get(UID.night)[0];
  assert.deepEqual(night.roofEvents, [
    { t: '2026-09-29T01:05:00.000Z', safe: true },
    { t: '2026-09-29T04:37:50.541Z', safe: false },
  ]);
  assert.equal(night.lastRoofSafe, false);
});

test('a roof line alone creates the night row inside the window', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T01:00:00Z' });
  delete payload.preview;
  delete payload.environment;
  payload.activityLog = [{ timestamp: '2026-09-29T01:00:00Z', message: 'Safety monitor: SAFE', level: 'info' }];

  const result = await ingest(payload);
  assert.equal(result.roof, 1);
  assert.equal(strapi.store.get(UID.night)[0].night, '2026-09-28');
});

test('an isSafe device state records only changes', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const make = (at, safe) => {
    const p = pushPayload({ seq: 1, capturedAt: at });
    p.activityLog = [];
    p.metaData.lastUpdated = at;
    p.equipment = { safetyMonitor: { name: 'Building 8', connected: true, isSafe: safe } };
    return p;
  };

  await ingest(make('2026-09-29T01:00:00Z', true)); // seeds the state, no event
  await ingest(make('2026-09-29T01:05:00Z', true)); // unchanged
  const closed = await ingest(make('2026-09-29T04:37:50Z', false)); // transition
  assert.equal(closed.roof, 1);

  const night = strapi.store.get(UID.night)[0];
  assert.deepEqual(night.roofEvents, [{ t: '2026-09-29T04:37:50.000Z', safe: false }]);
  assert.equal(night.lastRoofSafe, false);
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

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

test('slugify makes stable ASCII slugs', () => {
  assert.equal(project.slugify('The Butterfly Nebula'), 'the-butterfly-nebula');
  assert.equal(project.slugify('Markarian\u2019s Chain'), 'markarians-chain');
  assert.equal(project.slugify('  M8 M20 Duo '), 'm8-m20-duo');
  assert.equal(project.slugify('!!!'), 'project');
});

test('first frame creates the project and links the session', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(pushPayload({ seq: 46, capturedAt: '2026-09-29T03:19:06.374Z' }));
  await ingest(pushPayload({ seq: 47, filter: 'Blue', capturedAt: '2026-09-29T03:24:06.374Z' }));

  const projects = strapi.store.get(UID.project);
  const sessions = strapi.store.get(UID.session);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'M8 M20 Duo');
  assert.equal(projects[0].slug, 'm8-m20-duo');
  assert.equal(projects[0].status, 'active');
  assert.equal(projects[0].frameCount, 2, 'the attach folds the first frame, the second bumps');
  assert.equal(projects[0].integrationSeconds, 480);
  assert.equal(projects[0].sessionCount, 1);
  assert.deepEqual(projects[0].targetNames, ['Trifid Nebula']);
  assert.deepEqual(projects[0].filters, {
    Red: { frames: 1, seconds: 240, exposureSeconds: 240 },
    Blue: { frames: 1, seconds: 240, exposureSeconds: 240 },
  });
  assert.equal(projects[0].firstFrameAt, '2026-09-29T03:19:06.374Z');
  assert.equal(projects[0].lastFrameAt, '2026-09-29T03:24:06.374Z');
  assert.equal(sessions[0].project, projects[0].documentId);
});

test('a session whose project name arrives late is folded in whole', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // Two frames pushed while the scheduler had already moved on: no project known
  await ingest(
    pushPayload({ seq: 51, capturedAt: '2026-09-29T03:39:33Z', currentTarget: 'NGC 6992 Panel 1', project: 'Eastern Veil Nebula' })
  );
  await ingest(
    pushPayload({ seq: 52, capturedAt: '2026-09-29T03:43:40Z', currentTarget: 'NGC 6992 Panel 1', project: 'Eastern Veil Nebula' })
  );
  assert.equal((strapi.store.get(UID.project) || []).length, 0, 'no project until the name is known');

  // The matching push attaches the session and counts the earlier frames too
  await ingest(pushPayload({ seq: 53, capturedAt: '2026-09-29T03:47:00Z' }));
  const projects = strapi.store.get(UID.project);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'M8 M20 Duo');
  assert.equal(projects[0].frameCount, 3);
  assert.equal(projects[0].integrationSeconds, 720);
  assert.equal(projects[0].sessionCount, 1);

  // And from then on it is bumped one frame at a time
  await ingest(pushPayload({ seq: 54, capturedAt: '2026-09-29T03:51:00Z' }));
  assert.equal(projects[0].frameCount, 4);
});

test('mosaic panels on one night are one project with two sessions', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(pushPayload({ seq: 1, capturedAt: '2026-09-29T02:00:00Z', target: 'NGC 6992 Panel 1', project: 'Eastern Veil Nebula' }));
  await ingest(pushPayload({ seq: 2, capturedAt: '2026-09-29T03:00:00Z', target: 'NGC 6992 Panel 2', project: 'Eastern Veil Nebula' }));
  await ingest(pushPayload({ seq: 3, capturedAt: '2026-09-29T04:00:00Z', target: 'NGC 6992 Panel 2', project: 'Eastern Veil Nebula' }));

  const projects = strapi.store.get(UID.project);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].sessionCount, 2);
  assert.equal(projects[0].frameCount, 3);
  assert.deepEqual(projects[0].targetNames, ['NGC 6992 Panel 1', 'NGC 6992 Panel 2']);
  assert.equal(strapi.store.get(UID.session).length, 2);
});

test('rebuild derives projects from existing sessions, links them and seeds the portfolio once', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });
  const projects = makeProjects({ strapi });

  // History written before the project type existed: sessions with a
  // projectName but no project relation, and a published portfolio entry.
  // (The fixture filename pins every frame to one night, so IC 1318 is one
  // session with two frames.)
  await ingest(pushPayload({ seq: 1, capturedAt: '2026-07-01T04:00:00Z', target: 'IC 1318', project: 'The Butterfly Nebula' }));
  await ingest(pushPayload({ seq: 2, capturedAt: '2026-07-02T04:00:00Z', target: 'IC 1318', project: 'The Butterfly Nebula' }));
  await ingest(pushPayload({ seq: 3, capturedAt: '2026-07-02T05:00:00Z', target: 'M 31', project: 'Andromeda Galaxy' }));
  strapi.store.set(UID.project, []);
  for (const s of strapi.store.get(UID.session)) delete s.project;
  await strapi.documents(projects.UID.portfolio).create({
    data: { slug: 'a-butterfly-divided-by-dust', title: 'A Butterfly Divided by Dust' },
  });

  const first = await projects.bootstrap();
  assert.deepEqual(first, { projects: 2, created: 2, relinked: 2, seeded: 1, sessions: 2 });

  const rows = strapi.store.get(UID.project).sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(rows[0].name, 'Andromeda Galaxy');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].portfolioEntries, undefined);
  assert.equal(rows[1].name, 'The Butterfly Nebula');
  assert.equal(rows[1].status, 'complete');
  assert.deepEqual(rows[1].portfolioEntries, [strapi.store.get(projects.UID.portfolio)[0].documentId]);
  assert.equal(rows[1].frameCount, 2);
  assert.equal(rows[1].sessionCount, 1);
  assert.equal(rows[1].firstFrameAt, '2026-07-01T04:00:00.000Z');
  assert.ok(strapi.store.get(UID.session).every((s) => typeof s.project === 'string'));

  // Once rows exist the bootstrap is a no-op, and a forced rebuild never re-seeds
  assert.equal(await projects.bootstrap(), null);
  await strapi.documents(UID.project).update({ documentId: rows[1].documentId, data: { status: 'paused', portfolioEntries: [] } });
  const again = await projects.rebuild({ seed: true });
  assert.equal(again.created, 0);
  assert.equal(again.seeded, 0);
  assert.equal(rows[1].status, 'paused', 'admin edits survive a rebuild');
  assert.equal(rows[1].frameCount, 2, 'totals are recomputed, not doubled');
});

test('custom API tokens that read sessions are granted read on projects, once', async () => {
  const strapi = makeFakeStrapi();
  const projects = makeProjects({ strapi });
  strapi.apiTokens.push(
    { id: 1, name: 'website', type: 'custom', permissions: ['api::imaging-session.imaging-session.find', 'api::observing-night.observing-night.find'] },
    { id: 2, name: 'other', type: 'custom', permissions: ['api::post.post.find'] },
    { id: 3, name: 'full', type: 'full-access', permissions: [] }
  );

  assert.equal(await projects.grantTokenAccess(), 1);
  assert.deepEqual(strapi.apiTokens[0].permissions, [
    'api::imaging-session.imaging-session.find',
    'api::observing-night.observing-night.find',
    'api::imaging-project.imaging-project.find',
    'api::imaging-project.imaging-project.findOne',
  ]);
  assert.deepEqual(strapi.apiTokens[1].permissions, ['api::post.post.find'], 'unrelated tokens are untouched');
  assert.equal(await projects.grantTokenAccess(), 0, 'second run is a no-op');

  // bootstrap survives the admin service being unavailable
  await strapi.documents(projects.UID.project).create({ data: { name: 'x', slug: 'x', status: 'active' } });
  strapi.service = () => { throw new Error('admin not ready'); };
  assert.equal(await projects.bootstrap(), null, 'rows exist, so no rebuild either');
  assert.equal(strapi.logs.error.length, 1);
  assert.match(strapi.logs.error[0], /token grant failed/);
});

// ---------------------------------------------------------------------------
// Seestar (seestar_alp feed): no sub files, only the live stack and a count
// ---------------------------------------------------------------------------

/** Shaped like the 14 Nov 2026 Sh2-171 snapshots from NINA Data Sync 1.2.12 */
function seestarPayload({ index, at, startedAt = '2026-11-14T05:35:33.197Z', roof, activityLog = [] }) {
  return {
    metaData: { lastUpdated: at, ninaConnected: false },
    activityLog,
    acquisition: {
      startedAt,
      activeFilter: 'LP',
      exposureSeconds: 30,
      gain: 200,
      temperature: null,
      timestamp: at,
      currentFrameIndex: index,
      byFilter: { LP: { capturedFrames: 464 + index } },
    },
    target: { name: 'Sh2-171', ra: '00h 05m 04.6s', dec: "+67° 26' 25\"" },
    environment: {
      observatory: roof ? { source: 'PFR Sentinel', updatedAt: at, roof: { status: roof, confidence: 0.95 } } : undefined,
    },
    preview: {
      type: 'stack',
      stack: { frameCount: index, filter: 'LP', target: 'Sh2-171', updatedAtTime: at },
      single: { filename: '', capturedAt: null },
    },
  };
}

test('roofOpenFromStatus reads Sentinel roof statuses', () => {
  assert.equal(night.roofOpenFromStatus('Open'), true);
  assert.equal(night.roofOpenFromStatus(' closed '), false);
  assert.equal(night.roofOpenFromStatus('Moving'), null);
  assert.equal(night.roofOpenFromStatus(undefined), null);
});

test('Seestar stacked-frame count becomes one frame row per sub, backfilling gaps', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const first = await ingest(seestarPayload({ index: 3, at: '2026-11-14T05:37:03Z' }));
  assert.equal(first.frame.frames, 3);
  const second = await ingest(seestarPayload({ index: 5, at: '2026-11-14T05:38:03Z' }));
  assert.equal(second.frame.frames, 2);

  const frames = strapi.store.get(UID.frame);
  assert.deepEqual(
    frames.map((f) => f.filename),
    [1, 2, 3, 4, 5].map((i) => `seestar_20261114T053533Z_000${i}`)
  );
  // Capture times are strictly increasing, after the run start, and end at the snapshot time
  const times = frames.map((f) => new Date(f.capturedAt).getTime());
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  assert.ok(times[0] > Date.parse('2026-11-14T05:35:33.197Z'));
  assert.equal(frames[2].capturedAt, '2026-11-14T05:37:03.000Z');
  assert.equal(frames[4].capturedAt, '2026-11-14T05:38:03.000Z');
  assert.equal(frames[0].nightDate, '2026-11-13');
  assert.equal(frames[0].filter, 'LP');
  assert.equal(frames[0].exposureSeconds, 30);
  assert.equal(frames[0].gain, 200);

  const session = strapi.store.get(UID.session)[0];
  assert.equal(session.sessionKey, '2026-11-13|sh2-171');
  assert.equal(session.frameCount, 5);
  assert.equal(session.integrationSeconds, 150);
  assert.deepEqual(session.filters.LP, { frames: 5, seconds: 150, exposureSeconds: 30 });
  assert.equal(session.ra, '00h 05m 04.6s');

  const nightRow = strapi.store.get(UID.night)[0];
  assert.equal(nightRow.frameCount, 5);
  assert.equal(nightRow.integrationSeconds, 150);
});

test('repeated and idle Seestar snapshots add nothing', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(seestarPayload({ index: 4, at: '2026-11-14T05:38:03Z' }));
  const again = await ingest(seestarPayload({ index: 4, at: '2026-11-14T05:38:03Z' }));
  assert.deepEqual(again.frame, { created: false, frames: 0 });
  // Next afternoon the sync still reports last night's run while idle
  const idle = await ingest(seestarPayload({ index: 4, at: '2026-11-14T05:38:03Z' }));
  assert.deepEqual(idle.frame, { created: false, frames: 0 });
  assert.equal(strapi.store.get(UID.frame).length, 4);
  assert.equal(strapi.store.get(UID.session)[0].frameCount, 4);
});

test('a second Seestar run on the same target and night adds to the same session', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  await ingest(seestarPayload({ index: 2, at: '2026-11-14T05:37:00Z' }));
  // Target restarted: the firmware count starts again from 1 under a new run start
  await ingest(seestarPayload({ index: 3, at: '2026-11-14T06:12:00Z', startedAt: '2026-11-14T06:10:00Z' }));

  assert.equal(strapi.store.get(UID.frame).length, 5);
  assert.equal(strapi.store.get(UID.session).length, 1);
  assert.equal(strapi.store.get(UID.session)[0].frameCount, 5);
});

test('Seestar snapshots without a usable count or target store no frames', async () => {
  const strapi = makeFakeStrapi();
  const { ingest } = makeIngest({ strapi });

  const noIndex = seestarPayload({ index: 3, at: '2026-11-14T05:37:03Z' });
  delete noIndex.acquisition.currentFrameIndex;
  assert.equal((await ingest(noIndex)).frame, null);

  const zero = seestarPayload({ index: 0, at: '2026-11-14T05:37:03Z' });
  assert.equal((await ingest(zero)).frame, null);

  const noTarget = seestarPayload({ index: 3, at: '2026-11-14T05:37:03Z' });
  noTarget.target = {};
  noTarget.preview.stack.target = null;
  assert.equal((await ingest(noTarget)).frame, null);

  assert.equal(strapi.store.get('api::imaging-frame.imaging-frame'), undefined);
});

test('NINA payloads with a sub filename never take the Seestar path', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  const payload = pushPayload({ seq: 1, capturedAt: '2026-09-29T03:19:06Z' });
  payload.acquisition.currentFrameIndex = 40; // even if a count is present
  await ingest(payload);
  assert.equal(strapi.store.get(UID.frame).length, 1);
});

test('Sentinel "Roof open/closed" lines and roof status record transitions', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, UID } = makeIngest({ strapi });

  // Evening: roof reported closed (seeds state), then opens with a log line
  await ingest(seestarPayload({ index: 1, at: '2026-11-14T00:30:00Z', roof: 'Closed' }));
  const opened = await ingest(
    seestarPayload({
      index: 1,
      at: '2026-11-14T00:41:00Z',
      roof: 'Open',
      activityLog: [{ timestamp: '2026-11-14T00:40:12Z', message: 'Roof open', level: 'info' }],
    })
  );
  assert.equal(opened.roof, 1); // the log line; the matching status is not a second event

  // Status alone flips to closed (no log line in this snapshot)
  const closed = await ingest(seestarPayload({ index: 1, at: '2026-11-14T06:59:43Z', roof: 'Closed' }));
  assert.equal(closed.roof, 1);

  const nightRow = strapi.store.get(UID.night).find((n) => n.night === '2026-11-13');
  assert.deepEqual(nightRow.roofEvents, [
    { t: '2026-11-14T00:40:12.000Z', safe: true },
    { t: '2026-11-14T06:59:43.000Z', safe: false },
  ]);
  assert.equal(nightRow.lastRoofSafe, false);
});

// ---------------------------------------------------------------------------
// Backfill of finished Seestar runs (pre-1.2.12 history)
// ---------------------------------------------------------------------------

test('backfill replays a finished run once and subtracts real subs already logged', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, backfillRuns, UID } = makeIngest({ strapi });

  // 1.2.11 uploaded two real subs of this target mid-run
  for (const [seq, at] of [[1, '2026-11-13T07:35:27Z'], [2, '2026-11-13T07:36:55Z']]) {
    const p = pushPayload({ seq, capturedAt: at, target: 'SH2-171', filter: 'LP' });
    p.preview.single.filename = `seestar-sub-${seq}.jpg`;
    p.preview.single.exposureSeconds = 30;
    await ingest(p);
  }

  const run = {
    target: 'Sh2-171',
    startedAt: '2026-11-13T07:20:00Z',
    endedAt: '2026-11-13T08:15:00Z',
    frames: 100,
    filter: 'LP',
    exposureSeconds: 30,
    gain: 200,
    ra: '00h 05m 04.6s',
    dec: "+67° 26' 25\"",
  };
  const [first] = await backfillRuns([run]);
  assert.deepEqual(first, { target: 'SH2-171', startedAt: '2026-11-13T07:20:00.000Z', overlap: 2, added: 98 });

  const [again] = await backfillRuns([run]);
  assert.equal(again.added, 0);

  const session = strapi.store.get(UID.session).find((s) => s.sessionKey === '2026-11-12|sh2-171');
  assert.equal(session.frameCount, 100);
  assert.equal(session.integrationSeconds, 100 * 30);
  assert.equal(strapi.store.get(UID.frame).filter((f) => f.filename.startsWith('seestar_')).length, 98);
});

test('backfill skips invalid runs and keeps going', async () => {
  const strapi = makeFakeStrapi();
  const { backfillRuns } = makeIngest({ strapi });

  const results = await backfillRuns([
    { target: 'NGC 7000', startedAt: 'nope', endedAt: '2026-11-12T03:00:00Z', frames: 50, filter: 'LP', exposureSeconds: 30 },
    { target: 'NGC 6960', startedAt: '2026-11-12T03:00:00Z', endedAt: '2026-11-12T04:40:00Z', frames: 195, filter: 'LP', exposureSeconds: 30 },
  ]);
  assert.equal(results[0].skipped, 'invalid');
  assert.equal(results[1].added, 195);
});

test('backfill counts real subs in the window even when logged under another name', async () => {
  const strapi = makeFakeStrapi();
  const { ingest, backfillRuns, UID } = makeIngest({ strapi });

  // 4 Nov: five subs logged as SH2-157, one mis-attributed to the next target
  const subs = [
    ['SH2-157', '2026-11-05T02:53:00Z'],
    ['SH2-157', '2026-11-05T02:54:00Z'],
    ['SH2-157', '2026-11-05T02:56:00Z'],
    ['SH2-157', '2026-11-05T02:57:00Z'],
    ['SH2-157', '2026-11-05T02:58:00Z'],
    ['Eastern Veil (NGC 6992)', '2026-11-05T02:59:30Z'],
  ];
  for (const [i, [target, at]] of subs.entries()) {
    const p = pushPayload({ seq: i + 1, capturedAt: at, target, filter: 'LP' });
    p.preview.single.filename = `sub-${i}.jpg`;
    p.preview.single.exposureSeconds = 30;
    await ingest(p);
  }

  const [r] = await backfillRuns([
    { target: 'Sh2-157', startedAt: '2026-11-05T02:52:30Z', endedAt: '2026-11-05T02:59:36Z', frames: 8, filter: 'LP', exposureSeconds: 30, gain: 200 },
  ]);
  assert.deepEqual(r, { target: 'SH2-157', startedAt: '2026-11-05T02:52:30.000Z', overlap: 6, added: 2 });
  const sh2 = strapi.store.get(UID.session).find((s) => s.sessionKey === '2026-11-04|sh2-157');
  assert.equal(sh2.frameCount, 7);
  assert.equal(strapi.store.get(UID.night)[0].frameCount, 8);
});
