'use strict';

/**
 * software-tool service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::software-tool.software-tool');
