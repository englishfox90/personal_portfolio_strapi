module.exports = ({ env }) => ({
  "users-permissions": {
    config: {
      jwtSecret: env("JWT_SECRET"),
    },
  },
  upload: {
    config: {
      provider: env('UPLOAD_PROVIDER', 'local'),
      providerOptions: env('UPLOAD_PROVIDER') === 'aws-s3' ? {
        // S3-compatible storage configuration for Railway
        s3Options: {
          credentials: {
            accessKeyId: env('AWS_ACCESS_KEY_ID'),
            secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          },
          region: env('AWS_DEFAULT_REGION', 'auto'),
          endpoint: env('AWS_ENDPOINT_URL'), // Railway S3-compatible endpoint
          params: {
            ACL: env('AWS_ACL', 'public-read'),
            Bucket: env('AWS_S3_BUCKET_NAME'),
          },
        },
      } : {},
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
});
