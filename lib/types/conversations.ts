import type { Database } from "@/lib/supabase/database.types";

export type ConversationRow =
  Database["public"]["Tables"]["conversations"]["Row"];
