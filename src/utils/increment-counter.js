'use strict';

/**
 * Increment a numeric counter (views, downloads) on a published document
 * WITHOUT publishing it.
 *
 * The previous implementation called
 *   strapi.documents(uid).update({ documentId, data, status: 'published' })
 * which in Strapi 5 means "update the draft, then publish it": every page view
 * published whatever unpublished edits sat in the draft, and viewing a
 * never-published draft in content preview published the whole entry.
 *
 * This writes the counter straight to the database rows instead:
 * - only documents that have a published version are counted (drafts and
 *   preview views return null -> 404);
 * - the draft row gets the same value, so a later publish (which copies the
 *   draft over the published row) doesn't reset the count;
 * - db.query() does not touch updatedAt, so entries don't show as "Modified"
 *   in the admin.
 *
 * @returns {Promise<null | { id: number, documentId: string, previous: number, value: number, row: object }>}
 */
async function incrementCounter(strapi, uid, documentId, field, select = []) {
  const query = strapi.db.query(uid);

  const published = await query.findOne({
    where: { documentId, publishedAt: { $notNull: true } },
    select: ['id', 'documentId', field, ...select],
  });
  if (!published) return null;

  const previous = Number(published[field]) || 0;
  const value = previous + 1;

  await query.updateMany({
    where: { documentId },
    data: { [field]: value },
  });

  return { id: published.id, documentId, previous, value, row: published };
}

module.exports = { incrementCounter };
