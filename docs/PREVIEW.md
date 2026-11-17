# Content preview

Strapi's built-in Preview (free plan: full-screen preview inside the admin) is
wired to the website's Next.js draft mode.

## How it works

1. In the Content Manager, an entry's **Open preview** button calls the
   `preview.config.handler` in `config/admin.js`.
2. The handler maps the content type to a website path and returns
   `CLIENT_URL/api/preview?url=<path>&secret=<PREVIEW_SECRET>&status=<draft|published>`:

   | Content type        | Path                 |
   |---------------------|----------------------|
   | `post`              | `/blog/<slug>`       |
   | `portfolio-entry`   | `/portfolio/<slug>`  |
   | `about-page`        | `/about`             |

   Every other type returns `null`, which hides the button (the rig's
   live-imaging types, taxonomies, footer, observing log).
3. The website route checks the secret, enables draft mode (or disables it for
   the "Published" tab) and redirects. While draft mode is on,
   `getPostBySlug`, `getPortfolioEntryBySlug` and `getAboutPage` fetch with
   `status=draft` and no cache, posts ignore the `publishStatus` filter, and a
   "Preview · draft content" banner with an **Exit preview** link is shown.

An entry needs a slug before it can be previewed. The button is disabled while
there are unsaved changes - save first.

## Setup

Generate one long random string and set it on **both** Railway services:

| Service | Variables |
|---|---|
| Strapi  | `PREVIEW_SECRET`, `CLIENT_URL` (default `https://www.pfrastro.com`) |
| Website | `PREVIEW_SECRET` |

Preview stays disabled in Strapi until `PREVIEW_SECRET` is set. `CLIENT_URL` is
also added to the admin's CSP `frame-src` in `config/middlewares.js` so the
iframe is allowed. For local testing point `CLIENT_URL` at
`http://localhost:3000`.

`STRAPI_API_TOKEN` (the website's token) must be allowed to read drafts; a
read-only or full-access token is.

Side-by-side Live Preview and in-place editing need a paid Strapi plan and are
not set up.
