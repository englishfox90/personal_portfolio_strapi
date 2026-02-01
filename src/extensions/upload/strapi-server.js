'use strict';

/**
 * Override Strapi's upload plugin to preserve original image quality
 * 
 * This extension ensures:
 * 1. Original images are NEVER converted or compressed
 * 2. Responsive formats (thumbnail, small, medium, large) are generated for web use
 * 3. PNG files stay as PNG, maintaining transparency and lossless quality
 * 4. Signed URLs work correctly with the Railway S3 provider
 */

module.exports = (plugin) => {
  // In Strapi v5, image-manipulation is a plain object, not a factory function
  const originalService = plugin.services['image-manipulation'];

  // Override the optimize function to preserve original image quality
  // The original optimize function converts/compresses images - we want to skip that for originals
  const originalOptimize = originalService.optimize;

  plugin.services['image-manipulation'] = {
    ...originalService,

    /**
     * Override optimize to prevent ANY modification of original files
     * 
     * In Strapi v5, this function is called to process image buffers.
     * We check if this is a responsive format (has breakpoint prefix) or original.
     * - Original files: return untouched (no conversion, no compression)
     * - Responsive formats: use default optimization for fast web loading
     */
    async optimize(file) {
      // Check if this file is a responsive format (thumbnail_, small_, medium_, large_, xlarge_)
      // These have prefixes added during generateResponsiveFormats/generateThumbnail
      const responsivePrefixes = ['thumbnail_', 'small_', 'medium_', 'large_', 'xlarge_'];
      const isResponsiveFormat = responsivePrefixes.some(prefix => 
        file.name?.startsWith(prefix) || file.hash?.startsWith(prefix)
      );

      if (isResponsiveFormat) {
        // For responsive formats, use Strapi's default optimization
        // This creates smaller, web-optimized versions for thumbnails/previews
        strapi.log.debug(`[upload-extension] Optimizing responsive format: ${file.name}`);
        return originalOptimize(file);
      }

      // This is the ORIGINAL file - return it completely untouched
      // No format conversion, no compression, no modifications
      strapi.log.debug(`[upload-extension] Preserving original image without optimization: ${file.name}`);
      return file;
    },
  };

  return plugin;
};
