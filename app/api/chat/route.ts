// Next.js SSE proxy for POST /api/chat → FastAPI POST /chat.
//
// Unlike document proxies this does NOT call .json() on the backend response.
// It pipes the ReadableStream byte-for-byte to the browser so SSE events
// arrive incrementally (PalReasoning).
//
// Critical: Content-Encoding: none prevents Next.js / Nginx from gzip-buffering
// the stream, which would cause all events to arrive at once.

import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
  "Content-Encoding": "none",
};

export async function POST(request: NextRequest) {
  // --- Auth: inject user_id server-side, never trusted from client ---
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return Response.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }

  // --- Parse body and inject user_id ---
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const enrichedBody = { ...body, user_id: user.id };

  // --- Forward to FastAPI and pipe SSE stream through ---
  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrichedBody),
    });
  } catch {
    return Response.json(
      { error: "Failed to reach processing service. Please try again." },
      { status: 502 }
    );
  }

  // Non-2xx from FastAPI (e.g. 400 UUID validation) — return as JSON error
  if (!backendResponse.ok) {
    let errorBody: unknown;
    try {
      errorBody = await backendResponse.json();
    } catch {
      errorBody = { error: "Backend error" };
    }
    return Response.json(errorBody, { status: backendResponse.status });
  }

  // Pipe the SSE stream directly — zero buffering
  return new Response(backendResponse.body, { headers: SSE_HEADERS });
}
