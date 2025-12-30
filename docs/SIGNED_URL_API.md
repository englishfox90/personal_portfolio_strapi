# Strapi Signed URL API Documentation

## Overview

The Strapi backend uses Railway's private S3-compatible storage for media files. Since the bucket is private, images cannot be accessed directly via public URLs. Instead, the frontend must request **signed URLs** (temporary, authenticated URLs) to display images.

## API Endpoints

### Base URL
- **Development:** `http://localhost:1338/api`
- **Production:** `https://api.pfrastro.com/api`

---

### 1. Get Single Signed URL

Generate a signed URL for a single file.

**Endpoint:** `POST /signed-url`

**Request:**
```json
{
  "url": "Christmas_Tree_47f57970a1.png"
}
```

**Response:**
```json
{
  "url": "https://storage.railway.app/indexed-cart-xxx/Christmas_Tree_47f57970a1.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...",
  "expiresIn": 604800
}
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The signed URL that can be used in `<img src="">` |
| `expiresIn` | number | URL expiration time in seconds (default: 7 days) |

---

### 2. Get Multiple Signed URLs (Batch)

Generate signed URLs for multiple files in a single request. More efficient when loading pages with many images.

**Endpoint:** `POST /signed-urls`

**Request:**
```json
{
  "urls": [
    "Christmas_Tree_47f57970a1.png",
    "thumbnail_Christmas_Tree_47f57970a1.png",
    "large_Christmas_Tree_47f57970a1.png"
  ]
}
```

**Response:**
```json
{
  "urls": [
    {
      "original": "Christmas_Tree_47f57970a1.png",
      "signedUrl": "https://storage.railway.app/..."
    },
    {
      "original": "thumbnail_Christmas_Tree_47f57970a1.png",
      "signedUrl": "https://storage.railway.app/..."
    },
    {
      "original": "large_Christmas_Tree_47f57970a1.png",
      "signedUrl": "https://storage.railway.app/..."
    }
  ],
  "expiresIn": 604800
}
```

---

### 3. Get Signed URL by Key (GET - CDN Friendly)

GET request for a single signed URL - easier to cache by CDNs and browsers.

**Endpoint:** `GET /signed-url/:key`

**Example:** `GET /signed-url/Christmas_Tree_47f57970a1.png`

**Response:**
```json
{
  "url": "https://storage.railway.app/indexed-cart-xxx/Christmas_Tree_47f57970a1.png?X-Amz-Algorithm=...",
  "expiresIn": 604800
}
```

---

### 4. Image Redirect (FASTEST - Direct Use in `<img src>`)

Redirects directly to the signed S3 URL. **Most performant** - use directly in `<img>` tags without JavaScript!

**Endpoint:** `GET /image/:key`

**Usage:**
```html
<img src="https://api.pfrastro.com/api/image/Christmas_Tree_47f57970a1.png" alt="Christmas Tree" />
```

The endpoint returns a **302 redirect** to the signed S3 URL. The browser follows the redirect automatically.

| Benefit | Description |
|---------|-------------|
| No JavaScript | Works in plain HTML `<img>` tags |
| Automatic caching | Browser caches the redirect |
| CDN friendly | CDNs can cache the redirect response |
| Simpler frontend | No need for signed URL hooks/state |

---

## Integration Examples

### Basic Fetch Example

```javascript
async function getSignedUrl(fileUrl) {
  const response = await fetch('https://api.pfrastro.com/api/signed-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: fileUrl }),
  });
  
  const data = await response.json();
  return data.url;
}

// Usage
const signedUrl = await getSignedUrl('Christmas_Tree_47f57970a1.png');
```

### React Hook Example

```javascript
import { useState, useEffect } from 'react';

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL || 'https://api.pfrastro.com';

export function useSignedUrl(url) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    async function fetchSignedUrl() {
      try {
        const response = await fetch(`${STRAPI_URL}/api/signed-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        if (!response.ok) throw new Error('Failed to get signed URL');

        const data = await response.json();
        setSignedUrl(data.url);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchSignedUrl();
  }, [url]);

  return { signedUrl, loading, error };
}

// Usage in component
function PortfolioImage({ imageUrl, alt }) {
  const { signedUrl, loading, error } = useSignedUrl(imageUrl);

  if (loading) return <div className="skeleton" />;
  if (error) return <div>Failed to load image</div>;

  return <img src={signedUrl} alt={alt} />;
}
```

### Batch Loading for Lists

```javascript
export async function getSignedUrls(urls) {
  const response = await fetch(`${STRAPI_URL}/api/signed-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });

  const data = await response.json();
  
  // Convert to a map for easy lookup
  const urlMap = {};
  data.urls.forEach(item => {
    urlMap[item.original] = item.signedUrl;
  });
  
  return urlMap;
}

// Usage: When fetching portfolio entries
async function getPortfolioWithSignedUrls() {
  // 1. Fetch portfolio data from Strapi
  const res = await fetch(`${STRAPI_URL}/api/portfolio-entries?populate=*`);
  const portfolio = await res.json();

  // 2. Collect all image URLs
  const imageUrls = portfolio.data.flatMap(entry => {
    const urls = [];
    if (entry.attributes.image?.data?.attributes?.url) {
      urls.push(entry.attributes.image.data.attributes.url);
    }
    // Add thumbnails, formats, etc.
    const formats = entry.attributes.image?.data?.attributes?.formats;
    if (formats) {
      Object.values(formats).forEach(format => {
        if (format.url) urls.push(format.url);
      });
    }
    return urls;
  });

  // 3. Get signed URLs in batch
  const signedUrlMap = await getSignedUrls(imageUrls);

  // 4. Replace URLs in portfolio data
  portfolio.data.forEach(entry => {
    const img = entry.attributes.image?.data?.attributes;
    if (img?.url) {
      img.signedUrl = signedUrlMap[img.url];
    }
    if (img?.formats) {
      Object.values(img.formats).forEach(format => {
        if (format.url) {
          format.signedUrl = signedUrlMap[format.url];
        }
      });
    }
  });

  return portfolio;
}
```

### Next.js Image Component

```javascript
// components/StrapiImage.jsx
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

export default function StrapiImage({ src, alt, width, height, ...props }) {
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    if (!src) return;

    fetch('/api/strapi-signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: src }),
    })
      .then(res => res.json())
      .then(data => setSignedUrl(data.url))
      .catch(console.error);
  }, [src]);

  if (!signedUrl) {
    return <div style={{ width, height }} className="animate-pulse bg-gray-200" />;
  }

  return (
    <Image
      src={signedUrl}
      alt={alt}
      width={width}
      height={height}
      {...props}
    />
  );
}
```

---

## Understanding Strapi Media Response

When you query Strapi with `?populate=*`, image fields return data like this:

```json
{
  "data": {
    "id": 1,
    "attributes": {
      "title": "My Portfolio Entry",
      "image": {
        "data": {
          "id": 2084,
          "attributes": {
            "name": "Christmas Tree.png",
            "url": "Christmas_Tree_47f57970a1.png",  // <-- Use this for signing
            "formats": {
              "thumbnail": {
                "url": "thumbnail_Christmas_Tree_47f57970a1.png"
              },
              "small": {
                "url": "small_Christmas_Tree_47f57970a1.png"
              },
              "medium": {
                "url": "medium_Christmas_Tree_47f57970a1.png"
              },
              "large": {
                "url": "large_Christmas_Tree_47f57970a1.png"
              }
            }
          }
        }
      }
    }
  }
}
```

The `url` fields contain the S3 key (filename). Pass these to the `/api/signed-url` endpoint to get displayable URLs.

---

## Caching Recommendations

Signed URLs are valid for **7 days** (604800 seconds) by default. The backend implements several caching strategies:

### Backend Caching (Automatic)
1. **In-memory URL cache:** Signed URLs are cached on the server, so repeated requests for the same file return instantly
2. **S3 client reuse:** Connection pooling reduces latency
3. **Cache-Control headers:** Responses include cache headers for CDN/browser caching

### Frontend Caching Recommendations
1. **Client-side caching:** Store signed URLs in React state/context to avoid re-fetching during session
2. **Server-side caching:** If using SSR, cache signed URLs with appropriate TTL (e.g., Redis with 6-day expiry)
3. **Image loading:** Use the `thumbnail` format for lists, `large` for detail views

---

## Performance Tips

### 🚀 Option 1: Direct Image Redirect (FASTEST)
Use the redirect endpoint directly in `<img src>` - eliminates JavaScript round-trip:
```html
<img src="https://api.pfrastro.com/api/image/Christmas_Tree_47f57970a1.png" alt="..." />
```
This works because the endpoint redirects (302) directly to the signed S3 URL.

### 🚀 Option 2: GET endpoint for CDN caching
```javascript
// GET request - can be cached by CDNs
const response = await fetch(`${STRAPI_URL}/api/signed-url/Christmas_Tree_47f57970a1.png`);
const data = await response.json();
```

### 🚀 Option 3: Batch requests for lists
Always use `/api/signed-urls` (batch) instead of multiple single requests when loading pages with many images.

---

## Error Handling

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Success |
| 400 | Bad request - missing `url` or `urls` parameter |
| 500 | Server error - check Strapi logs |

**Error Response:**
```json
{
  "error": {
    "status": 400,
    "name": "BadRequestError",
    "message": "URL is required"
  }
}
```

---

## Environment Variables

For your frontend project, set:

```env
NEXT_PUBLIC_STRAPI_URL=https://api.pfrastro.com
# or for development
NEXT_PUBLIC_STRAPI_URL=http://localhost:1338
```

---

## Questions?

Contact the backend team if you need:
- Different expiration times for signed URLs
- Additional image transformations
- Authentication on the signed URL endpoints
