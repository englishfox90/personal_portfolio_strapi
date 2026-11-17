/**
 * Map a content type + document to the website path that renders it.
 * Returning null hides the Preview button for that content type (the rig's
 * live-imaging types, taxonomies, footer, etc. have no page of their own).
 */
const getPreviewPathname = (uid, document) => {
  switch (uid) {
    case 'api::post.post':
      return document?.slug ? `/blog/${document.slug}` : null;
    case 'api::portfolio-entry.portfolio-entry':
      return document?.slug ? `/portfolio/${document.slug}` : null;
    case 'api::about-page.about-page':
      return '/about';
    default:
      return null;
  }
};

module.exports = ({ env }) => {
  const clientUrl = env('CLIENT_URL', 'https://www.pfrastro.com');
  const previewSecret = env('PREVIEW_SECRET');

  return {
    auth: {
      secret: env('ADMIN_JWT_SECRET'),
    },
    apiToken: {
      salt: env('API_TOKEN_SALT'),
    },
    transfer: {
      token: {
        salt: env('TRANSFER_TOKEN_SALT'),
      },
    },
    flags: {
      nps: env.bool('FLAG_NPS', true),
      promoteEE: env.bool('FLAG_PROMOTE_EE', true),
    },
    // Content preview: the admin opens the website's /api/preview route in an
    // iframe, which checks the shared secret and turns on Next.js draft mode.
    // Disabled until PREVIEW_SECRET is set, so no unauthenticated preview URLs
    // are ever generated. See docs/PREVIEW.md.
    preview: {
      enabled: Boolean(previewSecret),
      config: {
        allowedOrigins: [clientUrl],
        async handler(uid, { documentId, locale, status }) {
          const document = await strapi
            .documents(uid)
            .findOne({ documentId, locale, status, fields: ['slug'] })
            .catch(() => null);
          const pathname = getPreviewPathname(uid, document);
          if (!pathname) return null;

          const params = new URLSearchParams({
            url: pathname,
            secret: previewSecret,
            status: status || 'draft',
          });
          return `${clientUrl}/api/preview?${params}`;
        },
      },
    },
  };
};
