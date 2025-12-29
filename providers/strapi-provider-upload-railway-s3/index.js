'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');

module.exports = {
  init(config) {
    const s3Client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: config.region || 'auto',
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle || true,
    });

    const bucket = config.bucket;
    const signedUrlExpires = config.signedUrlExpires || 60 * 60 * 24 * 7; // Default 7 days

    const getFileKey = (file) => {
      const path = file.path ? `${file.path}/` : '';
      return `${path}${file.hash}${file.ext}`;
    };

    // Extract the actual S3 key from a URL (handles both signed URLs and paths)
    const extractKeyFromUrl = (url) => {
      if (!url) return null;
      
      // If it's just a path starting with /
      if (url.startsWith('/') && !url.startsWith('//')) {
        return url.slice(1);
      }
      
      // If it's a full URL, extract the key
      try {
        const urlObj = new URL(url);
        // Path format: /bucket-name/key or just /key
        let pathname = urlObj.pathname;
        
        // Remove leading slash
        if (pathname.startsWith('/')) {
          pathname = pathname.slice(1);
        }
        
        // If the path includes the bucket name, remove it
        if (pathname.startsWith(bucket + '/')) {
          pathname = pathname.slice(bucket.length + 1);
        }
        
        return pathname;
      } catch (e) {
        // If URL parsing fails, assume it's already a key
        return url.startsWith('/') ? url.slice(1) : url;
      }
    };

    return {
      async upload(file) {
        const key = getFileKey(file);

        const uploadParams = {
          Bucket: bucket,
          Key: key,
          Body: file.stream || Buffer.from(file.buffer, 'binary'),
          ContentType: file.mime,
        };

        try {
          const upload = new Upload({
            client: s3Client,
            params: uploadParams,
          });

          await upload.done();

          // Store just the key path (not a signed URL)
          // Strapi will call getSignedUrl() when it needs to display the image
          file.url = key;
        } catch (err) {
          console.error('Railway S3 upload error:', err);
          throw err;
        }
      },

      async uploadStream(file) {
        return this.upload(file);
      },

      async delete(file) {
        const key = extractKeyFromUrl(file.url) || getFileKey(file);

        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key,
            })
          );
        } catch (err) {
          console.error('Railway S3 delete error:', err);
          throw err;
        }
      },

      // Mark this provider as private - Strapi will call getSignedUrl for admin panel
      isPrivate() {
        return true;
      },

      // Generate presigned URL for secure access
      async getSignedUrl(file) {
        // Extract the actual key from the stored URL
        const key = extractKeyFromUrl(file.url);
        
        if (!key) {
          console.error('Railway S3 getSignedUrl: Could not extract key from', file.url);
          throw new Error('Could not extract file key');
        }

        try {
          const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          });

          const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: signedUrlExpires,
          });

          return { url: signedUrl };
        } catch (err) {
          console.error('Railway S3 getSignedUrl error:', err);
          throw err;
        }
      },
    };
  },
};
