-- Add status tracking fields to documents for ingestion pipeline
-- status: tracks processing lifecycle (processing | ready | failed)
-- error_message: stores user-friendly failure reason (null on success)
-- original_filename: preserves upload filename for display and retry
--
-- Notes:
--   - status DEFAULT 'ready' so existing rows are marked as already processed
--   - original_filename is nullable: existing rows don't have filenames stored
--   - New inserts from backend will always provide both fields explicitly

ALTER TABLE documents
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN error_message TEXT,
  ADD COLUMN original_filename TEXT;

ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('processing', 'ready', 'failed'));
