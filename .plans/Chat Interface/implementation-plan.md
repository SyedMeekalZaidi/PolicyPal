# Implementation Plan: Chat Interface + TipTap @ Mentions

## Overview

Build conversation management (CRUD + URL-based routing) and TipTap rich text input with categorized @ mention autocomplete. Architecture uses Next.js dynamic routes (`/dashboard/[conversationId]`) so active chat state lives in the URL — survives refresh, enables server prefetch, and follows Next.js conventions. Conversation CRUD goes direct to Supabase (same pattern as documents). TipTap stores mention data as structured nodes with UUIDs — no text parsing needed.

## Key Architecture Decisions

1. **URL-based active chat:** `/dashboard` (empty state) and `/dashboard/[conversationId]` (active chat) share a layout. LeftPanel + SourcesPanel persist across navigations, only the center panel re-renders.
2. **Layout refactor:** Current `DashboardShell` becomes the center of `app/dashboard/layout.tsx`. Both pages slot into its center panel via `children`.
3. **Conversation CRUD:** Direct Supabase queries with optimistic updates (same pattern as document hooks). Hooks handle data only — navigation is the component's responsibility (via `onSuccess` callbacks).
4. **TipTap mentions:** Structured mention nodes (`{ id, label, category }`) — backend receives clean UUIDs, zero parsing.
5. **TipTap ↔ React data bridge:** ChatInput holds docs/sets via React Query hooks. A `useRef` bridges this data into TipTap's suggestion `items` function (avoids stale closures without recreating the editor).
6. **Server-side URL validation:** `[conversationId]/page.tsx` fetches and validates the conversation exists + belongs to user. Redirects to `/dashboard` if invalid.

## API Contract

No FastAPI endpoints needed for this feature. All conversation CRUD is Supabase direct.

**Message sending (designed now, built in next feature):**
```
POST /api/chat
Body: {
  message: string
  conversation_id: string
  tagged_doc_ids: string[]
  tagged_set_ids: string[]
  action: "summarize" | "inquire" | "compare" | "audit" | null
  enable_web_search: boolean
}
```

**TipTap onSubmit output shape (what the input produces):**
```
{
  text: string                  // Plain text (mention labels inline)
  tagged_doc_ids: string[]      // UUIDs from document mention nodes
  tagged_set_ids: string[]      // UUIDs from set mention nodes
  action: string | null         // From action mention node (max 1)
  enable_web_search: boolean    // From web search mention node
}
```

---

## Phase 1: Route Restructure + Types

**Goal:** Refactor dashboard from single page to layout + dynamic route. Define conversation types.

**Files:**
- `app/dashboard/layout.tsx` — NEW: Server Component. Auth + profile gate (moved from current page.tsx). Resolves userName/userEmail. Renders `<DashboardShell>{children}</DashboardShell>`.
- `app/dashboard/page.tsx` — REFACTOR: becomes the empty-state center panel (the `children` slotted into DashboardShell when no conversation is selected).
- `app/dashboard/[conversationId]/page.tsx` — NEW: Server Component. Validates conversationId against Supabase (exists + belongs to user). If invalid → `redirect("/dashboard")`. If valid → renders `<ChatPanel conversationId={id} initialTitle={title} />`.
- `lib/types/conversations.ts` — NEW: `ConversationRow` type derived from `database.types.ts`.
- `components/dashboard/dashboard-shell.tsx` — MODIFIED: receives `children` prop for center panel slot. Keeps LeftPanel + SourcesPanel.
- `components/dashboard/chat-panel.tsx` — MODIFIED: receives optional `conversationId` prop (null = empty state, string = active chat). Add `"use client"` directive.

**Tasks:**
1. [ ] Create `ConversationRow` type from DB schema (same pattern as `DocumentRow`)
2. [ ] Create `app/dashboard/layout.tsx` — move auth/profile gate from current page.tsx. Render `<main><DashboardShell>{children}</DashboardShell></main>`
3. [ ] Refactor `app/dashboard/page.tsx` — return empty state JSX only (Sparkles icon + "Start a conversation" message)
4. [ ] Create `app/dashboard/[conversationId]/page.tsx` — validate conversation (fetch by ID + user_id, redirect if not found), pass `conversationId` + `initialTitle` to ChatPanel
5. [ ] Update `DashboardShell` — replace hardcoded `<ChatPanel />` with `{children}` slot in center column
6. [ ] Update `ChatPanel` — add `"use client"`, accept `conversationId` and `initialTitle` props

**Test:** Navigate to `/dashboard` → see empty state. Navigate to `/dashboard/<valid-uuid>` → ChatPanel receives that ID. Navigate to `/dashboard/garbage` → redirected to `/dashboard`.

---

## Phase 2: Conversation Hooks (Data Layer)

**Goal:** Full CRUD for conversations with optimistic updates. Hooks handle data only — no routing logic.

**Files:**
- `hooks/queries/use-conversations.ts` — fetch all conversations, ordered by `last_message_at` desc
- `hooks/mutations/use-create-conversation.ts` — create + optimistic insert (returns new conversation data)
- `hooks/mutations/use-rename-conversation.ts` — rename + optimistic update
- `hooks/mutations/use-delete-conversation.ts` — delete + optimistic remove

**Architecture rule:** Hooks do data, components do navigation. All hooks follow the established pattern: `onMutate` (optimistic update), `onError` (rollback), `onSettled` (invalidate). Components use `mutate(data, { onSuccess })` for side effects like `router.push`.

**Tasks:**
1. [ ] `useConversations` — query Supabase `conversations` table, ordered by `last_message_at` desc
2. [ ] `useCreateConversation` — accepts `{ id, title }` (ID generated by component via `crypto.randomUUID()`), inserts row, optimistic add to cache. Component navigates in `onSuccess`.
3. [ ] `useRenameConversation` — accepts `{ conversation, title }`, updates title, optimistic cache update
4. [ ] `useDeleteConversation` — accepts conversation, deletes row, optimistic remove from cache. Component checks if deleted chat is active and navigates in `onSuccess`.

**TODO (future):** When LangGraph is wired, `useDeleteConversation` should also clean up orphaned checkpoints in the `checkpoints` table for the deleted `thread_id`.

**Test:** Call each hook from a temporary button. Verify cache updates instantly, rollback on error.

---

## Phase 3: Conversation List UI

**Goal:** Replace empty `ChatsContent` with full conversation list (hover menu, inline rename, delete confirmation).

**Files:**
- `components/conversations/conversation-list.tsx` — scrollable list with loading/empty states
- `components/conversations/conversation-item.tsx` — single row with hover interactions:
  - **Default state:** Title only (truncated)
  - **Hover state:** Relative timestamp appears + three-dot `DropdownMenu` icon
  - **Rename mode:** Input replaces title text. Right side shows ✓ (Check) and ✕ (X) icon buttons. Keyboard: Enter = save, Escape = cancel. **Blur = save** (unless empty, then cancel and restore original title).
  - **Active state:** Highlighted background. Uses `useParams()` from `next/navigation` to read current `conversationId` from URL — no prop drilling needed.
- Update `left-panel.tsx` — replace `ChatsContent` with `ConversationList`, wire "+" button to `useCreateConversation` (component generates UUID, navigates in `onSuccess`)

**UX Details:**
- Three-dot menu options: "Rename" and "Delete" (red text). Uses existing Shadcn `DropdownMenu`.
- Delete: confirmation dialog via Shadcn `Dialog` ("Delete conversation? This cannot be undone.")
- Rename: inline — clicking "Rename" in menu switches row to edit mode. Shows text input with ✓/✕ icon buttons on the right. Enter/Tick saves, Escape/X cancels, blur saves (if non-empty).
- Timestamp format: relative ("2h ago", "Yesterday", "Jan 15"). Only visible on hover.
- Active conversation: subtle highlight background to show which chat is selected.
- Click row → `router.push(/dashboard/{id})`

**Test:** Create conversations, see them in list. Hover → see timestamp + menu. Rename inline with tick/X. Delete with confirmation. Active chat highlighted. Navigate between chats, verify URL updates.

---

## Phase 4: TipTap Setup + Chat Input

**Goal:** Install TipTap, build the base editor component that replaces the disabled `<Input>`.

**Dependencies to install:**
- `@tiptap/react`
- `@tiptap/starter-kit`
- `@tiptap/extension-mention`
- `@tiptap/suggestion` (peer dependency of mention extension)
- `@tiptap/extension-placeholder`

**Files:**
- `components/chat/chat-input.tsx` — TipTap editor wrapper:
  - Enter = submit (calls `onSubmit` with extracted data)
  - Shift+Enter = new line
  - `@` triggers mention autocomplete
  - Styled to match design system (rounded, bg-white/20, etc.)
  - Calls `useDocuments()` and `useSets()` at top level
  - Stores docs/sets in a `useRef` for TipTap's suggestion `items` function to read (bridges React state into TipTap's lifecycle without recreating the editor)
- `lib/chat/extract-mentions.ts` — utility to walk TipTap document JSON, extract all mention nodes, categorize them, return the submit payload shape
- Update `chat-panel.tsx` — replace disabled `<Input>` with `<ChatInput onSubmit={handleSubmit} />`

**TipTap ↔ React data bridge pattern:**
```
ChatInput component:
  1. useDocuments() + useSets() → React Query data
  2. useMemo → buildMentionItems(docs, sets)
  3. useRef → mentionItemsRef.current = mentionItems (updated every render)
  4. useEditor (created once) → suggestion.items reads from mentionItemsRef.current
  Result: Editor never recreates, but always sees fresh data.
```

**Tasks:**
1. [ ] Install TipTap packages (5 packages)
2. [ ] Build `ChatInput` with TipTap editor (no mentions yet — just text + submit)
3. [ ] Build `extractMentions()` utility
4. [ ] Wire into ChatPanel — submit for now has no backend yet, payload ready for when LangGraph is wired

**Test:** Type text, press Enter → payload has correct shape. Shift+Enter makes new line. Editor styled correctly.

---

## Phase 5: Mention Dropdown (@ Autocomplete)

**Goal:** Build the categorized mention dropdown that appears when user types `@`.

**Files:**
- `components/chat/mention-list.tsx` — the dropdown popup:
  - **4 sections with distinct rendering:**
    - **Actions:** 2×2 compact grid (Summarize, Inquire, Compare, Audit). Each cell has icon + label.
    - **Sets:** List items with set color as background tint (use `hexToRgba(set.color, 0.6)`).
    - **Documents:** List items with left doc-type accent bar (gold/green) + set color background tint (60% opacity). Same visual language as `DocumentCard`.
    - **Web Search:** Single item. When selected, inserts web search mention pill.
  - Keyboard navigation: linear (flattened across all sections). Arrow up/down moves through items sequentially: Actions → Sets → Documents → Web. The 2×2 grid is visual only — keyboard treats it as 4 sequential items.
  - Typing after `@` filters all sections simultaneously
  - **Max 5 doc enforcement:** Before inserting a document mention, count existing doc mentions in the editor. If >= 5, show toast ("Maximum 5 documents per query") and reject the selection.
- `lib/chat/mention-items.ts` — builds the unified mention item list from documents, sets, and static actions. Each item: `{ id, label, category, color?, docType?, setColor? }`. Receives docs/sets as parameters (not fetched internally).
- `components/chat/mention-pill.tsx` — the styled pill that appears inline after selection. Shows category icon + label. Color-coded by category.

**Search/Filter logic (matching DocumentPanel pattern):**
- Filter by query substring match on label (case-insensitive)
- Sets whose names match → also show all their documents (same as doc panel)
- Actions match on action name
- Empty query → show all items
- No results → show "No matches" message

**Tasks:**
1. [ ] Build `buildMentionItems(docs, sets)` — combines all data sources into unified list
2. [ ] Build `MentionList` component with 4 categorized sections + distinct rendering per section
3. [ ] Wire TipTap mention extension's `suggestion` config to `MentionList`
4. [ ] Build `MentionPill` for inline display of selected mentions
5. [ ] Add max 5 doc validation at selection time (check editor content before inserting)
6. [ ] Test filtering, keyboard nav, selection, pill insertion, max 5 enforcement

**Test:** Type `@` → see full dropdown with 4 sections. Type `@ban` → filters to matching docs/sets. Select → pill appears. Submit → payload includes UUID. Try to add 6th doc → toast, rejected. Keyboard navigate through all sections.

---

## Phase 6: Polish + Integration

**Goal:** Wire everything together, handle edge cases.

**Files:**
- Update `chat-panel.tsx` — show conversation title in header (from `initialTitle` prop), empty state when no conversation
- `components/chat/chat-message.tsx` — **Throwaway placeholder:** basic message bubble storing user messages in React state. Will be fully replaced when LangGraph integration is built (messages will then come from LangGraph checkpoints, not local state). Keep implementation minimal.
- Handle new conversation auto-title (set title from first message text, truncated to ~50 chars)

**Tasks:**
1. [ ] ChatPanel header shows conversation title (from prop, no extra fetch)
2. [ ] Basic throwaway message rendering (user messages in React state — lost on refresh, replaced by LangGraph later)
3. [ ] Auto-title: after first message in new conversation, call `useRenameConversation` with first ~50 chars of message text
4. [ ] Loading states, error boundaries, empty states
5. [ ] Verify full flow end-to-end

**Test:** Full flow: create conversation → type message with @ mentions → submit → message appears in chat. Rename, delete from sidebar. Refresh page → conversation persists in URL (messages lost — expected, noted as throwaway).

---

## Demo Considerations
- [ ] Conversation CRUD works under 500ms (Supabase direct, no cold start)
- [ ] TipTap dropdown appears instantly (data already in React Query cache)
- [ ] No console errors
- [ ] Graceful error handling (toast on failure, optimistic rollback)
- [ ] Inline rename feels snappy (Enter/Escape + Tick/X + blur-to-save all work)
- [ ] URL persistence: refresh mid-conversation → same chat loads (messages lost until LangGraph)
- [ ] Invalid URL → clean redirect to `/dashboard`

## File Tree (New/Modified)

```
app/dashboard/
  layout.tsx                          ← NEW (shared shell, auth gate)
  page.tsx                            ← MODIFIED (empty state only)
  [conversationId]/
    page.tsx                          ← NEW (validates + renders active chat)

components/
  conversations/
    conversation-list.tsx             ← NEW
    conversation-item.tsx             ← NEW
  chat/
    chat-input.tsx                    ← NEW (TipTap editor)
    chat-message.tsx                  ← NEW (throwaway message bubble)
    mention-list.tsx                  ← NEW (dropdown)
    mention-pill.tsx                  ← NEW (inline pill)
  dashboard/
    dashboard-shell.tsx               ← MODIFIED (children slot for center panel)
    chat-panel.tsx                    ← MODIFIED (receives conversationId, "use client")
    left-panel.tsx                    ← MODIFIED (wire conversation list + create)

hooks/
  queries/
    use-conversations.ts              ← NEW
  mutations/
    use-create-conversation.ts        ← NEW
    use-rename-conversation.ts        ← NEW
    use-delete-conversation.ts        ← NEW

lib/
  types/
    conversations.ts                  ← NEW
  chat/
    extract-mentions.ts               ← NEW
    mention-items.ts                  ← NEW
```
