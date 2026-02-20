# State Management Foundations & TanStack Query

---

## The "Why" (Business Outcome)
Every web app has two kinds of data: **UI state** (is this modal open? what's typed in the search box?) and **server state** (what documents does this user have? what's their profile?). These are fundamentally different problems. Treating them the same — storing API data in `useState` — leads to stale data, loading flickers, and complex synchronization bugs.

TanStack Query is the industry-standard solution for server state. It handles caching, background refetching, and optimistic updates — so your UI feels instant while staying accurate.

---

## The Concept Crash Course

### Level 1 — The Two Types of State

```
UI STATE                          SERVER STATE
────────────────────────────────  ────────────────────────────────
• Is modal open?                  • Documents list from DB
• Current search input text       • User profile data
• Which tab is active             • Sets and their colors
• Form field values               • Processing status of uploads

Owned by: the browser             Owned by: the server/database
Tool: useState, useReducer         Tool: TanStack Query
Lives: in memory, lost on refresh  Lives: on the server, persisted
```

**The mistake beginners make:** putting server state in `useState`. You fetch once, store in state, and it goes stale the moment someone else edits the data. Now you need to manually track "did anything change?" — which becomes a maintenance nightmare.

---

### Level 2 — What TanStack Query Actually Does

Think of TanStack Query as a **smart cache manager** sitting between your components and your server.

```
Component A requests "documents"
          ↓
    [TanStack Query Cache]
    - Is "documents" in cache? → Yes, return it instantly
    - Is it stale (>30s old)?  → Yes, refetch in background
    - Component gets data immediately, then updates silently
          ↓
Component B also needs "documents" → same cache, no second API call
```

Without TanStack Query: Component A and Component B each make their own `fetch()` call. Two API calls for the same data. If they get different responses, they show different things.

---

### Level 3 — Query Keys: The Identity System

Every piece of server state has a **query key** — a unique identifier TanStack Query uses to find it in the cache.

```typescript
useQuery({ queryKey: ["documents"] })       // all documents
useQuery({ queryKey: ["documents", docId] }) // one specific document
useQuery({ queryKey: ["sets"] })             // all sets
```

**Why this matters:** When you upload a new document, you call:
```typescript
queryClient.invalidateQueries({ queryKey: ["documents"] })
```
This tells TanStack Query: "the 'documents' cache is now stale — refetch it next time a component needs it." All components using `useDocuments()` automatically refresh. No prop drilling, no manual state sync.

---

### Level 4 — The Request Lifecycle

```
Component mounts
      ↓
useQuery fires → checks cache
      ↓
Cache MISS (first load):          Cache HIT (data exists):
  isLoading = true                  data = cached value (instant)
  fetch from server                 isStale? → background refetch
      ↓                                   ↓
  data arrives → cache it           new data arrives → update silently
  isLoading = false
  component re-renders with data
```

**States you handle in your component:**
- `isLoading` — first load, no data yet → show skeleton/spinner
- `isError` — fetch failed → show error UI
- `data` — success → render the data

---

### Level 5 — Mutations: Changing Server State

`useQuery` reads data. `useMutation` writes data (create, update, delete).

```
User clicks "Upload"
      ↓
useMutation fires
  1. onMutate  → optimistic update (instant UI change)
  2. mutationFn → actual API call (async, takes time)
  3. onSuccess → confirm or replace with real data
     onError   → rollback to previous state
  4. onSettled → always runs (invalidate cache → refetch)
```

---

### Level 6 — Optimistic Updates (The Key Pattern)

**Without optimistic updates:**
1. User clicks "Delete document"
2. App shows spinner
3. 500ms later, document disappears
4. *Feels sluggish*

**With optimistic updates:**
1. User clicks "Delete document"
2. Document disappears **instantly** (cache update)
3. API call runs in the background
4. If it succeeds → nothing visual changes (already looks right)
5. If it fails → document reappears (rollback)
6. *Feels instant, stays accurate*

**The three-step pattern we use:**
```
onMutate:   snapshot old state, apply change immediately to cache
onError:    restore the snapshot (rollback)
onSettled:  invalidate the query (force a clean refetch regardless)
```

**Why `onSettled` not `onSuccess` for invalidation?** `onSettled` runs whether the mutation succeeded OR failed. This ensures the cache always eventually reconciles with the real server state — even if the optimistic update was wrong.

---

### Level 7 — Why Not Just `useState` + `useEffect`?

This is the pattern most beginners use:
```typescript
const [docs, setDocs] = useState([]);
useEffect(() => {
  fetch('/api/documents').then(data => setDocs(data));
}, []);
```

**Problems:**
- **Stale data:** Never refetches. If another tab uploads a document, this tab still shows the old list.
- **Race conditions:** Two components both fetch the same endpoint — which response wins?
- **No deduplication:** 5 components mount → 5 identical API calls
- **No error/loading states built in:** You manually manage 3+ state variables
- **No retry:** If the request fails, it's just gone

TanStack Query solves all of these by design. This is why it's the standard.

---

### Level 8 — The Full Picture in PolicyPal

```
useDocuments()          → reads from cache, auto-refetches every 30s
  └── displays in DocumentPanel

useUploadDocument()     → mutates: POST /api/documents/upload
  ├── onMutate:  adds temp "processing" card to cache instantly
  ├── onSettled: removes temp card, invalidates ["documents"]
  └── re-fetch:  real document (ready or failed) appears

useDeleteDocument()     → mutates: DELETE from Supabase
  ├── onMutate:  removes card from cache instantly
  ├── onError:   card reappears (rollback)
  └── onSettled: invalidates ["documents"]

useRetryDocument()      → mutates: POST /api/documents/retry/:id
  ├── onMutate:  flips card to "processing" state instantly
  └── onSettled: invalidates ["documents"] → shows real status
```

Every mutation eventually calls `invalidateQueries(["documents"])`. This is the single source of truth recovery — after every write, the cache resynchronises with the DB.

---

## Struggle Points
*(To be filled as you work through the material)*
- [ ] When to use `onSuccess` vs `onSettled` for invalidation
- [ ] How TanStack Query decides when data is "stale" (staleTime config)
- [ ] Why query keys are arrays, not strings

---

## Active Recall Questions
1. What's the difference between UI state and server state? Give an example of each from PolicyPal.
2. A user uploads a document. Without optimistic updates, what does the UX feel like? How does `onMutate` fix this?
3. After a delete mutation, we call `invalidateQueries`. What happens next, and why is this better than manually removing the item from state?
4. Why does TanStack Query deduplicate API calls between components?
5. `onError` restores the snapshot. `onSettled` always refetches. If `onError` already rolls back, why do we still need `onSettled` to invalidate?

---

## Spaced Repetition Log

| Date | Interval (Days) | Next Review | Status |
|---|---|---|---|
| Feb 20, 2026 | — | — | 📖 Need to Learn |
