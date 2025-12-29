'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Initialize S3 client
const getS3Client = () => {
  return new S3Client({
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    region: process.env.AWS_DEFAULT_REGION || 'auto',
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: true,
  });
};

const bucket = process.env.AWS_S3_BUCKET_NAME;
const signedUrlExpires = parseInt(process.env.AWS_SIGNED_URL_EXPIRES) || 60 * 60 * 24 * 7; // Default 7 days

/**
 * Extract the S3 key from various URL formats
 */
const extractKeyFromUrl = (url) => {
  if (!url) return null;

  // If it's just a filename or path without protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return url.startsWith('/') ? url.slice(1) : url;
  }

  try {
    const urlObj = new URL(url);
    let pathname = urlObj.pathname;

    // Remove leading slash
    if (pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }

    // If the path includes the bucket name, remove it
    if (bucket && pathname.startsWith(bucket + '/')) {
      pathname = pathname.slice(bucket.length + 1);
    }

    return pathname;
  } catch (e) {
    // If URL parsing fails, assume it's already a key
    return url.startsWith('/') ? url.slice(1) : url;
  }
};

/**
 * Generate a signed URL for a single key
 */
const generateSignedUrl = async (s3Client, key) => {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: signedUrlExpires,
  });
};

module.exports = {
  /**
   * Generate a signed URL for a single file
   * POST /api/signed-url
   * Body: { url: "filename.png" } or { url: "https://..." }
   */
  async getSignedUrl(ctx) {
    try {
      const { url } = ctx.request.body;

      if (!url) {
        return ctx.badRequest('URL is required');
      }

      const key = extractKeyFromUrl(url);

      if (!key) {
        return ctx.badRequest('Could not extract file key from URL');
      }

      const s3Client = getS3Client();
      const signedUrl = await generateSignedUrl(s3Client, key);

      return {
        url: signedUrl,
        expiresIn: signedUrlExpires,
      };
    } catch (error) {
      strapi.log.error('Error generating signed URL:', error);
      return ctx.internalServerError('Failed to generate signed URL');
    }
  },

  /**
   * Generate signed URLs for multiple files
   * POST /api/signed-urls
   * Body: { urls: ["filename1.png", "filename2.png"] }
   */
  async getSignedUrls(ctx) {
    try {
      const { urls } = ctx.request.body;

      if (!urls || !Array.isArray(urls)) {
        return ctx.badRequest('URLs array is required');
      }

      const s3Client = getS3Client();
      const results = await Promise.all(
        urls.map(async (url) => {
          try {
            const key = extractKeyFromUrl(url);
            if (!key) {
              return { original: url, error: 'Could not extract key' };
            }
            const signedUrl = await generateSignedUrl(s3Client, key);
            return { original: url, signedUrl };
          } catch (error) {
            return { original: url, error: error.message };
          }
        })
      );

      return {
        urls: results,
        expiresIn: signedUrlExpires,
      };
    } catch (error) {
      strapi.log.error('Error generating signed URLs:', error);
      return ctx.internalServerError('Failed to generate signed URLs');
    }
  },
};
