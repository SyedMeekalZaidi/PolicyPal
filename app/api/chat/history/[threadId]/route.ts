// Next.js JSON proxy for GET /api/chat/history/[threadId] → FastAPI GET /chat/history/{thread_id}.
//
// Unlike the /api/chat proxy this is a regular JSON response (not SSE).
// Injects user_id as a query param so the backend can verify conversation ownership.

import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return Response.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(
      `${backendUrl}/chat/history/${threadId}?user_id=${user.id}`
    );
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch {
    return Response.json(
      { error: "Failed to reach processing service. Please try again." },
      { status: 502 }
    );
  }
}
