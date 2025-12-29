module.exports = ({ env }) => {
  const isS3 = env('UPLOAD_PROVIDER', 'aws-s3') === 'aws-s3';
  
  return {
    "users-permissions": {
      config: {
        jwtSecret: env("JWT_SECRET"),
      },
    },
    upload: {
      config: {
        provider: isS3 ? 'aws-s3' : 'local',
        providerOptions: isS3 ? {
          s3Options: {
            credentials: {
              accessKeyId: env('AWS_ACCESS_KEY_ID'),
              secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
            },
            region: env('AWS_DEFAULT_REGION', 'auto'),
            endpoint: env('AWS_ENDPOINT_URL'),
            forcePathStyle: true, // Required for Railway S3-compatible storage
            params: {
              Bucket: env('AWS_S3_BUCKET_NAME'),
            },
          },
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
