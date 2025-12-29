# Strapi Comments API Documentation

## Overview

The Strapi backend includes a comments system powered by `strapi-plugin-comments`. This allows visitors to leave comments on portfolio entries and blog posts. The plugin supports:

- Threaded/nested comments (replies)
- Guest users (no account required)
- Profanity filtering (automatic)
- Abuse reporting

## API Endpoints

### Base URL
- **Development:** `http://localhost:1338/api`
- **Production:** `https://api.pfrastro.com/api`

---

## Enabled Content Types

Comments are enabled for:
- `api::portfolio-entry.portfolio-entry` - Portfolio entries
- `api::post.post` - Blog posts

---

## REST API

### 1. Get Comments (Hierarchical/Threaded)

Retrieve all comments for a content entry in a nested tree structure.

**Endpoint:** `GET /api/comments/api::<content-type>:<documentId>`

**Examples:**
```
GET /api/comments/api::portfolio-entry.portfolio-entry:abc123xyz
GET /api/comments/api::post.post:xyz789abc
```

**Response:**
```json
[
  {
    "id": 1,
    "documentId": "njx99iv4p4txuqp307ye8625",
    "content": "Beautiful image! Love the detail.",
    "blocked": false,
    "createdAt": "2024-12-28T20:13:01.649Z",
    "author": {
      "id": "guest-123",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "avatar": null
    },
    "children": [
      {
        "id": 2,
        "content": "Thanks! Took about 20 hours of integration.",
        "author": {
          "id": "author-1",
          "name": "Site Owner"
        },
        "children": []
      }
    ]
  }
]
```

---

### 2. Get Comments (Flat List with Pagination)

Get comments in a flat structure with pagination support.

**Endpoint:** `GET /api/comments/api::<content-type>:<documentId>/flat`

**Query Parameters:**
| Parameter | Description |
|-----------|-------------|
| `pagination[page]` | Page number (default: 1) |
| `pagination[pageSize]` | Items per page (default: 10) |
| `sort` | Sort order, e.g., `createdAt:desc` |

**Example:**
```
GET /api/comments/api::portfolio-entry.portfolio-entry:abc123/flat?pagination[page]=1&pagination[pageSize]=20&sort=createdAt:desc
```

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "content": "Great work!",
      "author": { "id": "guest-1", "name": "Visitor" },
      "threadOf": null,
      "createdAt": "2024-12-28T10:00:00.000Z"
    },
    {
      "id": 2,
      "content": "Thanks!",
      "author": { "id": "author-1", "name": "Site Owner" },
      "threadOf": { "id": 1 },
      "createdAt": "2024-12-28T11:00:00.000Z"
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "pageCount": 1,
      "total": 2
    }
  }
}
```

---

### 3. Post a Comment

Submit a new comment on a content entry.

**Endpoint:** `POST /api/comments/api::<content-type>:<documentId>`

**Request Body (Guest User):**
```json
{
  "author": {
    "id": "guest-uuid-12345",
    "name": "John Smith",
    "email": "john@example.com"
  },
  "content": "This is amazing work! How long did it take?",
  "threadOf": null
}
```

**Request Body (Reply to Comment):**
```json
{
  "author": {
    "id": "guest-uuid-12345",
    "name": "John Smith",
    "email": "john@example.com"
  },
  "content": "Great question, I'd like to know too!",
  "threadOf": 1
}
```

**Response:**
```json
{
  "id": 3,
  "documentId": "xyz789...",
  "content": "This is amazing work! How long did it take?",
  "blocked": false,
  "author": {
    "id": "guest-uuid-12345",
    "name": "John Smith",
    "email": "john@example.com"
  },
  "createdAt": "2024-12-28T15:30:00.000Z"
}
```

**Possible Errors:**
| Status | Reason |
|--------|--------|
| 400 | Bad words detected in content |
| 400 | Missing required fields |
| 404 | Content entry not found |

---

### 4. Update a Comment

Edit an existing comment (only the original author can edit).

**Endpoint:** `PUT /api/comments/api::<content-type>:<documentId>/comment/<commentId>`

**Request Body:**
```json
{
  "author": {
    "id": "guest-uuid-12345"
  },
  "content": "Updated comment text"
}
```

**Response:** Updated comment object

---

### 5. Delete a Comment

Remove a comment (only the original author can delete).

**Endpoint:** `DELETE /api/comments/api::<content-type>:<documentId>/comment/<commentId>?authorId=<authorId>`

**Example:**
```
DELETE /api/comments/api::portfolio-entry.portfolio-entry:abc123/comment/5?authorId=guest-uuid-12345
```

---

### 6. Report Abuse

Report a comment for moderation review.

**Endpoint:** `POST /api/comments/api::<content-type>:<documentId>/comment/<commentId>/report-abuse`

**Request Body:**
```json
{
  "reason": "BAD_LANGUAGE",
  "content": "This comment contains offensive language"
}
```

**Available Reasons:**
- `BAD_LANGUAGE`
- `DISCRIMINATION`
- `SPAM`
- `OTHER`

---

## Integration Examples

### React Hook for Comments

```typescript
import { useState, useEffect } from 'react';

const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL || 'https://api.pfrastro.com';

interface Author {
  id: string;
  name: string;
  email?: string;
}

interface Comment {
  id: number;
  documentId: string;
  content: string;
  author: Author;
  createdAt: string;
  children?: Comment[];
  threadOf?: { id: number } | null;
}

export function useComments(contentType: string, documentId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const relation = `api::${contentType}.${contentType}:${documentId}`;

  const fetchComments = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${STRAPI_URL}/api/comments/${relation}`);
      if (!response.ok) throw new Error('Failed to fetch comments');
      const data = await response.json();
      setComments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const postComment = async (content: string, author: Author, threadOf?: number) => {
    const response = await fetch(`${STRAPI_URL}/api/comments/${relation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        author,
        threadOf: threadOf || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to post comment');
    }

    // Refresh comments after posting
    await fetchComments();
    return response.json();
  };

  useEffect(() => {
    if (documentId) {
      fetchComments();
    }
  }, [documentId]);

  return { comments, loading, error, postComment, refetch: fetchComments };
}
```

### Comment Form Component

```tsx
'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface CommentFormProps {
  onSubmit: (content: string, author: Author, threadOf?: number) => Promise<void>;
  replyTo?: number;
  onCancel?: () => void;
}

export function CommentForm({ onSubmit, replyTo, onCancel }: CommentFormProps) {
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get or create a guest ID stored in localStorage
  const getGuestId = () => {
    if (typeof window === 'undefined') return uuidv4();
    let guestId = localStorage.getItem('commentGuestId');
    if (!guestId) {
      guestId = uuidv4();
      localStorage.setItem('commentGuestId', guestId);
    }
    return guestId;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await onSubmit(
        content,
        { id: getGuestId(), name, email },
        replyTo
      );
      setContent('');
      if (!replyTo) {
        // Only clear name/email for top-level comments
        // Keep them for replies in the same session
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!replyTo && (
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="px-3 py-2 border rounded"
          />
          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="px-3 py-2 border rounded"
          />
        </div>
      )}
      <textarea
        placeholder={replyTo ? "Write a reply..." : "Write a comment..."}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
        rows={3}
        className="w-full px-3 py-2 border rounded"
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Posting...' : replyTo ? 'Reply' : 'Post Comment'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border rounded hover:bg-gray-100"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
```

### Full Comments Section Component

```tsx
'use client';

import { useState } from 'react';
import { useComments } from '@/hooks/useComments';
import { CommentForm } from './CommentForm';

interface CommentsSectionProps {
  contentType: 'portfolio-entry' | 'post';
  documentId: string;
}

export function CommentsSection({ contentType, documentId }: CommentsSectionProps) {
  const { comments, loading, error, postComment } = useComments(contentType, documentId);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  if (loading) return <div>Loading comments...</div>;
  if (error) return <div>Error loading comments: {error}</div>;

  const renderComment = (comment: Comment, depth = 0) => (
    <div key={comment.id} className={`${depth > 0 ? 'ml-8 border-l pl-4' : ''}`}>
      <div className="bg-gray-50 p-4 rounded mb-2">
        <div className="flex justify-between items-start mb-2">
          <span className="font-semibold">{comment.author.name}</span>
          <span className="text-sm text-gray-500">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className="mb-2">{comment.content}</p>
        <button
          onClick={() => setReplyingTo(comment.id)}
          className="text-sm text-blue-600 hover:underline"
        >
          Reply
        </button>
      </div>
      
      {replyingTo === comment.id && (
        <div className="ml-8 mb-4">
          <CommentForm
            onSubmit={postComment}
            replyTo={comment.id}
            onCancel={() => setReplyingTo(null)}
          />
        </div>
      )}
      
      {comment.children?.map((child) => renderComment(child, depth + 1))}
    </div>
  );

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold">Comments ({comments.length})</h3>
      
      <CommentForm onSubmit={postComment} />
      
      <div className="space-y-4 mt-8">
        {comments.length === 0 ? (
          <p className="text-gray-500">No comments yet. Be the first to comment!</p>
        ) : (
          comments.map((comment) => renderComment(comment))
        )}
      </div>
    </div>
  );
}
```

### Usage in Page

```tsx
// app/portfolio/[slug]/page.tsx
import { CommentsSection } from '@/components/CommentsSection';

export default async function PortfolioPage({ params }: { params: { slug: string } }) {
  // Fetch portfolio entry...
  const entry = await getPortfolioEntry(params.slug);

  return (
    <main>
      {/* Portfolio content */}
      <h1>{entry.title}</h1>
      
      {/* Comments section */}
      <CommentsSection 
        contentType="portfolio-entry" 
        documentId={entry.documentId} 
      />
    </main>
  );
}
```

---

## Author ID Strategy

For guest comments, use a persistent ID stored in localStorage:

```javascript
// Generate once, reuse for all comments from this visitor
const getOrCreateGuestId = () => {
  let id = localStorage.getItem('commentGuestId');
  if (!id) {
    id = crypto.randomUUID(); // or uuid v4
    localStorage.setItem('commentGuestId', id);
  }
  return id;
};
```

This allows:
- Users to edit/delete their own comments
- Consistent identity across sessions
- No registration required

---

## Important Notes

1. **Profanity Filter:** Comments with bad words are automatically rejected with a 400 error.

2. **No Approval Flow:** Comments appear immediately (moderation is done post-publication via admin panel).

3. **Email Privacy:** Author emails are stored but can be excluded from API responses by configuring `blockedAuthorProps` on the backend.

4. **Rate Limiting:** Consider implementing client-side rate limiting to prevent spam.

---

## Error Handling

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Validation error (bad words, missing fields) |
| 404 | Content entry not found |
| 409 | Conflict (editing non-existent or non-owned comment) |
| 500 | Server error |

**Error Response Format:**
```json
{
  "error": {
    "status": 400,
    "name": "ValidationError",
    "message": "Bad words are not allowed"
  }
}
```

---

## Questions?

Contact the backend team if you need:
- GraphQL support enabled
- Different moderation settings
- Email notifications for new comments
- Additional content types enabled
