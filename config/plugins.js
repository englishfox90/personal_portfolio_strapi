module.exports = ({ env }) => {
  const isS3 = env('UPLOAD_PROVIDER', 'aws-s3') === 'aws-s3';
  
  return {
    // SEO plugin - helps with meta tags and search engine optimization
    seo: {
      enabled: true,
    },
    // Comments plugin - must be before graphql if using GraphQL
    comments: {
      enabled: true,
      config: {
        badWords: true, // Enable profanity filtering
        moderatorRoles: ['Super Admin', 'Author'],
        approvalFlow: [], // No approval needed - comments visible immediately
        entryLabel: {
          '*': ['Title', 'title', 'Name', 'name', 'Subject', 'subject'],
          'api::portfolio-entry.portfolio-entry': ['title'],
          'api::post.post': ['title'],
        },
        // Content types that can have comments
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
      },
    },
    documentation: {
    enabled: true,
    config: {
      openapi: '3.0.0',
      info: {
        version: '1.0.0',
        title: 'Personal Portfolio API',
        description: 'API documentation for the personal portfolio application',
        contact: {
          name: 'API Support',
          email: 'pfoxreeks@gmail.com',
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0.html'
        },
      },
      'x-strapi-config': {
        plugins: ['upload', 'users-permissions'],
        path: '/documentation',
      },
      servers: [
        {
          url: 'http://localhost:1338/api',
          description: 'Development server',
        },
        {
          url: 'https://api.pfrastro.com/api',
          description: 'Production server',
        },
      ],
      externalDocs: {
        description: 'Find out more',
        url: 'https://docs.strapi.io/developer-docs/latest/getting-started/introduction.html'
      },
    },
  },
  };
};
