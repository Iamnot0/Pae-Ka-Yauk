/**
 * GET /api/catalog — single round-trip cashier catalog with SWR semantics.
 *
 * Headers:
 *   If-None-Match: "<stored etag>"   →  304 Not Modified when fresh
 *   No If-None-Match                 →  200 with full payload
 *
 * Response sets:
 *   ETag: "<sha>"
 *   Cache-Control: private, max-age=0, must-revalidate
 *
 * The cashier's Phase 2 client (`lib/client/catalog.ts`) reads from
 * IndexedDB instantly on mount, then calls this endpoint with the cached
 * ETag. A 304 means we can skip a full re-render; a 200 means swap the
 * IDB row and notify subscribers.
 *
 * Why bundle items + modifiers + categories: one network round-trip on
 * cold-start, one ETag to manage. Recipes / raw materials / reports stay
 * out — cashier never reads those.
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getCatalogEtag, getCatalogPayload } from '@/lib/repos/catalog';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const etag = await getCatalogEtag(user.tenantId);

    // Conditional 304 — cheap path, only one SQL call to compute the ETag.
    // The browser quotes ETag values; strip stray quotes before comparing.
    const incoming = (req.headers.get('if-none-match') ?? '').replace(/^"|"$/g, '');
    if (incoming && incoming === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: `"${etag}"`,
          'Cache-Control': 'private, max-age=0, must-revalidate',
        },
      });
    }

    const payload = await getCatalogPayload(user.tenantId);
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        ETag: `"${etag}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error('[GET /api/catalog]', msg, (e as Error).stack);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
