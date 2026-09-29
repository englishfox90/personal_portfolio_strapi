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
| `observing-night` | `night` (date, unique) | Totals for the night (`frameCount`, `integrationSeconds`, `targetCount`, first/last frame), `weatherSummary` (per-metric min / max / mean / count), `weatherSamples` (array of readings, max 300), `roofEvents` (`[{ t, safe }]` roof transitions, max 200) and `lastRoofSafe`, `timezone`, free-text `notes`. |
| `imaging-session` | `sessionKey` = `night|target` (unique) | One target on one night: `targetName`, `projectName`, `ra`, `dec`, `frameCount`, `integrationSeconds`, `filters` (`{ Red: { frames, seconds, exposureSeconds } }`), `stats` (HFR / stars / mean / median summaries), first/last frame. Relations: `night`, `frames`, optional one-way `portfolioEntry`. |
| `imaging-frame` | `filename` (unique) | One saved light frame: `capturedAt`, `nightDate`, `targetName`, `filter`, `exposureSeconds`, `gain`, `sensorTemperature`, `hfr`, `hfrStDev`, `stars`, `mean`, `median`, `stdDev`. Relation: `session`. |
| `imaging-project` | `name` (unique; the scheduler's project name) | One Target Scheduler project across every night and target (mosaic panels are targets of one project): `slug`, `status` (`active` / `complete` / `paused` / `abandoned`), `notes`, `targetNames`, `frameCount`, `integrationSeconds`, `sessionCount`, `filters` (same shape as a session's), first/last frame. Relations: `sessions`, `portfolioEntries` (many-to-many with `portfolio-entry`, which sees it as `imaging_projects`). |

All four have draft & publish **off**: rows are written directly by the hook
and are readable straight away. The project row is the one place a human
edits: its status, notes and which portfolio entries it produced. Everything
else on it is derived and recomputed by the rebuild (below), so edit only
those three fields.

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
   The **target** is read from the `_SUBJECT_<name>_NIGHT_` token in the same
   filename, then from the `Image saved: <name> (...)` activity-log line whose
   timestamp matches `capturedAt`, and only then from `payload.target`. The rig
   pushes *after* the save, so when the scheduler has already switched targets
   the payload's current target is the *next* one, not the frame's. For the
   same reason RA/Dec and project name are copied from the payload only when
   its current target matches the frame's target; otherwise they stay null and
   are filled by a later matching push.
2. **Session** — find-or-create by `night|target`, then bump counts, per-filter
   totals, first/last frame and stat summaries.
3. **Night** — find-or-create by date, then bump totals.
3. **Project** — the payload's `project.name` (subject to the same
   target-match rule as RA/Dec) names an `imaging-project`, find-or-created by
   name with a slug from it. A session already linked to its project adds the
   one frame; a session not yet linked (its first frame, or the name only
   arrived on a later matching push) is attached and its whole totals folded
   in, so nothing counted before the link is lost.
4. **Weather** — if `environment.weather` is connected, append a sample at most
   once every `OBSERVING_LOG_WEATHER_SAMPLE_MINUTES` and fold it into
   `weatherSummary`. The reading's own timestamp decides which night it belongs
   to. Inside the local night window (`OBSERVING_LOG_WEATHER_WINDOW_START` to
   `OBSERVING_LOG_WEATHER_WINDOW_END`, default 17:00-09:00) the night row is
   created if needed, so the hours before the first frame and fully clouded-out
   nights are recorded; a night with `frameCount` 0 is exactly that. Outside
   the window only existing night rows are sampled, so idle days stay empty.
   Null readings (the station reports no cloud cover or SQM, for example) are
   skipped, not stored as zero. The SFRO station's weather driver does not
   implement cloud cover, so live pushes always carry `cloudCover: null` and
   no `cloudCover` is ever stored for them; its `skyTemperature` is the cloud
   sensor. The website derives a clear / thin cloud / overcast level from
   `skyTemperature - temperature` (`components/observing-log/cloudModel.ts`)
   and uses a stored `cloudCover` only when a night has one (backfilled
   Open-Meteo samples may).

5. **Roof** — the site's safety monitor ("Building 8") is the building roof:
   SAFE means open. Every `Safety monitor: SAFE|UNSAFE` activity-log line is
   stored once (by timestamp) on the night's `roofEvents`. If the sync tool
   sends `equipment.safetyMonitor.isSafe`, a change against the last stored
   state is recorded as a transition too, stamped with `metaData.lastUpdated`.
   The website turns the transitions into open/closed spans and roof-open
   hours; state before the first transition of a night is inferred there.

The ingest runs on an in-process queue, is never awaited by the request and
never throws, so the rig's push latency and success are unaffected. Failures
are logged with the `[observing-log]` prefix.

## Projects

Projects are derived data: `api::observing-log.projects` (`services/projects.js`)
can rebuild every project row from the sessions at any time (`rebuild()`),
recomputing totals, creating missing rows and relinking sessions. It never
touches `status`, `notes` or `portfolioEntries` on a row that already exists.

On boot, if there are sessions but no project rows (the first deploy of the
type onto existing history), the bootstrap runs the rebuild once and applies
`lib/portfolioSeed.js`: a fixed map from project name to the portfolio slugs
it produced. Seeded projects are linked and marked `complete`. The seed only
ever applies to rows the rebuild created in that run, so links changed in the
admin afterwards stay as set. Set `OBSERVING_LOG_REBUILD_PROJECTS=true` to
force a rebuild on the next boot (totals only; no seeding).

Linking a new image: open the Imaging Project (or the Portfolio Entry) in the
admin and pick the other side. One link per project, not per session.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OBSERVING_LOG_ENABLED` | `true` | Set to `false` to stop writing rows without redeploying code. |
| `OBSERVING_LOG_TIMEZONE` | `America/Chicago` | Fallback night rollover timezone (SFRO). |
| `OBSERVING_LOG_WEATHER_SAMPLE_MINUTES` | `5` | Minimum spacing between stored weather samples (about 150 per night). |
| `OBSERVING_LOG_WEATHER_WINDOW_START` | `17` | Local hour from which weather-only pushes may create a night row. |
| `OBSERVING_LOG_WEATHER_WINDOW_END` | `9` | Local hour at which that window closes (next morning). |
| `OBSERVING_LOG_REBUILD_PROJECTS` | `false` | `true` recomputes every project row from its sessions on the next boot. |

## Reading it

Public REST routes exist for all four types (`/api/observing-nights`,
`/api/imaging-sessions`, `/api/imaging-frames`, `/api/imaging-projects`) and
follow the normal Strapi permission model. The website reads them with its
server-side API token; if that token is a *custom* token, grant it `find` /
`findOne` on the types in Settings → API Tokens. For `imaging-projects` this
happens on its own: at boot, any custom token that can `find` imaging
sessions is given `find` / `findOne` on imaging projects (logged as
`[observing-log] API token "…" granted read on imaging projects`).

Useful queries:

```
/api/observing-nights?sort=night:desc&populate=sessions&pagination[pageSize]=30
/api/observing-nights?filters[frameCount][$gt]=0&sort=night:desc   (nights with imaging only)
/api/imaging-sessions?filters[nightDate][$eq]=2026-09-28&populate=frames
/api/imaging-sessions?filters[targetName][$containsi]=trifid&sort=nightDate:asc
/api/imaging-projects?sort=lastFrameAt:desc&populate[portfolioEntries][populate]=heroImage
/api/imaging-sessions?filters[project][slug][$eq]=the-butterfly-nebula&sort=nightDate:asc
```

## Deploying

The schemas create new tables on first boot — take a Railway Postgres
backup first, as with any schema change. The single types hold no past data,
so the hook only records pushes after the deploy. Nights from 2025-10-02 to
2026-09-28 were backfilled once (2026-09-29) from the NINA Target Scheduler DB,
a Discord export of the Starfront roof notices and hourly Open-Meteo weather;
backfilled weather samples carry `source: "open-meteo"` because they are
modelled grid data, not station readings.

## Tests

```bash
node --test tests/
```

`tests/observing-log.test.js` drives the ingest against an in-memory stand-in
for `strapi.documents()` using a trimmed copy of a real rig push.
