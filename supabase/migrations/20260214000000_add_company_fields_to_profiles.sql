-- Add company context fields to profiles for onboarding + LLM tailoring
-- Safe migration: nullable columns so existing trigger-created profiles remain valid.

ALTER TABLE profiles
  ADD COLUMN company_name TEXT,
  ADD COLUMN company_description TEXT;

