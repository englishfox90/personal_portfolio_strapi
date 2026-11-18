'use strict';

const fs = require('fs');
const path = require('path');

const CURRENTLY_IMAGING_UID = 'api::currently-imaging.currently-imaging';
const INGEST_ACTIONS = new Set(['create', 'update', 'publish']);

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    // Observing log: every write the rig makes to the currently-imaging
    // single type is mirrored into durable frame/session/night rows.
    // See src/api/observing-log/services/ingest.js and docs/OBSERVING_LOG.md.
    // The ingest is queued, never awaited, and never throws, so the rig's
    // request is unaffected.
    strapi.documents.use(async (context, next) => {
      const result = await next();
      if (context.uid === CURRENTLY_IMAGING_UID && INGEST_ACTIONS.has(context.action)) {
        try {
          const params = context.params || {};
          strapi.service('api::observing-log.ingest').enqueue(params.data);
        } catch (err) {
          strapi.log.error(`[observing-log] enqueue failed: ${(err && err.message) || err}`);
        }
      }
      return result;
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    // Imaging projects are derived from sessions. On the first boot after the
    // type is deployed there is history but no project rows, so build them
    // (and apply the one-off portfolio seed). Never blocks startup on failure.
    try {
      await strapi.service('api::observing-log.projects').bootstrap();
    } catch (err) {
      strapi.log.error(`[observing-log] project bootstrap failed: ${(err && err.message) || err}`);
    }

    // One-off history: Seestar runs imaged before the sync sent a frame count.
    // Idempotent (replaying a run adds nothing), so the file can stay until a
    // later cleanup. Runs in the background so startup and healthcheck are not held.
    try {
      const file = path.join(__dirname, '..', 'data', 'observing-log', 'seestar-backfill.json');
      if (fs.existsSync(file)) {
        const runs = JSON.parse(fs.readFileSync(file, 'utf8'));
        strapi
          .service('api::observing-log.ingest')
          .enqueueBackfill(runs)
          .then((results) => {
            for (const r of results) strapi.log.info(`[observing-log] backfill ${JSON.stringify(r)}`);
          })
          .catch((err) => strapi.log.error(`[observing-log] backfill failed: ${(err && err.message) || err}`));
      }
    } catch (err) {
      strapi.log.error(`[observing-log] backfill not started: ${(err && err.message) || err}`);
    }

    // Seestar sessions logged before target-named projects existed have no
    // project. Attach them once (queued after the backfill above; a no-op on
    // later boots). Only the Seestar era: older NINA sessions without a
    // scheduler project are left as they were.
    try {
      const since = process.env.OBSERVING_LOG_PROJECT_CATCHUP_SINCE || '2026-10-26T00:00:00Z';
      strapi
        .service('api::observing-log.ingest')
        .enqueueAttachUnlinked({ since })
        .then((attached) => {
          for (const a of attached) strapi.log.info(`[observing-log] project catch-up ${JSON.stringify(a)}`);
          strapi.log.info(`[observing-log] project catch-up attached ${attached.length} session(s)`);
        })
        .catch((err) => strapi.log.error(`[observing-log] project catch-up failed: ${(err && err.message) || err}`));
    } catch (err) {
      strapi.log.error(`[observing-log] project catch-up not started: ${(err && err.message) || err}`);
    }
  },
};
