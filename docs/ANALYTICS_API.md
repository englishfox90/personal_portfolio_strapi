# Analytics Tracking API Documentation

## Overview

The Strapi backend includes endpoints for tracking views and downloads. These endpoints allow the frontend to record user engagement metrics that are stored in Strapi.

## API Endpoints

### Base URL
- **Development:** `http://localhost:1338/api`
- **Production:** `https://api.pfrastro.com/api`

---

## Tracking Endpoints

### 1. Track Portfolio Entry View

Increment the view count when a user visits a portfolio entry page.

**Endpoint:** `POST /api/portfolio-entries/:documentId/view`

**Example:**
```
POST /api/portfolio-entries/abc123xyz/view
```

**Response:**
```json
{
  "data": {
    "id": 1,
    "documentId": "abc123xyz",
    "title": "Orion Nebula",
    "views": 156
  },
  "meta": {
    "previousCount": 155,
    "newCount": 156
  }
}
```

---

### 2. Track Blog Post View

Increment the view count when a user visits a blog post.

**Endpoint:** `POST /api/posts/:documentId/view`

**Example:**
```
POST /api/posts/xyz789abc/view
```

**Response:**
```json
{
  "data": {
    "id": 5,
    "documentId": "xyz789abc",
    "title": "Getting Started with Astrophotography",
    "views": 89
  },
  "meta": {
    "previousCount": 88,
    "newCount": 89
  }
}
```

---

### 3. Track Program Download

Increment the download count when a user downloads a program.

**Endpoint:** `POST /api/programs/:documentId/download`

**Example:**
```
POST /api/programs/def456ghi/download
```

**Response:**
```json
{
  "data": {
    "id": 2,
    "documentId": "def456ghi",
    "name": "ASIOverlayWatchdog",
    "downloads": 43
  },
  "meta": {
    "previousCount": 42,
    "newCount": 43
  }
}
```

---

## Integration Examples

### TypeScript Tracking Functions

```typescript
const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL || 'https://api.pfrastro.com';

/**
 * Track a portfolio entry view
 */
export async function trackPortfolioView(documentId: string): Promise<void> {
  try {
    await fetch(`${STRAPI_URL}/api/portfolio-entries/${documentId}/view`, {
      method: 'POST',
    });
  } catch (error) {
    // Silently fail - don't break the user experience for analytics
    console.error('Failed to track portfolio view:', error);
  }
}

/**
 * Track a blog post view
 */
export async function trackPostView(documentId: string): Promise<void> {
  try {
    await fetch(`${STRAPI_URL}/api/posts/${documentId}/view`, {
      method: 'POST',
    });
  } catch (error) {
    console.error('Failed to track post view:', error);
  }
}

/**
 * Track a program download
 */
export async function trackDownload(documentId: string): Promise<void> {
  try {
    await fetch(`${STRAPI_URL}/api/programs/${documentId}/download`, {
      method: 'POST',
    });
  } catch (error) {
    console.error('Failed to track download:', error);
  }
}
```

---

### React Hook for View Tracking

```typescript
import { useEffect, useRef } from 'react';

/**
 * Hook to track page views once per page load
 * Prevents duplicate tracking on re-renders
 */
export function useTrackView(
  type: 'portfolio' | 'post',
  documentId: string | undefined
) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!documentId || tracked.current) return;

    const trackView = async () => {
      const endpoint = type === 'portfolio' 
        ? `portfolio-entries/${documentId}/view`
        : `posts/${documentId}/view`;

      try {
        await fetch(`${process.env.NEXT_PUBLIC_STRAPI_URL}/api/${endpoint}`, {
          method: 'POST',
        });
        tracked.current = true;
      } catch (error) {
        console.error(`Failed to track ${type} view:`, error);
      }
    };

    trackView();
  }, [type, documentId]);
}
```

**Usage:**
```tsx
// app/portfolio/[slug]/page.tsx
'use client';

import { useTrackView } from '@/hooks/useTrackView';

export default function PortfolioPage({ entry }) {
  useTrackView('portfolio', entry.documentId);

  return (
    <main>
      <h1>{entry.title}</h1>
      {/* ... */}
    </main>
  );
}
```

---

### Download Button Component

```tsx
'use client';

import { trackDownload } from '@/lib/analytics';

interface DownloadButtonProps {
  documentId: string;
  downloadUrl: string;
  programName: string;
}

export function DownloadButton({ documentId, downloadUrl, programName }: DownloadButtonProps) {
  const handleDownload = () => {
    // Track the download (fire and forget)
    trackDownload(documentId);
    
    // The actual download happens via the href
  };

  return (
    <a
      href={downloadUrl}
      onClick={handleDownload}
      className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      download
    >
      <DownloadIcon className="w-4 h-4 mr-2" />
      Download {programName}
    </a>
  );
}
```

---

### Server Component View Tracking (Next.js App Router)

For server components, you can track views using a client component wrapper:

```tsx
// components/ViewTracker.tsx
'use client';

import { useEffect, useRef } from 'react';

interface ViewTrackerProps {
  type: 'portfolio' | 'post';
  documentId: string;
}

export function ViewTracker({ type, documentId }: ViewTrackerProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;

    const endpoint = type === 'portfolio'
      ? `portfolio-entries/${documentId}/view`
      : `posts/${documentId}/view`;

    fetch(`${process.env.NEXT_PUBLIC_STRAPI_URL}/api/${endpoint}`, {
      method: 'POST',
    }).catch(() => {});

    tracked.current = true;
  }, [type, documentId]);

  return null; // This component renders nothing
}
```

**Usage in Server Component:**
```tsx
// app/portfolio/[slug]/page.tsx
import { ViewTracker } from '@/components/ViewTracker';

export default async function PortfolioPage({ params }) {
  const entry = await getPortfolioEntry(params.slug);

  return (
    <main>
      <ViewTracker type="portfolio" documentId={entry.documentId} />
      <h1>{entry.title}</h1>
      {/* ... */}
    </main>
  );
}
```

---

## Best Practices

### 1. Fire and Forget

Don't await tracking calls or let them block the UI:

```typescript
// ✅ Good - doesn't block
const handleClick = () => {
  trackDownload(documentId); // No await
  // Continue with other logic
};

// ❌ Bad - blocks the user
const handleClick = async () => {
  await trackDownload(documentId);
  // User waits for tracking to complete
};
```

### 2. Track Once Per Session

Prevent inflating counts with duplicate tracking:

```typescript
// Use a ref to track if already counted
const tracked = useRef(false);

useEffect(() => {
  if (tracked.current) return;
  trackView(documentId);
  tracked.current = true;
}, [documentId]);
```

### 3. Handle Errors Gracefully

Never let analytics break the user experience:

```typescript
try {
  await fetch(trackingEndpoint, { method: 'POST' });
} catch {
  // Silently fail - analytics shouldn't break the app
}
```

### 4. Use Session Storage for Page Refreshes (Optional)

To prevent re-counting on page refresh within the same session:

```typescript
export function useTrackViewOnce(type: 'portfolio' | 'post', documentId: string) {
  useEffect(() => {
    if (!documentId) return;

    const storageKey = `viewed_${type}_${documentId}`;
    
    // Check if already tracked this session
    if (sessionStorage.getItem(storageKey)) return;

    const endpoint = type === 'portfolio'
      ? `portfolio-entries/${documentId}/view`
      : `posts/${documentId}/view`;

    fetch(`${process.env.NEXT_PUBLIC_STRAPI_URL}/api/${endpoint}`, {
      method: 'POST',
    })
      .then(() => {
        sessionStorage.setItem(storageKey, 'true');
      })
      .catch(() => {});
  }, [type, documentId]);
}
```

---

## Displaying Counts

The view/download counts are included in the standard content responses:

```typescript
// Fetch portfolio entries with views
const response = await fetch(`${STRAPI_URL}/api/portfolio-entries?fields[0]=title&fields[1]=views`);
const { data } = await response.json();

// data[0].views = 156
```

```typescript
// Fetch programs with download counts
const response = await fetch(`${STRAPI_URL}/api/programs?fields[0]=name&fields[1]=downloads`);
const { data } = await response.json();

// data[0].downloads = 43
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 200 | Success - count incremented |
| 400 | Bad request - missing ID |
| 404 | Content not found |
| 500 | Server error |

**Error Response Format:**
```json
{
  "error": {
    "status": 404,
    "name": "NotFoundError",
    "message": "Portfolio entry not found"
  }
}
```

---

## Summary Table

| Content Type | Track Endpoint | Count Field |
|-------------|----------------|-------------|
| Portfolio Entry | `POST /api/portfolio-entries/:id/view` | `views` |
| Blog Post | `POST /api/posts/:id/view` | `views` |
| Program | `POST /api/programs/:id/download` | `downloads` |

---

## Questions?

Contact the backend team if you need:
- Rate limiting for abuse prevention
- IP-based deduplication
- More detailed analytics (referrer, user agent, etc.)
- Batch tracking endpoints
