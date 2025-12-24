'use strict';

/**
 * currently-imaging service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::currently-imaging.currently-imaging');
