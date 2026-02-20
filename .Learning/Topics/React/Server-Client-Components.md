# Server Components vs Client Components

**Date Created:** Feb 14, 2026  
**Category:** Full-Stack Architecture  
**Stack Context:** Next.js 13+, React Query, PolicyPal

---

## The "Why" (Business Outcome)

**Problem:** Traditional React apps load slowly (everything runs in browser), cost more (unnecessary API calls), and have poor SEO (empty initial HTML).

**Solution:** Server Components fetch data on the server BEFORE sending HTML to browser → instant page loads, lower costs, better SEO.

**PolicyPal Impact:**
- **Performance:** Dashboard loads instantly (no loading spinners for initial data)
- **Cost:** Reduce unnecessary refetches by 80-90% (fewer DB queries, fewer AI calls)
- **Security:** Database queries never exposed to browser (secrets stay server-side)
- **UX:** Optimistic updates make interactions feel instant (delete/upload happen immediately)

---

## The Concept Crash Course (High Level)

### Mental Model: Restaurant Analogy

**Server Components = Kitchen** 🍳
- Heavy lifting happens BEFORE customer sees food
- Database queries, AI calls, expensive operations
- Output: Fully prepared HTML (like a cooked dish)

**Client Components = Table Service** 🍽️
- Interactive elements at customer's table
- Clicks, typing, animations, real-time updates
- Output: React hooks, event handlers, state management

**Key Rule:** Kitchen prepares food, table lets you eat it. Don't bring the entire kitchen to the table!

---

### The Architecture Pattern

```
Server Component (Page)
   ↓ Fetch data from DB/API
   ↓ Render static parts
   ↓ Pass data as props
   ↓
Client Component
   ↓ Receive initialData
   ↓ React Query wraps it
   ↓ User interactions (mutations)
   ↓ Optimistic updates
   ↓
API Route (Security Gate)
   ↓ Auth/validation
   ↓ Database operations
   ↓ Return response
   ↓
Client Component
   ↓ Cache invalidation
   ↓ UI auto-updates
```

---

### Decision Tree: Server or Client?

**Use Server Component when:**
- ✅ Fetching data at page load (no loading spinner needed)
- ✅ Accessing secrets/env variables (keep secure)
- ✅ Heavy computations (offload from browser)
- ✅ Direct database access (faster, simpler)
- ✅ No interactivity needed (static display)

**Use Client Component when:**
- ✅ User interactions (clicks, typing, form inputs)
- ✅ React hooks needed (useState, useEffect, useCallback)
- ✅ Browser APIs needed (window, localStorage, document)
- ✅ Real-time updates (streaming, websockets)
- ✅ Animations/dynamic UI (framer-motion, transitions)

**Critical Rule:** You CAN nest Client inside Server, but CANNOT nest Server inside Client. Once you go client (`"use client"`), the entire subtree becomes client-side.

---

### React Query's Role

**The Handoff Pattern:**
1. **Server Component** fetches initial data (fast, pre-rendered)
2. **Pass as `initialData` to Client Component** (no loading spinner)
3. **React Query manages mutations** (upload, delete, update)
4. **Optimistic updates** (instant UI feedback)
5. **Cache invalidation** (keep data in sync)

**Why this works:**
- Best of both worlds: Fast initial load (server) + instant interactions (client)
- No loading spinners (data already available from server)
- Mutations feel instant (optimistic updates)
- Always in sync (cache invalidation after mutations)

---

### The Security Boundary

**Three Layers:**

**Layer 1: Server Components**
- Direct database access ✅
- Environment secrets accessible ✅
- Heavy operations OK ✅

**Layer 2: API Routes (Gate)**
- Authentication check (is user logged in?)
- Authorization check (can THIS user do this?)
- Validation (is data correct format?)

**Layer 3: Client Components**
- NO direct database access ❌
- NO secrets/env variables ❌
- Only UI state and interactions ✅

**Critical Insight:** Client Component triggers action (button click) → API Route validates and executes (server) → Client receives result and updates UI.

---

## Struggle Points

### 1. **"Where does the business logic live?"**
**Confusion:** User clicks delete button → does logic run client or server?

**Answer:** 
- **Button (UI):** Client Component (onClick handler)
- **Delete operation:** API Route (server-side DB query)
- **Cache update:** Client Component (React Query optimistic update)

**Mental model:** Client = UI trigger, Server = business logic, Client = UI update.

---

### 2. **"When to use `"use client"`?"**
**Confusion:** Should the whole page be client component if it has interactive buttons?

**Answer:** NO. Be surgical.
- **Page wrapper:** Server Component (fetch data)
- **Interactive pieces:** Client Components (buttons, forms, modals)

**Mental model:** Only add `"use client"` to the smallest component that NEEDS it.

---

### 3. **"Why not just fetch in useEffect?"**
**Confusion:** useEffect works fine for fetching, why avoid it?

**Answer:** 
- **Performance:** User sees loading spinner instead of instant content
- **SEO:** Google sees empty page (no initial content)
- **Extra requests:** Server renders empty HTML, THEN client fetches (2 round trips)

**Mental model:** Server fetch = 1 trip (fast), useEffect = 2 trips (slow).

---

### 4. **"What if I need data to be fresh?"**
**Confusion:** Server Components cache data, what if it's stale?

**Answer:** Use React Query's `staleTime` config:
- **Rarely changing** (documents): 5 min staleTime → refetch infrequently
- **Frequently changing** (chat messages): 30 sec staleTime → refetch often
- **Immutable** (AI responses): Infinity staleTime → never refetch

**Mental model:** Configure freshness per data type, don't default to always refetch.

---

## Spaced Repetition Log

| Date | Interval | Active Recall Question | Status |
|------|----------|------------------------|--------|
| Feb 14, 2026 | Initial | Lesson created | ✅ Learned |
| Feb 15, 2026 | 1 day | Q1: User uploads document. Which layer handles: (a) upload button click, (b) file validation, (c) database insert, (d) UI update? | ⏳ Due |
| - | 3 days | Q2: Why is fetching in useEffect slower than Server Component fetch? Explain the request waterfall. | 📅 Scheduled |
| - | 7 days | Q3: You need to show user's profile avatar with dropdown menu. Server or Client Component? Walk through your reasoning. | 📅 Scheduled |
| - | 21 days | Q4: Explain optimistic updates flow: What happens at onMutate, onError, and onSettled? | 📅 Scheduled |

---

## Quick Reference Card

**Default to Server, add Client only when:**
- Need hooks? → Client
- Event handlers? → Client
- Browser APIs? → Client
- Just displaying data? → Server

**React Query pattern:**
- Server fetches → Client receives as `initialData` → Mutations use optimistic updates → Cache invalidation keeps sync

**Security rule:**
- Client = UI interactions
- API Routes = Business logic gate
- Server Components = Heavy operations

**Composition rule:**
- Server can wrap Client ✅
- Client CANNOT wrap Server ❌
