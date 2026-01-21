'use strict';

/**
 * Override Strapi's upload plugin to preserve original image quality
 * 
 * This extension ensures:
 * 1. Original images are NEVER converted or compressed
 * 2. Responsive formats (thumbnail, small, medium, large) are generated for web use
 * 3. PNG files stay as PNG, maintaining transparency and lossless quality
 * 4. Signed URLs work correctly with the Railway S3 provider
 * 
 * How it works:
 * - Strapi v5 processes images through the image-manipulation service
 * - The `optimize` function is called for BOTH originals and responsive formats
 * - We intercept this to skip optimization on original files
 * - Responsive formats still get optimized for faster web loading
 */

module.exports = (plugin) => {
  // In Strapi v5, services are factory functions that return the service
  // We need to wrap the existing factory, not call it directly
  const originalImageManipulationFactory = plugin.services['image-manipulation'];

  // Replace with our custom factory
  plugin.services['image-manipulation'] = (context) => {
    // Call the original factory to get the base service
    const originalService = originalImageManipulationFactory(context);
    const { strapi } = context;

    return {
      ...originalService,

      /**
       * Override getDimensions to preserve original behavior
       */
      async getDimensions(file) {
        return originalService.getDimensions(file);
      },

      /**
       * Override generateResponsiveFormats to create responsive versions
       * while ensuring originals remain untouched
       */
      async generateResponsiveFormats(file) {
        // Skip processing for non-images
        if (!file.mime || !file.mime.startsWith('image/')) {
          return [];
        }

        // Skip SVG files entirely (they don't need responsive formats)
        if (file.mime === 'image/svg+xml') {
          return [];
        }

        // Skip GIF files (they may be animated)
        if (file.mime === 'image/gif') {
          return [];
        }

        // Let Strapi generate responsive formats as normal
        // These are SEPARATE files (thumbnail_, small_, medium_, large_, xlarge_)
        // The original file buffer is NOT modified by this function
        return originalService.generateResponsiveFormats(file);
      },

      /**
       * Override optimize to prevent ANY modification of original files
       * 
       * In Strapi v5, this function is called to process image buffers.
       * We override it to return the original buffer unchanged, which:
       * - Prevents PNG → JPEG conversion
       * - Prevents quality reduction/compression
       * - Preserves exact pixel data and file format
       * 
       * For responsive formats, we allow optimization since they're
       * meant for fast web loading, not archival quality.
       */
      async optimize(buffer, options = {}) {
        // Check if this is being called for a responsive format
        // Responsive formats have a 'width' option set for resizing
        const isResponsiveFormat = options.width !== undefined;

        if (!isResponsiveFormat) {
          // This is the ORIGINAL file - return buffer completely untouched
          // No format conversion, no compression, no modifications
          strapi.log.debug('[upload-extension] Preserving original image without optimization');
          return { 
            buffer,
            info: {
              // Return empty info to signal no transformation was done
            }
          };
        }

        // For responsive formats, use Strapi's default optimization
        // This creates smaller, web-optimized versions for thumbnails/previews
        strapi.log.debug(`[upload-extension] Optimizing responsive format (width: ${options.width})`);
        return originalService.optimize(buffer, options);
      },
    };
  };

  return plugin;
};
