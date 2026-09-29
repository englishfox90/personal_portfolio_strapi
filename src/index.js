'use strict';

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
  bootstrap(/*{ strapi }*/) {},
};
