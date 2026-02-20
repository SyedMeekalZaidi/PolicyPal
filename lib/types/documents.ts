import type { Database } from "@/lib/supabase/database.types";

export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type SetRow = Database["public"]["Tables"]["sets"]["Row"];

export type DocumentWithSet = DocumentRow & {
  sets: SetRow | null;
};

export type DocType = "company_policy" | "regulatory_source";
export type DocumentStatus = "processing" | "ready" | "failed";

export type UpdateDocumentPayload = {
  title?: string;
  version?: string | null;
  doc_type?: DocType;
  set_id?: string | null;
};

export type UploadDocumentPayload = {
  file: File;
  title: string;
  version?: string;
  doc_type: DocType;
  set_id?: string;
  /** Set row data used only for optimistic UI display — not sent to API */
  setData?: SetRow | null;
};

export type IngestResponse = {
  document_id: string;
  status: DocumentStatus;
  chunk_count?: number;
  message?: string;
  error_message?: string;
};
