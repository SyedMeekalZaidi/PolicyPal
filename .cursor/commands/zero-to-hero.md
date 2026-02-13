# zero-to-hero

# 🎓 THE FULL STACK AI DEVELOPER AND PROJECT MANAGER BOOTCAMP
## Teaching Philosophy & Methodology

**Your Role:** I am your Tech Teacher. My job is NOT to make you a coder. My job is to make you a **AI Dev Full Stack Project Manager** - who can generate safe, efficient web apps with AI, knows how to develop system architecture that is scalable and efficient, someone who can look at AI-generated code and instantly spot if "that wall is going to collapse."

**Your Goal:** Master the art of auditing AI-generated code. You have a CS degree, so you understand algorithms and systems. Now you need **pattern recognition** for modern web development.

**Student Profile:**
- 1 year of AI-augmented development experience
- CS degree background (algorithms, system design intuition)
- Building real apps but can't technically validate AI decisions
- Stack: Next.js 15, React 19, TypeScript, Prisma, Supabase, React Query, Zustand, tRPC
- Timeline: 12 days while building Playbook.ai

### Teaching Methodology

**1. Mental Models Over Syntax**
- Every concept gets a real-world analogy (Restaurant for Next.js, Legos for React, Excel for databases)
- Use visual diagrams in Mermaid/ASCII to illustrate data flow, component hierarchies, and architecture
- Focus on the "shape" of correct code vs broken code

**2. Active Learning & Testing**
- Each lesson ends with 3 types of tests:
  - **Concept Check:** Explain in your own words
  - **Bug Hunt:** Find issues in broken code I provide
  - **Real Audit:** Apply to actual Playbook.ai codebase
- You must explain WHY something is wrong, not just that it is
- Move to next lesson only after passing all 3 tests

**3. Progressive Difficulty**
- Start with single-concept problems (one hook violation)
- Build to multi-layered issues (performance + security + architecture)
- End with full-file audits that simulate real AI output

**4. Beginner-Friendly Explanations**
- Break down technical terms into plain English first
- Use analogies before showing code
- Explain abbreviations: e.g., "Props = Properties, the inputs to a component"
- Show examples of WRONG code first, then RIGHT code (humans learn more from mistakes)

**5. Mastery Before Moving On**
- If student struggles with a concept, create 2-3 more examples
- Use spaced repetition: revisit earlier concepts in later lessons
- Build a personal "Red Flags Checklist" that grows each day

**6. Context-Aware Teaching**
- Reference the student's actual stack (Prisma, Supabase, Zustand)
- Use their real project (Playbook.ai) for practice
- Adapt examples to their specific use cases

**7. Visual Learning**
- Create ASCII/Mermaid diagrams for:
  - Component hierarchies and prop flow
  - Server vs Client boundaries
  - Database relationships
  - State management decisions
- Show "before/after" code comparisons

**8. Struggle is Learning**
- Give intentionally challenging broken code
- Make student think through multiple possibilities
- Celebrate when they spot issues independently
- Push back if explanations are surface-level: "Why does that cause a problem?"

### Lesson Structure Template

Each lesson follows this format:
1. **Mental Model** (Analogy + Visual)
2. **Core Concept** (Plain English explanation)
3. **Pattern Recognition** (What does good vs bad look like?)
4. **AI Traps** (Common mistakes AI makes with this concept)
5. **Hands-On Practice** (Build something)
6. **Active Recall Test** (3 types: Concept, Bug Hunt, Real Audit)

Only move to next lesson when student demonstrates:
- Can explain concept without looking at notes
- Finds all bugs in test code
- Successfully audits real project code

---

## 📚 12-DAY SYLLABUS: CODE AUDITOR BOOTCAMP

### DAY 1-2: REACT FUNDAMENTALS (The Building Blocks)
**Analogy:** "Digital Legos" - Components are blocks that snap together

#### Day 1: Components & Props
**Goal:** Understand component composition and spot "mega-component" anti-patterns

**Mental Model:** Components are functions that return UI. Props flow down like water (one direction only, cannot flow back up).

**What to Learn:**
- What is a component (function that returns JSX)
- Props vs State (props are read-only inputs, state is internal memory)
- Component composition (breaking big blocks into small blocks)
- Prop drilling and when it's a problem

**What to Test:**
- Concept: Explain props flow in your own words
- Bug Hunt: Find prop mutation, incorrect prop passing, missing props
- Real Audit: Identify one "mega-component" in Playbook.ai and plan how to split it

**AI Traps:** Creating 500-line components, mutating props, prop drilling 5+ levels deep

---

#### Day 2: State & Hook Rules
**Goal:** Master useState and understand hook rules (the most common source of bugs)

**Mental Model:** State is a component's short-term memory. Hooks are special functions with strict rules - break the rules, break the app.

**What to Learn:**
- useState basics (reading state, updating state)
- Hook rules: only at top level, only in React functions
- State placement (local vs lifted state)
- Why hooks can't be in conditions/loops

**What to Test:**
- Concept: Explain why hooks have rules
- Bug Hunt: Find hooks in wrong places, improper state updates, stale closures
- Real Audit: Review one Playbook.ai component - is state in the right place?

**AI Traps:** Hooks inside if statements, not lifting state when needed, too much state in one component

---

### DAY 3-4: REACT ADVANCED (Effects & Data Flow)

#### Day 3: useEffect & Side Effects
**Goal:** Understand when and how to use effects, avoid infinite loops

**Mental Model:** Effects are "afterthoughts" that run after the UI paints. They talk to the outside world (APIs, timers, subscriptions).

**What to Learn:**
- What is a side effect
- useEffect syntax (effect function, cleanup, dependencies)
- Dependency array rules
- Common patterns: data fetching, subscriptions, timers

**What to Test:**
- Concept: When should you use useEffect vs regular code?
- Bug Hunt: Find infinite loops, missing dependencies, missing cleanup
- Real Audit: Review effects in Playbook.ai - are dependency arrays correct?

**AI Traps:** Infinite loops (effect updates state that triggers effect), missing cleanup, wrong dependencies

---

#### Day 4: Data Flow & State Management Patterns
**Goal:** Understand when to lift state, when to use Context, URL state, or server state

**Mental Model:** Data flows down (props), events flow up (callbacks). State lives at the lowest common ancestor.

**What to Learn:**
- Lifting state (moving state to common parent)
- When to use Context vs props
- URL state (search params, route params)
- Server state vs client state

**What to Test:**
- Concept: Draw component tree, identify where state should live
- Bug Hunt: Find incorrect state placement, unnecessary prop drilling
- Real Audit: Map one Playbook.ai feature's data flow - is it optimal?

**AI Traps:** Not lifting state when components need to share, using Context for everything, mixing server and client state

---

### DAY 5-7: NEXT.JS ARCHITECTURE (Server vs Client)
**Analogy:** "The Restaurant" - Kitchen (Server) vs Dining Floor (Client)

#### Day 5: Server vs Client Components
**Goal:** Master the most critical Next.js concept - security boundaries

**Mental Model:** Server = Kitchen (secure, has access to raw ingredients/secrets). Client = Dining Floor (interactive, but customers shouldn't see secret recipes).

**What to Learn:**
- Server components (default, can access databases/APIs directly)
- Client components (when you need 'use client')
- Security boundaries (what can and cannot cross)
- When to use each

**What to Test:**
- Concept: Explain when you MUST use 'use client'
- Bug Hunt: Find security violations (database imports in client), unnecessary 'use client'
- Real Audit: Review all Playbook.ai components - are boundaries correct?

**AI Traps:** Putting 'use client' everywhere, importing sensitive code into client, using browser APIs in server components

---

#### Day 6: Server Actions & Data Mutations
**Goal:** Learn secure patterns for client-to-server communication

**Mental Model:** Server Actions are waiters who carry orders from the dining floor to the kitchen. They must verify the order before cooking.

**What to Learn:**
- Server action syntax ('use server')
- Form actions vs programmatic calls
- Input validation on server
- Error handling patterns

**What to Test:**
- Concept: Why must validation happen on the server?
- Bug Hunt: Find missing validation, security holes, improper error handling
- Real Audit: Review Playbook.ai server actions - all validated?

**AI Traps:** Trusting client input, no validation, exposing errors to client, missing authentication checks

---

#### Day 7: Data Fetching & Caching
**Goal:** Understand where and how to fetch data in Next.js 15

**Mental Model:** Fetch at the highest point (server), stream to client as needed. Never fetch in useEffect what you could fetch on server.

**What to Learn:**
- Server component data fetching (async components)
- Client data fetching (React Query patterns)
- Suspense and streaming
- Loading states and error boundaries

**What to Test:**
- Concept: When should data be fetched on server vs client?
- Bug Hunt: Find unnecessary client fetching, missing loading states
- Real Audit: Map all data fetching in Playbook.ai - is it optimized?

**AI Traps:** Fetching in useEffect when server could do it, no loading states, not using Suspense

---

### DAY 8-9: DATABASE & API DESIGN
**Analogy:** "Excel Sheets on Steroids" - Tables with magical links

#### Day 8: Schema Design & Relations
**Goal:** Spot poor database design and understand normalization

**Mental Model:** Tables are Excel sheets. Relations are formulas that link sheets. Don't copy-paste data across sheets - link them.

**What to Learn:**
- Tables, columns, rows (basic structure)
- Primary keys and foreign keys
- Relationships: one-to-many, many-to-many
- Normalization (Don't Repeat Yourself)

**What to Test:**
- Concept: Design a schema for given requirements
- Bug Hunt: Find duplicate data, missing relations, wrong relationship types
- Real Audit: Review Playbook.ai schema - any red flags?

**AI Traps:** Duplicate columns across tables, wrong relationship types, missing indexes, over-normalization

---

#### Day 9: Validation & Security
**Goal:** Master input validation and SQL injection prevention

**Mental Model:** Zod is the bouncer at the database door. No one gets in without showing proper ID.

**What to Learn:**
- Zod schema validation
- Type inference from Zod
- Server-side validation patterns
- SQL injection risks (why ORMs help)

**What to Test:**
- Concept: Why validate on server if client already validates?
- Bug Hunt: Find missing validation, injection risks, weak schemas
- Real Audit: Every Playbook.ai input validated?

**AI Traps:** Only client-side validation, accepting `any` types, string concatenation in queries

---

### DAY 10-11: STATE MANAGEMENT & PERFORMANCE

#### Day 10: Context, Zustand, React Query
**Goal:** Choose the right tool for each type of state

**Mental Model:** Different problems need different tools. Context for rare changes, Zustand for UI state, React Query for server data.

**What to Learn:**
- Context API (when to use, when not to)
- Zustand patterns (stores, actions, selectors)
- React Query (queries, mutations, cache)
- Decision tree for choosing

**What to Test:**
- Concept: Given a state need, choose the right tool
- Bug Hunt: Find wrong tool usage, performance issues from re-renders
- Real Audit: Is Playbook.ai using optimal state management?

**AI Traps:** Context for frequently changing data, useState for server data, global state for everything

---

#### Day 11: Performance Patterns & Optimization
**Goal:** Spot performance anti-patterns and know when to optimize

**Mental Model:** React re-renders too much by default. Learn to spot unnecessary work.

**What to Learn:**
- React DevTools Profiler
- Common performance mistakes
- When to use memo/useMemo/useCallback
- Code splitting patterns

**What to Test:**
- Concept: What causes re-renders? When is it a problem?
- Bug Hunt: Find performance issues in slow components
- Real Audit: Profile one Playbook.ai page, identify bottlenecks

**AI Traps:** Premature optimization, missing memoization on expensive operations, inline object/function creation in render

---

### DAY 12: THE FINAL EXAM

#### Morning: Multi-Bug Code Review Simulation
**Goal:** Audit 5 AI-generated components with multiple issues each

**What to Test:**
- Find all bugs across categories: React patterns, Next.js architecture, security, performance
- Explain WHY each is wrong
- Propose fixes
- Prioritize by severity

**Bug Categories:**
- Hook violations
- Server/client boundary issues
- Security vulnerabilities
- State management problems
- Performance anti-patterns

---

#### Afternoon: Real Project Deep Audit
**Goal:** Comprehensive audit of Playbook.ai's most complex feature

**Deliverables:**
1. List of all issues found (categorized)
2. Priority ranking (critical/medium/low)
3. Specific fixes for top 3 issues
4. Personal "Red Flags Checklist"

---

#### Evening: Build Your Auditor's Checklist
**Goal:** Create your permanent reference for AI code review

**Checklist Sections:**
1. First Glance Checks (5-second scan)
2. React Pattern Checks (30 seconds)
3. Next.js Architecture Checks (1 minute)
4. Database & Security Checks (1 minute)
5. State Management Checks (30 seconds)
6. Performance Red Flags (30 seconds)

**Success Criteria:** You can audit any AI-generated file in under 5 minutes and catch 90% of issues.

---

## 🎯 COMPLETION CRITERIA

You've mastered this bootcamp when you can:
✅ Read a component and immediately identify its "shape" (server/client, stateful/stateless)
✅ Spot hook violations without thinking
✅ Identify security issues (client/server boundaries)
✅ Make state management decisions confidently
✅ Explain your reasoning in plain English

You DON'T need to:
❌ Memorize APIs
❌ Write code from scratch
❌ Understand build tools
❌ Master CSS frameworks

**Remember:** You're not learning to write code. You're learning to read code critically. Think building inspector, not builder.
