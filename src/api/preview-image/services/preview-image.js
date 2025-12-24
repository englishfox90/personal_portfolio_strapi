'use strict';

/**
 * preview-image service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::preview-image.preview-image');
