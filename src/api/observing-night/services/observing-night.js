'use strict';

/**
 * observing-night service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::observing-night.observing-night');
