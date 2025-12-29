# Railway S3-Compatible Storage Setup

This project is configured to use S3-compatible storage for media uploads to persist files across server restarts.

## Required Environment Variables

Add the following environment variables to your Railway project:

### For Railway's Built-in S3-Compatible Storage:

```env
# Upload provider configuration
UPLOAD_PROVIDER=aws-s3

# Railway automatically provides these when you create a bucket
# Use variable references: ${{Bucket.ACCESS_KEY_ID}}, etc.
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=auto
AWS_BUCKET=your_bucket_name  # This is BUCKET from Railway, includes the hash suffix
AWS_ENDPOINT_URL=https://storage.railway.app
```

### Alternative: Using Amazon S3 Directly:

```env
UPLOAD_PROVIDER=aws-s3
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
AWS_BUCKET=your_bucket_name
# Leave AWS_ENDPOINT_URL empty for standard AWS S3
```

## How to Enable in Railway:

1. Go to your Railway project dashboard
2. Navigate to your service settings
3. Click on "Variables" tab
4. Add the required environment variables above
5. Railway will automatically restart your service

## Alternative Storage Options:

If you prefer, you can also use:
- **Cloudinary**: Install `@strapi/provider-upload-cloudinary`
- **Other S3-compatible services**: DigitalOcean Spaces, Backblaze B2, etc.

## Local Development:

For local development, keep the default `local` provider by not setting `UPLOAD_PROVIDER` environment variable, or set:

```env
UPLOAD_PROVIDER=local
```

## Testing the Configuration:

1. Upload a file through the Strapi admin panel
2. Restart your Railway service
3. Check if the uploaded file is still accessible

## Notes:

- The configuration automatically falls back to `local` provider if environment variables are not set
- Security middleware is configured to allow loading images from your S3 bucket
- Files are set to `public-read` ACL by default for public access
