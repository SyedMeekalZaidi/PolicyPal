## Implementation Plan: Onboarding + Dashboard Gate (Task 3 & 4)

### Overview
Implement a **first-login onboarding gate** that collects company context (for better AI answers) and prevents dashboard access until required profile fields are saved. This is built on top of the existing Supabase Auth flow and the existing `profiles` table (auto-created by trigger).

### Scope (What problem we’re solving)
- **User experience**: after login, user sees a short welcome animation and a simple onboarding form.
- **Data capture**: collect the minimum company context needed for higher-quality responses.
- **Access control**: user cannot access the dashboard until onboarding is completed.
- **Dashboard**: create a **skeleton UI** (layout only) to unblock next iterations.

### Non-goals (to avoid scope creep)
- No document ingestion, RAG, LangGraph, or chat functionality in this task.
- No advanced org/team features (single-user profile only).
- No middleware-level DB checks (keep edge logic simple and reliable).

---

### Current State (confirmed from repo)
- **Auth redirect**: login pushes to `/protected` (client-side), and server-side `/protected` already checks auth claims.
- **Profiles table** exists with `id`, `industry`, `location`, timestamps; row is auto-created on signup via trigger.
- **No `middleware.ts`**: session refresh + baseline auth redirect is handled via Supabase’s `proxy.ts` convention.
- **UI primitives**: `components/ui/` currently lacks combobox/search-select building blocks (`popover`, `command`, `tooltip`, `textarea`).

---

### Key Decisions (Architecture)
1. **Use `/protected` as a single “gate” route**
   - `/protected` becomes a server-side router that decides:
     - not logged in → `/auth/login`
     - logged in but onboarding incomplete → `/onboarding`
     - logged in and onboarding complete → `/dashboard`
   - This keeps the app scalable: any future “must-do setup” adds one check in one place.

2. **Do NOT modify or rename `proxy.ts`**
   - Keep it focused on session refresh + basic auth redirect.
   - Avoid DB reads in edge/proxy code (harder to debug, more brittle, unnecessary here).

3. **Reuse existing DB columns where safe**
   - “Country” will be stored in `profiles.location` for now (label it as Country in UI).
   - This avoids risky column renames and stays aligned with existing “industry/location” prompt-context references.

4. **Onboarding is required if and only if required fields are missing**
   - Required: **Company name**, **Industry**, **Country**
   - Optional: **Company description** (with tooltip guidance)

---

### Data Model (Supabase)
#### Schema change required
Add fields to `profiles`:
- `company_name` (TEXT, required for onboarding completeness)
- `company_description` (TEXT, optional)

#### Existing fields reused
- `industry` (TEXT) → becomes a dropdown-with-search in UI
- `location` (TEXT) → treated as **Country** (dropdown-with-search in UI)

#### Files impacted
- New migration under `supabase/migrations/` (add columns to `profiles`)
- Regenerate/update `lib/supabase/database.types.ts` after migration so types stay accurate

---

### UI/UX Requirements
#### Onboarding flow (first login)
- **Welcome animation**
  - Text: `Hi <Display Name>` and `Welcome to PolicyPal`
  - Fade out and up after a short delay
- **Form fades in and up**
  - Title: “Let’s get started”
  - Glassmorphism card container (uses the existing glass utilities from `app/globals.css`)

#### Fields
- **Company Name** (required)
- **Country** (required, dropdown with search)
- **Industry** (required, dropdown with search)
- **Company Description** (optional, textarea)
  - Include a tooltip: examples of what to type (operations, purpose, what you do, regulated activities) to improve AI accuracy.

#### Design consistency updates
- Apply the same glassmorphism “card” container style to **auth forms** (login/sign-up/forgot) to maintain a consistent premium look.

---

## API Contract
### This task (now)
- **Frontend (Next.js)** reads and writes profile data directly via Supabase (RLS-secured).
- No FastAPI changes required for onboarding itself.

### Follow-on (later, referenced in `features.md`)
- When FastAPI endpoints are built, Next.js will pass `user_id` + selected profile context (industry/country/company) to the backend for prompt tailoring.

---

## Phase 1: Database + Types (Foundation)
**Goal:** Add required profile fields safely and keep types in sync.

**Files:**
- `supabase/migrations/<new>_add_profile_company_fields.sql` (new)
- `lib/supabase/database.types.ts` (regenerate/update)

**Tasks:**
1. [ ] Add `company_name` and `company_description` columns to `profiles`.
2. [ ] Ensure RLS policies remain valid (they already key off `id = auth.uid()`).
3. [ ] Update types so the app can type-check profile reads/writes.

**Test:**
- Existing users still authenticate.
- New users still get an auto-created `profiles` row.
- Profile updates succeed for authenticated users.

---

## Phase 2: Profile “Completeness” Gate (Correctness-critical)
**Goal:** Enforce onboarding completion before allowing dashboard access.

**Files:**
- `app/protected/page.tsx` (update: becomes the gate router)
- `app/dashboard/page.tsx` (new)
- `app/onboarding/page.tsx` (new)
- (Optional) `lib/profile/profile-gate.ts` (new helper: single source of truth for completeness rules)

**Tasks:**
1. [ ] Define “profile complete” rules:
   - Required: `company_name`, `industry`, `location` (Country)
   - Optional: `company_description`
2. [ ] Update `/protected` to:
   - confirm auth
   - fetch `profiles` row for the user
   - redirect based on completeness
3. [ ] Add the same gate checks to `/dashboard` so direct URL entry can’t bypass onboarding.

**Test:**
- Log in with empty profile → always ends at `/onboarding`.
- After saving onboarding → `/protected` and `/dashboard` both land at `/dashboard`.
- Logged out → `/dashboard` redirects to `/auth/login`.

---

## Phase 3: Onboarding UI + Save Flow (UX-critical)
**Goal:** Create the welcome animation + form, and persist data reliably.

**Files:**
- `app/onboarding/page.tsx` (server gate + render)
- `components/onboarding/onboarding-form.tsx` (new)
- `components/shared/search-select.tsx` (new reusable combobox-with-search)
- `lib/constants/countries.ts` (new)
- `lib/constants/industries.ts` (new)
- `components/ui/` additions (shadcn primitives as needed)

**UI primitives likely needed (to add, if missing):**
- `components/ui/popover.tsx` (+ `@radix-ui/react-popover`)
- `components/ui/command.tsx` (+ `cmdk`)
- `components/ui/tooltip.tsx` (+ `@radix-ui/react-tooltip`)
- `components/ui/textarea.tsx` (no external dependency; aligns with shadcn)

**Tasks:**
1. [ ] Display name resolution:
   - Prefer `first_name`/`last_name` from Supabase user metadata
   - Fallback to email prefix
2. [ ] Welcome animation (fade out) → form fades in.
3. [ ] Build the glassmorphism form container (reuse existing glass utilities).
4. [ ] Implement Country + Industry searchable dropdowns using one reusable component.
5. [ ] Validate required fields (use `zod` since already installed).
6. [ ] Save profile values (update existing `profiles` row).
7. [ ] On success → route to `/dashboard`; on error → show inline error.

**Test:**
- Required fields enforced.
- Dropdown search works smoothly and is keyboard accessible.
- Save shows loading state and prevents double-submits.
- After save, refresh `/dashboard` still works (gate passes).

---

## Phase 4: Dashboard Skeleton (Layout-only)
**Goal:** Build the app shell layout that matches the intended UX, without implementing chat logic yet.

**Files:**
- `app/dashboard/page.tsx` (new)
- `components/dashboard/sidebar-right.tsx` (new, placeholder)
- `components/dashboard/chat-list.tsx` (new, placeholder)
- `components/dashboard/chat-panel.tsx` (new, placeholder)

**Layout requirements:**
- Left: chat list column (empty state)
- Center: chat panel column (empty state + input placeholder)
- Right: vertical sidebar (placeholders: Actions/Sets/Documents)
- Use glassmorphism cards consistently for panels/containers.

**Test:**
- Layout renders at common desktop widths (1366/1440/1920).
- No overflow/layout shift; empty states look intentional.

---

## Phase 5: Auth Forms Glassmorphism Consistency (Design polish, low risk)
**Goal:** Ensure auth pages match the same glass design language as onboarding.

**Files:**
- `app/auth/layout.tsx` (wrap form area in glass card container)
- `components/login-form.tsx` / `components/sign-up-form.tsx` / `components/forgot-password-form.tsx` (minimal changes; keep logic intact)

**Tasks:**
1. [ ] Introduce a single shared “AuthGlassCard” wrapper (either in layout or shared component).
2. [ ] Ensure inputs/buttons remain shadcn and preserve validation/error behavior.

**Test:**
- All auth pages still work end-to-end with no auth logic changes.

---

## Risks + Mitigations
- **DB migration risk**: breaking types or existing flows  
  - Mitigation: add-only columns (no renames), regenerate types immediately.
- **Combobox/search-select complexity**: new UI primitives + dependencies  
  - Mitigation: build one reusable `SearchSelect` and reuse for both Country + Industry.
- **Bypass risk**: user manually navigates to `/dashboard`  
  - Mitigation: gate checks in both `/protected` and `/dashboard`.

---

## Demo Considerations (must be flawless)
- [ ] First-login flow completes in <10 seconds (no long waits).
- [ ] Clear loading + error states on save.
- [ ] No console errors.
- [ ] Dashboard loads even with no conversations/documents (great empty states).

---

### Approval Checklist
If you approve, I’ll implement in this order for maximum safety:
1) Phase 1 (DB + types) → 2) Phase 2 (gates) → 3) Phase 3 (onboarding UI) → 4) Phase 4 (dashboard shell) → 5) Phase 5 (auth glass wrapper).

