# Observing Log

Durable history of what the rig imaged, built automatically from the
`currently-imaging` pushes NINA already makes. Nothing on the rig changes.

## Why

`currently-imaging`, `preview-image` and `stack-image` are single types that
the rig overwrites on every event, so the site has no memory of past nights.
The observing log mirrors each push into three collection types that are never
overwritten.

## Data model

| Collection | Key | Holds |
|---|---|---|
| `observing-night` | `night` (date, unique) | Totals for the night (`frameCount`, `integrationSeconds`, `targetCount`, first/last frame), `weatherSummary` (per-metric min / max / mean / count), `weatherSamples` (array of readings, max 300), `timezone`, free-text `notes`. |
| `imaging-session` | `sessionKey` = `night|target` (unique) | One target on one night: `targetName`, `projectName`, `ra`, `dec`, `frameCount`, `integrationSeconds`, `filters` (`{ Red: { frames, seconds, exposureSeconds } }`), `stats` (HFR / stars / mean / median summaries), first/last frame. Relations: `night`, `frames`, optional one-way `portfolioEntry`. |
| `imaging-frame` | `filename` (unique) | One saved light frame: `capturedAt`, `nightDate`, `targetName`, `filter`, `exposureSeconds`, `gain`, `sensorTemperature`, `hfr`, `hfrStDev`, `stars`, `mean`, `median`, `stdDev`. Relation: `session`. |

All three have draft & publish **off**: rows are written directly by the hook
and are readable straight away.

Row volume is small: roughly 100-300 frames per night, a handful of sessions,
one night. Keep everything.

## How rows are written

`src/index.js` registers a Document Service middleware. After any `create`,
`update` or `publish` on `api::currently-imaging.currently-imaging`, it hands
the incoming payload to `api::observing-log.ingest` (`src/api/observing-log/services/ingest.js`).

The ingest:

1. **Frame** — reads `preview.single`. The NINA `filename` is the idempotency
   key, so a payload seen twice (draft + publish, repeated pushes between
   frames) records the frame once. The observing night comes from the
   `_NIGHT_YYYY-MM-DD` token NINA stamps into the filename; if absent, it is
   the local date twelve hours before `capturedAt` in `OBSERVING_LOG_TIMEZONE`.
2. **Session** — find-or-create by `night|target`, then bump counts, per-filter
   totals, first/last frame and stat summaries.
3. **Night** — find-or-create by date, then bump totals.
4. **Weather** — if `environment.weather` is connected and the night row already
   exists (i.e. at least one frame tonight), append a sample at most once every
   `OBSERVING_LOG_WEATHER_SAMPLE_MINUTES` and fold it into `weatherSummary`.
   Null readings (the station reports no cloud cover or SQM, for example) are
   skipped, not stored as zero.

The ingest runs on an in-process queue, is never awaited by the request and
never throws, so the rig's push latency and success are unaffected. Failures
are logged with the `[observing-log]` prefix.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OBSERVING_LOG_ENABLED` | `true` | Set to `false` to stop writing rows without redeploying code. |
| `OBSERVING_LOG_TIMEZONE` | `America/Chicago` | Fallback night rollover timezone (SFRO). |
| `OBSERVING_LOG_WEATHER_SAMPLE_MINUTES` | `10` | Minimum spacing between stored weather samples. |

## Reading it

Public REST routes exist for all three types (`/api/observing-nights`,
`/api/imaging-sessions`, `/api/imaging-frames`) and follow the normal Strapi
permission model. The website reads them with its server-side API token; if
that token is a *custom* token, grant it `find` / `findOne` on the three new
types in Settings → API Tokens.

Useful queries:

```
/api/observing-nights?sort=night:desc&populate=sessions&pagination[pageSize]=30
/api/imaging-sessions?filters[nightDate][$eq]=2026-09-28&populate=frames
/api/imaging-sessions?filters[targetName][$containsi]=trifid&sort=nightDate:asc
```

## Deploying

The three schemas create new tables on first boot — take a Railway Postgres
backup first, as with any schema change. History starts from the first push
after the deploy; there is no backfill because the single types hold no past
data.

## Tests

```bash
node --test tests/
```

`tests/observing-log.test.js` drives the ingest against an in-memory stand-in
for `strapi.documents()` using a trimmed copy of a real rig push.
