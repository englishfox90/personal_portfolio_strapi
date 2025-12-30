'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Reuse S3 client across requests (connection pooling)
let s3ClientInstance = null;

const getS3Client = () => {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      region: process.env.AWS_DEFAULT_REGION || 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: true,
    });
  }
  return s3ClientInstance;
};

const bucket = process.env.AWS_S3_BUCKET_NAME;
const signedUrlExpires = parseInt(process.env.AWS_SIGNED_URL_EXPIRES) || 60 * 60 * 24 * 7; // Default 7 days

// In-memory cache for signed URLs
// Key: S3 key, Value: { signedUrl, expiresAt }
const signedUrlCache = new Map();

// Cache URLs for slightly less time than they're valid (95% of expiry time)
// This ensures cached URLs are always valid when returned
const CACHE_BUFFER_RATIO = 0.95;

/**
 * Get a signed URL from cache or generate a new one
 */
const getCachedSignedUrl = async (s3Client, key) => {
  const now = Date.now();
  const cached = signedUrlCache.get(key);
  
  // Return cached URL if still valid
  if (cached && cached.expiresAt > now) {
    return cached.signedUrl;
  }
  
  // Generate new signed URL
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  
  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: signedUrlExpires,
  });
  
  // Cache the new URL
  const cacheExpiresIn = signedUrlExpires * CACHE_BUFFER_RATIO * 1000; // Convert to ms
  signedUrlCache.set(key, {
    signedUrl,
    expiresAt: now + cacheExpiresIn,
  });
  
  // Periodically clean up expired entries (every 100 cache sets)
  if (signedUrlCache.size % 100 === 0) {
    cleanupExpiredCache();
  }
  
  return signedUrl;
};

/**
 * Remove expired entries from cache
 */
const cleanupExpiredCache = () => {
  const now = Date.now();
  for (const [key, value] of signedUrlCache.entries()) {
    if (value.expiresAt <= now) {
      signedUrlCache.delete(key);
    }
  }
};

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
      const signedUrl = await getCachedSignedUrl(s3Client, key);
      
      // Set cache headers so frontend/CDN can cache the response
      // Cache for 1 hour on client, allow CDN to cache for longer
      ctx.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');

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
            const signedUrl = await getCachedSignedUrl(s3Client, key);
            return { original: url, signedUrl };
          } catch (error) {
            return { original: url, error: error.message };
          }
        })
      );
      
      // Set cache headers for batch endpoint
      ctx.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');

      return {
        urls: results,
        expiresIn: signedUrlExpires,
      };
    } catch (error) {
      strapi.log.error('Error generating signed URLs:', error);
      return ctx.internalServerError('Failed to generate signed URLs');
    }
  },

  /**
   * GET endpoint for signed URL - more CDN-friendly
   * GET /api/signed-url/:key
   * Example: GET /api/signed-url/Christmas_Tree_47f57970a1.png
   * 
   * This endpoint can be cached by CDNs and browsers more easily
   */
  async getSignedUrlByKey(ctx) {
    try {
      const { key } = ctx.params;

      if (!key) {
        return ctx.badRequest('Key is required');
      }

      // Decode the key in case it was URL-encoded
      const decodedKey = decodeURIComponent(key);

      const s3Client = getS3Client();
      const signedUrl = await getCachedSignedUrl(s3Client, decodedKey);
      
      // More aggressive caching for GET requests (CDN-friendly)
      ctx.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');

      return {
        url: signedUrl,
        expiresIn: signedUrlExpires,
      };
    } catch (error) {
      strapi.log.error('Error generating signed URL by key:', error);
      return ctx.internalServerError('Failed to generate signed URL');
    }
  },

  /**
   * Image proxy/redirect endpoint - MOST performant for direct img src usage
   * GET /api/image/:key
   * Example: <img src="https://api.pfrastro.com/api/image/Christmas_Tree_47f57970a1.png" />
   * 
   * Redirects directly to the signed S3 URL - eliminates one round trip!
   * The browser will cache the redirect and follow it directly.
   */
  async redirectToSignedUrl(ctx) {
    try {
      const { key } = ctx.params;

      if (!key) {
        return ctx.badRequest('Key is required');
      }

      // Decode the key in case it was URL-encoded
      const decodedKey = decodeURIComponent(key);

      const s3Client = getS3Client();
      const signedUrl = await getCachedSignedUrl(s3Client, decodedKey);
      
      // Cache the redirect for 1 hour
      ctx.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      
      // 302 redirect to the signed URL
      ctx.redirect(signedUrl);
    } catch (error) {
      strapi.log.error('Error redirecting to signed URL:', error);
      return ctx.internalServerError('Failed to redirect to signed URL');
    }
  },
};
