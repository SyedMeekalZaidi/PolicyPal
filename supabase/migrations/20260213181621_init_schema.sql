-- PolicyPal Initial Schema
-- Tables: profiles, sets, documents, chunks, conversations
-- Includes: pgvector extension, RLS policies, indexes, storage bucket, auto-profile trigger

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- TABLES
-- =============================================================================

-- Profiles: extends auth.users with app-specific fields
-- Trigger auto-creates row on signup (see bottom of file)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  industry TEXT,                -- e.g. "Banking", "Insurance" (agent context)
  location TEXT,                -- e.g. "Malaysia", "UK" (agent context)
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Sets: user-defined document groupings with color coding
CREATE TABLE sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,           -- e.g. "Bank Negara", "ISO 27001"
  color TEXT NOT NULL DEFAULT '#3B82F6',  -- hex from preset palette
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, name)        -- prevent duplicate set names per user
);

-- Documents: PDF metadata and storage reference
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  set_id UUID REFERENCES sets(id) ON DELETE SET NULL,  -- optional grouping
  title TEXT NOT NULL,          -- user-defined title
  version TEXT,                 -- e.g. "2024", "Q1 2025"
  doc_type TEXT NOT NULL CHECK (doc_type IN ('company_policy', 'regulatory_source')),
  storage_path TEXT NOT NULL,   -- supabase storage path: {user_id}/{doc_id}/{filename}
  chunk_count INTEGER DEFAULT 0, -- denormalized: retrieval strategies need doc size
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Chunks: embedded text segments for RAG retrieval
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL, -- position within document (0-based)
  page INTEGER,                 -- PDF page number (nullable)
  content TEXT NOT NULL,         -- actual chunk text
  embedding vector(1536),       -- text-embedding-3-small output dimension
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Conversations: chat thread metadata for sidebar UI
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New Conversation',
  last_message_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Fast document listing per user
CREATE INDEX idx_documents_user_id ON documents(user_id);

-- Fast chunk retrieval per document (used by all action nodes)
CREATE INDEX idx_chunks_user_document ON chunks(user_id, document_id);

-- Vector similarity search (cosine distance, HNSW for speed)
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

-- Fast conversation listing per user (sidebar)
CREATE INDEX idx_conversations_user_id ON conversations(user_id, last_message_at DESC);

-- Fast set listing per user
CREATE INDEX idx_sets_user_id ON sets(user_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Profiles (id = auth.uid, since profile.id IS the auth user id)
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can create own profile"
  ON profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (id = auth.uid());

-- Sets
CREATE POLICY "Users can view own sets"
  ON sets FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own sets"
  ON sets FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own sets"
  ON sets FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own sets"
  ON sets FOR DELETE USING (user_id = auth.uid());

-- Documents
CREATE POLICY "Users can view own documents"
  ON documents FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own documents"
  ON documents FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own documents"
  ON documents FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE USING (user_id = auth.uid());

-- Chunks (no UPDATE: chunks are immutable, delete + re-ingest)
CREATE POLICY "Users can view own chunks"
  ON chunks FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own chunks"
  ON chunks FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own chunks"
  ON chunks FOR DELETE USING (user_id = auth.uid());

-- Conversations
CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own conversations"
  ON conversations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own conversations"
  ON conversations FOR DELETE USING (user_id = auth.uid());

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-create profile row when user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at timestamp on profiles and sets
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER sets_updated_at
  BEFORE UPDATE ON sets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================
-- STORAGE
-- =============================================================================

-- Create private bucket for document PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can only access files in their own folder
-- Storage path convention: {user_id}/{document_id}/{filename}
CREATE POLICY "Users can upload to own folder"
  ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own files"
  ON storage.objects FOR SELECT USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own files"
  ON storage.objects FOR DELETE USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
