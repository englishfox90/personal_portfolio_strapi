'use strict';

/**
 * imaging-project `status` -> `projectStatus`.
 *
 * Strapi 5's Content Manager treats a `status` body field as the document's
 * draft/published dimension and rejects anything else ("Invalid status"), so
 * the project status could never be edited in the admin. The attribute is now
 * `projectStatus` (column `project_status`).
 *
 * User migrations run before the schema sync, which would otherwise drop the
 * old `status` column and create `project_status` filled with the default.
 * This creates the new column first and copies the existing values across, so
 * no project's status is lost. Safe to re-run: it does nothing once the old
 * column is gone.
 */
const TABLE = 'imaging_projects';

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable(TABLE))) return;
    if (!(await knex.schema.hasColumn(TABLE, 'status'))) return;

    if (!(await knex.schema.hasColumn(TABLE, 'project_status'))) {
      await knex.schema.alterTable(TABLE, (t) => {
        t.string('project_status', 255);
      });
    }

    await knex(TABLE)
      .whereNull('project_status')
      .update({ project_status: knex.ref('status') });
  },

  async down() {},
};
