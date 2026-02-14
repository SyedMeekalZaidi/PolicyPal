# Implementation Plan: Landing Page + Auth Pages

## Overview

Replace the Supabase starter template with PolicyPal-branded landing page and auth pages. Three layers: (1) Update design system foundation (CSS vars + Tailwind) to PolicyPal blue palette, (2) Build modular landing page with scroll-animated feature cards, (3) Restyle auth pages with shared split-screen layout. All auth logic stays unchanged — only the UI layer changes.

**Key Decisions:**
- **Shared auth layout** — dark left branding panel is identical across sign-up, login, forgot-password. One `app/auth/layout.tsx`, not duplicated.
- **Landing page as composable sections** — each section is its own component under `components/landing/`. Easy to reorder or extend.
- **Design system via CSS variables** — update `globals.css` root variables so all Shadcn components automatically inherit PolicyPal colors.
- **Reuse existing form components** — `login-form.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx` already have working Supabase logic. We restyle them, not rewrite them.
- **No proxy.ts rename** — current auth works. The `proxy.ts` naming is Supabase's convention. Don't touch it.

---

## Auth Flow (No Changes — Preserved As-Is)

```
Sign Up:
  User fills form → supabase.auth.signUp() → redirect to /auth/sign-up-success
  → User clicks email link → /auth/confirm (verifyOtp) → redirect to /

Login:
  User fills form → supabase.auth.signInWithPassword() → redirect to /protected
  → (will change to /dashboard in Task 3)

Forgot Password:
  User fills email → supabase.auth.resetPasswordForEmail() → success message
  → Email link → /auth/update-password

Protected Route Check:
  /protected/page.tsx calls getClaims() server-side → no claims = redirect to /auth/login
```

**What stays untouched:**
- `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`
- `proxy.ts` (root)
- `app/auth/confirm/route.ts`
- `app/auth/error/page.tsx` (just gets auth layout wrapper for free)
- `app/auth/update-password/` (restyle later if time permits)
- All Supabase auth method calls inside form components

---

## Phase 0: Design System Foundation

**Goal:** Update CSS variables and Tailwind config so every Shadcn component automatically uses PolicyPal's blue palette. Lock to light-only theme.

**Files to modify:**

1. `globals.css`
   - [ ] Replace `:root` CSS variables with PolicyPal palette:
     - `--background` → `#BFD9F0` (light blue page bg)
     - `--foreground` → `#1A1A1A` (dark grey text)
     - `--card` → `#F4F8FD` (card bg)
     - `--primary` → `#4A9EFF` (primary blue)
     - `--primary-foreground` → `#FFFFFF`
     - `--muted` → `#ECF4FF` (section bg)
     - `--muted-foreground` → `#6B7280` (medium grey)
     - `--input` → `#EDF4FB` (input bg)
     - `--border` → `#D1E3F6` (light blue border)
     - `--ring` → `#4A9EFF` (focus ring)
     - `--destructive` → keep red for errors
   - [ ] Remove `.dark` block (no dark mode for MVP)
   - [ ] Update `--radius` to `0.75rem` (12px, our design uses rounded-xl)

2. `tailwind.config.ts`
   - [ ] Add PolicyPal custom colors under `extend.colors`:
     - `gold` → `#FEC872` (regulatory docs)
     - `green` → `#10B981` (company docs)
     - `section` → `#ECF4FF` (section backgrounds)
     - `selected` → `#3B8FF2` (hover/active states)
     - `sidebar` → `#BFD9F0` (sidebar bg)
   - [ ] Update `borderRadius` — set `--radius` base to `0.75rem`

3. `app/layout.tsx`
   - [ ] Update metadata title to "PolicyPal — AI Compliance Assistant"
   - [ ] Update metadata description
   - [ ] Set ThemeProvider `defaultTheme="light"` and remove `enableSystem`
   - [ ] Change font from Geist to Inter (our design doc specifies Inter)

**Test:** Run `npm run dev`, open localhost:3000. Background should be light blue, buttons should be blue. Existing Card/Button/Input components should look correct with new palette.

---

## Phase 1: Landing Page

**Goal:** Marketing page at `/` that introduces PolicyPal and drives sign-up. Modular section components with Framer Motion scroll animations.

**Component structure:**
```
components/landing/
  navbar.tsx          ← Top nav: logo text + Sign In / Get Started buttons
  hero.tsx            ← Main headline + subtext + 2 CTA buttons + gradient bg
  features.tsx        ← 4 feature cards (Summarize, Inquire, Compare, Audit)
  cta.tsx             ← Bottom call-to-action section
  footer.tsx          ← Copyright + links
```

**Files to create:**

1. `components/landing/navbar.tsx`
   - [ ] Fixed top nav, white/translucent background with backdrop blur
   - [ ] Left: "PolicyPal" text logo (bold, primary color)
   - [ ] Right: "Sign In" link (secondary) + "Get Started" button (primary)
   - [ ] Links: Sign In → `/auth/login`, Get Started → `/auth/sign-up`

2. `components/landing/hero.tsx`
   - [ ] Large headline: "Smart Compliance." + "Better Decisions." (second line italic/bold)
   - [ ] Subtitle describing PolicyPal's value for compliance officers
   - [ ] Two CTA buttons: "Get Started" (primary) + "Learn More" (secondary/outline)
   - [ ] Subtle gradient background (light blue → white fade)
   - [ ] Maybe a decorative product screenshot placeholder area

3. `components/landing/features.tsx`
   - [ ] Section heading: "What PolicyPal Can Do" or similar
   - [ ] 4 glassmorphism cards in a 2x2 grid (responsive: 1 col on small screens)
   - [ ] Each card: Lucide icon + title + 1-2 sentence description
     - Summarize (FileText icon): "Condense 100-page policies into actionable summaries"
     - Inquire (MessageCircle icon): "Ask questions across multiple documents"
     - Compare (GitCompare icon): "Compare policy versions side-by-side"
     - Audit (ShieldCheck icon): "Audit compliance across regulatory sources"
   - [ ] **Framer Motion animations:** Cards animate in with `whileInView` — fade up + slight scale, staggered delay (0.1s between cards)
   - [ ] Card style: `bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg shadow-blue-200/20 p-6`

4. `components/landing/cta.tsx`
   - [ ] Simple section: headline + subtext + primary CTA button
   - [ ] "Ready to streamline your compliance workflow?"
   - [ ] Button links to `/auth/sign-up`

5. `components/landing/footer.tsx`
   - [ ] Simple footer: "2026 PolicyPal" left, "Privacy Policy · Support" right
   - [ ] Muted text, subtle top border

**Files to modify:**

6. `app/page.tsx`
   - [ ] Replace entire content with composition of above sections:
     - `<Navbar />` → `<Hero />` → `<Features />` → `<CTA />` → `<Footer />`
   - [ ] Remove all template imports (Hero, DeployButton, EnvVarWarning, tutorial components, AuthButton, ThemeSwitcher)
   - [ ] Page should be a clean server component (no state needed)

**Responsive targets:** 1366px, 1440px, 1920px (desktop-first, `max-w-6xl` container)

**Test:** Visit `/`, see full branded landing page. Click "Get Started" → navigates to `/auth/sign-up`. Click "Sign In" → navigates to `/auth/login`. Feature cards animate on scroll.

---

## Phase 2: Auth Pages (Split-Screen Layout + Form Restyle)

**Goal:** Split-screen auth layout inspired by Pic 1 design, using PolicyPal colors. Left panel (branding) + right panel (form). All existing Supabase auth logic preserved.

**Files to create:**

1. `components/auth/auth-panel.tsx`
   - [ ] Left branding panel component (reused by all auth pages via layout)
   - [ ] Dark background (`#0F172A` slate-900 or similar dark navy)
   - [ ] Decorative wave/gradient shapes at bottom (CSS gradients or SVG, blue/teal tones from our palette)
   - [ ] Small pill badge at top: "AI-powered compliance" or similar
   - [ ] Headline: "Smart Compliance." + bold italic "Better Decisions."
   - [ ] Subtitle: brief PolicyPal value prop
   - [ ] Takes up ~45% of screen width on desktop
   - [ ] Hidden below `lg` breakpoint (form goes full-width on smaller screens)

2. `app/auth/layout.tsx` (new)
   - [ ] Split-screen layout wrapper for all auth pages
   - [ ] Left: `<AuthPanel />` (45%, hidden on <lg)
   - [ ] Right: `{children}` centered in remaining 55%
   - [ ] Full viewport height (`min-h-screen`)
   - [ ] Right panel background: white or very light (`#F9FBFE`)

**Files to modify:**

3. `components/sign-up-form.tsx`
   - [ ] Remove Card wrapper (the layout now provides the container)
   - [ ] Add heading: "Sign up Account" + subtext "Please enter your details"
   - [ ] Add First Name + Last Name fields (side-by-side row)
   - [ ] Keep Email and Password fields
   - [ ] Remove "Repeat Password" field (simplify UX — match Pic 1 design)
   - [ ] Style submit button: full-width, PolicyPal primary blue (`bg-primary`), `rounded-xl`
   - [ ] Keep "Already have an account? Log in" link
   - [ ] Add password hint text: "Must be at least 8 characters"
   - [ ] Store first_name/last_name in Supabase `auth.signUp({ options: { data: { first_name, last_name } } })` — goes into `raw_user_meta_data`, no schema change needed

4. `components/login-form.tsx`
   - [ ] Remove Card wrapper
   - [ ] Add heading: "Welcome Back" + subtext "Enter your credentials to access your account"
   - [ ] Style submit button: same primary blue, `rounded-xl`
   - [ ] Keep "Forgot password?" link
   - [ ] Keep "Don't have an account? Sign up" link

5. `components/forgot-password-form.tsx`
   - [ ] Remove Card wrapper
   - [ ] Match heading/subtext style with login and sign-up
   - [ ] Same button styling

6. `app/auth/sign-up/page.tsx`
   - [ ] Simplify: just render `<SignUpForm />` without the centering wrapper (layout handles it now)

7. `app/auth/login/page.tsx`
   - [ ] Same simplification

8. `app/auth/forgot-password/page.tsx`
   - [ ] Same simplification

9. `app/auth/sign-up-success/page.tsx`
   - [ ] Restyle to match: remove Card wrapper, use same heading style
   - [ ] Keep the "check your email" message

10. `app/auth/error/page.tsx`
    - [ ] Light restyle to match auth theme

**Footer in auth pages:**
- [ ] Small footer at bottom of right panel: "2026 PolicyPal" left, "Privacy Policy · Support" right

**Test:**
1. Visit `/auth/sign-up` — see split screen (dark left, form right), fill form, submit → redirects to success page
2. Visit `/auth/login` — see split screen, login with valid credentials → redirects to `/protected`
3. Visit `/auth/forgot-password` — see split screen, submit email → shows success message
4. Resize browser to 1366px, 1440px, 1920px — layout looks good at all sizes
5. Resize below `lg` (1024px) — left panel hides, form goes full-width

---

## Files We Can Delete (Template Cleanup)

After implementation, remove unused template files:
- [ ] `components/hero.tsx` (replaced by landing hero)
- [ ] `components/deploy-button.tsx` (template-only)
- [ ] `components/env-var-warning.tsx` (template-only)
- [ ] `components/theme-switcher.tsx` (no dark mode)
- [ ] `components/next-logo.tsx` (template-only)
- [ ] `components/supabase-logo.tsx` (template-only)
- [ ] `components/tutorial/` entire folder (template-only)
- [ ] `app/protected/layout.tsx` (will be replaced by dashboard layout in Task 3)

---

## Demo Considerations

- [ ] Landing page loads fast (<2 seconds, no external API calls)
- [ ] Feature card animations are smooth (Framer Motion, no layout shift)
- [ ] Sign up flow works end-to-end (form → success page → email confirm)
- [ ] Login flow works end-to-end (form → redirect to /protected)
- [ ] No console errors
- [ ] Error states show clearly (wrong password, email taken, etc.)
- [ ] All form validation works (required fields, email format, password length)
- [ ] Responsive at 1366px, 1440px, 1920px

---

## Risks + Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| CSS variable changes break Shadcn components | Medium | Test Button, Input, Card immediately after Phase 0 |
| Removing "Repeat Password" reduces sign-up safety | Low | Password minimum 8 chars enforced by Supabase. Repeat field is UX friction for MVP. |
| First/last name in user_meta_data vs profiles table | Low | Standard Supabase pattern. We can sync to profiles later if needed. |
| Font change (Geist → Inter) causes FOUT | Low | Inter loaded via next/font/google with `display: swap` |

---

## Summary

| Phase | What | Files Created | Files Modified |
|-------|------|---------------|----------------|
| **Phase 0** | Design system foundation | 0 | 3 (`globals.css`, `tailwind.config.ts`, `layout.tsx`) |
| **Phase 1** | Landing page | 5 (landing components) | 1 (`app/page.tsx`) |
| **Phase 2** | Auth pages | 2 (`auth-panel.tsx`, `auth/layout.tsx`) | 7 (form components + auth pages) |
| **Cleanup** | Delete template files | 0 | Delete ~8 files |
