import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return Response.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }

  // user_id is sent as form data to match FastAPI's Form(...) declaration
  const formData = new FormData();
  formData.set("user_id", user.id);

  try {
    const response = await fetch(`${backendUrl}/retry/${id}`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch {
    return Response.json(
      { error: "Failed to reach processing service. Please try again." },
      { status: 502 }
    );
  }
}
