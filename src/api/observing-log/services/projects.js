'use strict';

/**
 * Imaging projects: derived rows, one per scheduler project name, totalled
 * from imaging sessions. The ingest keeps them current frame by frame; this
 * service rebuilds them from scratch (idempotent) and is what the bootstrap
 * runs once when the type is first deployed onto existing history.
 */

const { toNumber } = require('../lib/night');
const { normaliseProjectName, slugify, foldSession, EMPTY_TOTALS } = require('../lib/project');
const portfolioSeed = require('../lib/portfolioSeed');

const UID = {
  session: 'api::imaging-session.imaging-session',
  project: 'api::imaging-project.imaging-project',
  portfolio: 'api::portfolio-entry.portfolio-entry',
};

const PAGE = 100;
const MAX_PAGES = 200;

module.exports = ({ strapi }) => {
  const log = strapi.log;

  async function loadSessions() {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await strapi.documents(UID.session).findMany({
        fields: [
          'documentId',
          'projectName',
          'targetName',
          'frameCount',
          'integrationSeconds',
          'firstFrameAt',
          'lastFrameAt',
          'filters',
        ],
        populate: ['project'],
        sort: 'firstFrameAt:asc',
        start: page * PAGE,
        limit: PAGE,
      });
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function findOrCreateProject(name, created) {
    const found = await strapi.documents(UID.project).findFirst({ filters: { name } });
    if (found) return found;
    const base = slugify(name);
    let slug = base;
    for (let n = 2; await strapi.documents(UID.project).findFirst({ filters: { slug }, fields: ['id'] }); n++) {
      slug = `${base}-${n}`;
    }
    const doc = await strapi.documents(UID.project).create({
      data: { name, slug, status: 'active', ...EMPTY_TOTALS },
    });
    created.add(doc.documentId);
    return doc;
  }

  /** Portfolio entries for the seed slugs that exist (published), as documentIds */
  async function portfolioIds(slugs) {
    const ids = [];
    for (const slug of slugs) {
      const entry = await strapi.documents(UID.portfolio).findFirst({
        filters: { slug },
        status: 'published',
        fields: ['documentId'],
      });
      if (entry) ids.push(entry.documentId);
      else log.warn(`[observing-log] project seed: no published portfolio entry with slug "${slug}"`);
    }
    return ids;
  }

  /**
   * Recompute every project from its sessions. Creates missing project rows,
   * relinks sessions whose `project` is missing or stale, and (only for rows
   * created in this run, when `seed` is true) applies the portfolio seed.
   */
  async function rebuild({ seed = false } = {}) {
    const sessions = await loadSessions();
    const groups = new Map();
    for (const s of sessions) {
      const name = normaliseProjectName(s.projectName);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(s);
    }

    const created = new Set();
    let relinked = 0;
    let seeded = 0;

    for (const [name, group] of groups) {
      const project = await findOrCreateProject(name, created);
      let totals = { ...EMPTY_TOTALS };
      for (const s of group) totals = foldSession(totals, s);

      const data = { ...totals };
      if (seed && created.has(project.documentId) && portfolioSeed[name]) {
        const ids = await portfolioIds(portfolioSeed[name]);
        if (ids.length > 0) {
          data.portfolioEntries = ids;
          data.status = 'complete';
          seeded += 1;
        }
      }
      await strapi.documents(UID.project).update({ documentId: project.documentId, data });

      for (const s of group) {
        const current = s.project && (typeof s.project === 'string' ? s.project : s.project.documentId);
        if (current === project.documentId) continue;
        await strapi.documents(UID.session).update({
          documentId: s.documentId,
          data: { project: project.documentId },
        });
        relinked += 1;
      }
    }

    const result = { projects: groups.size, created: created.size, relinked, seeded, sessions: sessions.length };
    log.info(`[observing-log] projects rebuilt: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Boot-time self-heal: the first deploy of the project type finds history
   * but no project rows, so derive them (with the seed). Set
   * OBSERVING_LOG_REBUILD_PROJECTS=true to force a rebuild on the next boot.
   */
  async function bootstrap() {
    const force = (process.env.OBSERVING_LOG_REBUILD_PROJECTS || 'false') === 'true';
    const existing = await strapi.documents(UID.project).count();
    if (existing > 0 && !force) return null;
    return rebuild({ seed: existing === 0 });
  }

  return { rebuild, bootstrap, loadSessions, UID };
};

