module.exports = ({ env }) => {
  const isS3 = env('UPLOAD_PROVIDER', 'aws-s3') === 'aws-s3';
  
  return {
    // Comments plugin for blog posts and portfolio entries
    comments: {
      enabled: true,
      config: {
        badWords: true,
        moderatorRoles: ['Super Admin', 'Author'],
        approvalFlow: [],
        entryLabel: {
          '*': ['Title', 'title', 'Name', 'name', 'Subject', 'subject'],
          'api::portfolio-entry.portfolio-entry': ['title'],
          'api::post.post': ['title'],
        },
        enabledCollections: [
          'api::portfolio-entry.portfolio-entry',
          'api::post.post',
        ],
        reportReasons: {
          BAD_LANGUAGE: 'BAD_LANGUAGE',
          DISCRIMINATION: 'DISCRIMINATION',
          SPAM: 'SPAM',
          OTHER: 'OTHER',
        },
      },
    },
    // Email provider using Mailgun
    email: {
      config: {
        provider: '@strapi/provider-email-mailgun',
        providerOptions: {
          key: env('MAILGUN_API_KEY'),
          domain: env('MAILGUN_DOMAIN'),
          url: env('MAILGUN_URL', 'https://api.mailgun.net'),
        },
        settings: {
          defaultFrom: env('MAILGUN_DEFAULT_FROM', 'noreply@pfrastro.com'),
          defaultReplyTo: env('MAILGUN_DEFAULT_REPLY_TO', 'noreply@pfrastro.com'),
        },
      },
    },
    "users-permissions": {
      config: {
        jwtSecret: env("JWT_SECRET"),
      },
    },
    upload: {
      config: {
        // Use custom Railway S3 provider with signed URL support
        provider: isS3 ? 'strapi-provider-upload-railway-s3' : 'local',
        providerOptions: isS3 ? {
          accessKeyId: env('AWS_ACCESS_KEY_ID'),
          secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          region: env('AWS_DEFAULT_REGION', 'auto'),
          endpoint: env('AWS_ENDPOINT_URL'),
          bucket: env('AWS_S3_BUCKET_NAME'),
          forcePathStyle: true,
          // Signed URL expiration in seconds (default: 7 days, max Railway: 90 days)
          signedUrlExpires: env.int('AWS_SIGNED_URL_EXPIRES', 60 * 60 * 24 * 7),
        } : {},
        // Upload security configuration
        sizeLimit: 250 * 1024 * 1024, // 250MB max file size
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
        // Responsive image breakpoints - these create smaller versions for web display
        // The original file is ALWAYS preserved untouched for full-resolution viewing
        breakpoints: {
          xlarge: 1920,  // For large displays
          large: 1000,   // For desktop
          medium: 750,   // For tablets
          small: 500,    // For mobile
          thumbnail: 245 // For thumbnails/previews
        },
      },
    },
  };
};
