import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  // Inject authenticated user_id — client cannot spoof this
  formData.set("user_id", user.id);

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return Response.json(
      { error: "Backend service unavailable" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(`${backendUrl}/ingest`, {
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
