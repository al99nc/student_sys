# UX Audit — Full Frontend Codebase

**Date:** 2026-05-07  
**Scope:** `pages/`, `components/`, `app/` across both frontend projects  
**Projects audited:**
- **Health360.co** — `Health360.co/health360-website/app/`
- **Student System** — `student_sys/frontend/app/` + `student_sys/frontend/components/`

**Severity legend:**
- `BROKEN` — feature doesn't work or actively misleads the user
- `CONFUSING` — works but creates friction, uncertainty, or wrong expectations
- `POLISH` — minor inconsistency or missed refinement

---

## Project 1: Health360.co (Marketing Site)

### Loading & Skeleton States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-1 | `components/LoadingPage.tsx` + `LoadingProvider` | Hard-coded 3-second `setTimeout` delay regardless of actual content load. Every visitor waits 3 full seconds before seeing the page even on fast connections. Progress bar animation is cosmetic, not tied to real load progress. | CONFUSING |
| H-2 | All page components | No per-page loading skeleton or `<Suspense>` boundary. If a slow network stalls a route, users see a blank white screen with no feedback. | CONFUSING |

---

### Error States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-3 | `app/layout.tsx` | No React Error Boundary wrapping the app tree. An unhandled JS error at any component level will crash the entire page with a white screen. | BROKEN |
| H-4 | `components/motion/ContactForm.tsx` | After a server-side API failure the toast fires, but the form stays filled in and there is no guidance on what to do next (retry? email directly?). | CONFUSING |
| H-5 | `components/motion/CareerForm.tsx` | Inline URL validation error messages do not disappear after the user fixes the field — they clear only on the next submission attempt. Fixing a valid URL still shows the red error border until re-submit. | CONFUSING |

---

### Empty States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-6 | `en/blog/page.tsx` / `ar/blog/page.tsx` | Blog page appears to have no content. There is no "coming soon" or empty state — the page is visually bare, giving the impression the site is broken. | CONFUSING |
| H-7 | `en/our-team/page.tsx` | If the team list is empty (zero entries), there is no fallback message. The section header renders above empty space. | POLISH |

---

### User Feedback on Actions

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-8 | `components/motion/ContactForm.tsx` | After a successful form submission the form resets, but there is no "thank you" confirmation state — no screen change, no next-steps message. Users are left uncertain whether anything happened. | CONFUSING |
| H-9 | `components/motion/CareerForm.tsx` | After applying, users see a toast but no next-steps are shown (expected response time, what gets reviewed, etc.). The experience is a dead end. | CONFUSING |
| H-10 | `app/api/route.ts` (contact form endpoint) | There is no rate limiting or visible queue acknowledgement. On slow API responses the button is simply disabled with no spinner in-button; users have no indication the request is in flight. | CONFUSING |
| H-11 | Language switcher (Header) | Switching language has no animation or feedback; page re-renders silently. On slow connections this appears as a broken click. | POLISH |

---

### Mobile Responsiveness

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-12 | `components/Header.tsx` | Mobile menu toggle exists but the open/close animation is very brief. On 320px-width devices some nav items can overflow if the label text is long (especially in Arabic RTL mode). | POLISH |
| H-13 | `en/our-services/page.tsx` | Feature grid uses `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`. On tablets (768px) in landscape mode, 2-column cards can feel too wide with little breathing room due to fixed `px-4` gutters. | POLISH |
| H-14 | `components/motion/Hero.tsx` | Hero section headline uses `text-4xl md:text-6xl lg:text-8xl`. On mid-size phones (414px) the 4xl (~36px) font makes the CTA button push below the fold on shorter screens. | POLISH |

---

### Form Validation

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-15 | `components/motion/ContactForm.tsx` | Errors are only shown after submit, not on blur. A user who fills name, skips email, fills message, and submits will see all errors at once with no indication of which field needs focus first. | CONFUSING |
| H-16 | `components/motion/CareerForm.tsx` | CV link domain whitelist silently rejects some valid cloud storage providers. Error message says "Invalid URL" rather than "Only Google Drive, Dropbox, or OneDrive links are accepted." | CONFUSING |

---

### Inconsistent UI Patterns

| # | File / Component | Problem | Severity |
|---|---|---|---|
| H-17 | `components/motion/ContactForm.tsx` vs `CareerForm.tsx` | Input styling uses different class-name patterns: ContactForm builds classes inline, CareerForm uses an `inputCls()` helper. Same visual result but inconsistent source of truth — changes to one won't automatically apply to the other. | POLISH |
| H-18 | Multiple pages | Button hierarchy is inconsistent. Some CTAs use `bg-primary-600 hover:bg-primary-700`, others use Tailwind `blue-600`, others use gradient `from-blue-600 to-violet-600`. There is no single primary button style. | POLISH |
| H-19 | Multiple pages | Icon accent colors are mixed: `text-primary-600`, `text-blue-600`, `text-violet-500` are all used for equivalent "feature highlight" icons on different pages. | POLISH |
| H-20 | `en/careers/page.tsx` | Department cards show "0 open positions" with a disabled "View Positions" button, but there is no explanation of when positions will open or how to get notified. The disabled button is a dead end with no alternative path. | CONFUSING |

---

---

## Project 2: Student System (Learning App)

### Loading & Skeleton States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-1 | `app/dashboard/page.tsx` | Lecture list shows a skeleton loader on every load. There is no cache or stale-while-revalidate strategy, so returning users who already uploaded lectures still see the skeleton briefly before content appears — eroding trust. | POLISH |
| S-2 | `app/upload/[jobId]/page.tsx` | The job-progress page polls the API but shows only a generic spinner with "Processing…". No estimated time, no current step name, and no percentage. For a potentially multi-minute process this is a significant dead end. | CONFUSING |
| S-3 | `app/quiz/[id]/page.tsx` | Initial quiz load shows a full-page blank spinner. If the quiz fails to load (bad ID, network error) the spinner never resolves — there is no timeout fallback or error state on this route. | BROKEN |
| S-4 | `app/flashcards/review/page.tsx` | Flashcard deck shows a loading state but no empty/error state if the API returns zero cards. The UI simply renders nothing. | BROKEN |
| S-5 | `app/coach/[id]/page.tsx` | The AI insight panel shows "generating…" spinner, but if the insight API call fails silently the spinner stays forever. No timeout, no retry button. | BROKEN |

---

### Error States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-6 | `app/layout.tsx` | No React Error Boundary anywhere in the component tree. An unhandled exception in any component will crash the full app with a white screen and no recovery option. | BROKEN |
| S-7 | `app/results/[id]/page.tsx` | "Not Processed Yet" error state is shown generically for both "still processing" and "processing failed" conditions. These require different user actions (wait vs re-upload) but look identical. | CONFUSING |
| S-8 | `app/upload/page.tsx` | If the upload API request fails (network drop, 500), the UI shows a toast but the upload button re-enables with the same file still selected. There is no guidance that the file needs to be re-selected or re-submitted. | CONFUSING |
| S-9 | `app/xray/[id]/page.tsx` | If the xray diagnostic fetch fails, the page silently renders an empty layout with no message. | BROKEN |
| S-10 | `app/analytics/page.tsx` | Analytics page has no error boundary or null-data guard. If the analytics API is down, empty charts render with zero values and no "data unavailable" messaging — looks like genuinely zero activity. | CONFUSING |

---

### Empty States

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-11 | `app/flashcards/page.tsx` | If a user has no flashcard decks, the page appears blank. There is no "Create your first deck" CTA or explanation of how flashcards are generated. | CONFUSING |
| S-12 | `app/coach/page.tsx` | Coach list is empty for a new user. No empty-state illustration or prompt to start a session; just a blank list area. | CONFUSING |
| S-13 | `app/dashboard/page.tsx` — Daily Mission | When the daily mission is locked, the component shows unlock criteria but no progress bar toward meeting them. Users can't tell how close they are to unlocking it. | CONFUSING |
| S-14 | `app/lectures/page.tsx` | No lectures state shows "No lectures yet" with an upload CTA, which is good — but the CTA button navigates to `/upload` without any pre-filled context (e.g., forwarding back URL). After uploading, users land on the job-progress page with no way back to lectures. | CONFUSING |
| S-15 | `app/essay-quiz/[id]/page.tsx` | No explanation of how the essay grading rubric works is shown before the user starts typing. There is no "what are we looking for?" guidance, making the empty text field a silent dead end for new users. | CONFUSING |

---

### User Feedback on Actions

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-16 | `app/quiz/[id]/page.tsx` — coach context | After completing a quiz launched from the coach, the page auto-redirects after 2 seconds with a "Returning to coach…" countdown. Users cannot stay to review their answers. If they want to see what they got wrong they must navigate back manually, losing the review moment. | CONFUSING |
| S-17 | `app/results/[id]/page.tsx` — share button | "Copy link" changes button label to "Copied!" for ~2 seconds, which is good. However there is no indication that the shared link works for unauthenticated users, or that it expires — users don't know what they're sharing. | CONFUSING |
| S-18 | `app/upload/page.tsx` | File upload gives no byte-level progress indicator. For a large PDF (10–50 MB) the user sees a static "Uploading…" state for an indeterminate period with no visual progress bar. | CONFUSING |
| S-19 | `app/dashboard/page.tsx` — "Generate Study Materials" | Clicking this button navigates to `/upload` without explaining that generating materials will cost credits or take processing time. First-time users may upload expecting instant results. | CONFUSING |
| S-20 | `components/mcq-card.tsx` | The "save answer" cloud icon transitions between states (saving → saved → idle) but there is no error state icon. If saving fails silently, the user sees the idle icon and believes their progress was saved. | BROKEN |
| S-21 | `app/billing/page.tsx` | After a successful payment, there is no confirmation screen or receipt summary — just a page reload. Users have no in-app confirmation their plan was activated. | CONFUSING |

---

### Mobile Responsiveness

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-22 | `app/results/[id]/page.tsx` | The two-column layout (main content + performance sidebar) collapses to single-column correctly, but the sidebar performance tab-bar (`Next Action / AI Insight / Plan / Quiz`) scrolls horizontally on small screens with no visual affordance (no scroll shadow or "swipe" hint). | POLISH |
| S-23 | `app/quiz/[id]/page.tsx` | Answer option cards use `text-sm` on desktop and don't scale down further on 320px screens. Long answer text in MCQ options can overflow the card boundary on very small phones. | POLISH |
| S-24 | `components/app-header.tsx` | Header hides some nav links with `hidden sm:flex` but the collapsed state has no mobile hamburger menu — those routes are inaccessible from the header on small screens (users must use the bottom nav bar). If a user lands deep-linked to a page, they have no visible way to navigate to unlisted sections. | CONFUSING |
| S-25 | `app/coach/[id]/page.tsx` | The chat input box uses a fixed-height layout that does not account for the iOS virtual keyboard pushing the input off-screen. On iPhone Safari the keyboard covers the input field when the user taps it. | BROKEN |
| S-26 | `app/upload/page.tsx` | The drag-and-drop upload zone has no touch fallback label or "tap to browse" affordance visible on mobile. The zone appears as a static bordered box with no hint that it's interactive. | CONFUSING |

---

### Form Validation

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-27 | `app/auth/page.tsx` | Password field has a 5-level strength indicator, but there is no password confirmation field anywhere in the sign-up flow. Users can set a password they mistyped without realising it until they fail to log in. | BROKEN |
| S-28 | `app/auth/page.tsx` | "Password reset coming soon" is a placeholder — clicking the link does nothing. Users who forget their password have no recovery path from inside the app. | BROKEN |
| S-29 | `app/auth/page.tsx` | There is no email verification step after registration. Any email format passes. Users who typo their email address will never receive communications and have no way to fix it. | CONFUSING |
| S-30 | `app/upload/page.tsx` | Text upload validates minimum 100 characters, but the character counter widget shows only current count, not `X / 100 minimum`. Users who see "87 characters" don't immediately know why the submit button is disabled. | POLISH |

---

### Inconsistent UI Patterns

| # | File / Component | Problem | Severity |
|---|---|---|---|
| S-31 | Multiple pages | Card padding is inconsistent: `p-3.5`, `p-4`, `p-5`, `p-6` all appear across different card components with no systematic rule. Same visual component (stat card, content card) has different internal spacing depending on file. | POLISH |
| S-32 | Multiple pages | Typography scale is inconsistent: equivalent section headers use `text-2xl font-bold`, `text-[22px] font-extrabold`, and `text-xl font-semibold` interchangeably. No typographic hierarchy contract is enforced. | POLISH |
| S-33 | Multiple pages | Progress bar colors are not semantically consistent: some use a violet/cyan gradient, some use `bg-emerald-500`, some use `bg-primary`. The same "progress" concept uses 3+ distinct color treatments across the app. | POLISH |
| S-34 | Multiple pages | Badge variants are mixed: `variant="outline"`, `variant="secondary"`, and hardcoded `bg-violet-500/20 text-violet-300` all appear on badges serving equivalent semantic roles (status labels). | POLISH |
| S-35 | `app/results/[id]/page.tsx` vs `app/quiz/solved/[id]/page.tsx` | These two pages show quiz results but use different layouts, different score display formats, and different action button labels. Users who reach results via different flows see a different UI for the same concept. | CONFUSING |
| S-36 | `components/mcq-card.tsx` | Confidence level buttons use a bespoke `CONF_CLASS` object with custom colors that are unrelated to the rest of the design system (e.g., no equivalent "high confidence" green exists elsewhere in the UI). | POLISH |
| S-37 | `app/dashboard/page.tsx` vs `app/analytics/page.tsx` | Both pages show performance metrics but with different chart styles, different time-range selectors, and different metric names for what appears to be the same underlying data. | CONFUSING |

---

## Cross-Project Issues

| # | Applies To | Problem | Severity |
|---|---|---|---|
| X-1 | Both | No global error boundary. A single unhandled promise rejection or render error crashes the entire app with a white screen. | BROKEN |
| X-2 | Both | No 404 page. Navigating to a non-existent route shows the Next.js default error page, breaking the visual experience. | CONFUSING |
| X-3 | Both | No `<meta name="viewport" content="width=device-width, initial-scale=1">` audit — confirm this is in root `layout.tsx`; without it, mobile zoom is uncontrolled. | BROKEN (if missing) |
| X-4 | Both | No visible focus ring on interactive elements for keyboard/screen-reader users. `outline-none` is applied broadly without a replacement `:focus-visible` style. Accessibility failure. | BROKEN |
| X-5 | Both | Buttons that trigger async actions have no `aria-busy` or `aria-label` updates during loading state. Screen readers do not announce "loading" to users. | CONFUSING |

---

## Priority Fix List

### Fix immediately (BROKEN)
1. **X-1 / H-3 / S-6** — Add React Error Boundaries to both root layouts
2. **S-3** — Add error + timeout state to quiz loading route
3. **S-4** — Add empty/error state to flashcard review
4. **S-5** — Add failure + retry state to AI coach insight panel
5. **S-9** — Add error state to xray diagnostic page
6. **S-20** — Add save-failed error icon to MCQ card save indicator
7. **S-25** — Fix iOS keyboard pushing chat input off-screen (use `dvh` units or keyboard-aware scroll)
8. **S-27** — Add password confirmation field to sign-up flow
9. **S-28** — Either implement password reset or remove the link entirely
10. **X-4** — Restore `:focus-visible` styles — accessibility regression

### Fix next (CONFUSING)
11. **H-1** — Replace hard-coded 3-second delay with actual load detection or reduce to ≤1.5s max
12. **H-8** — Add a post-submit "thank you" confirmation state to contact form
13. **S-2** — Add step name + percentage to upload job-progress page
14. **S-7** — Distinguish "still processing" from "processing failed" in results error state
15. **S-11 / S-12** — Add illustrated empty states with CTAs to flashcards and coach list pages
16. **S-16** — Let users stay on quiz results page; make "return to coach" opt-in
17. **S-24** — Ensure all nav destinations are reachable from mobile header or bottom nav
18. **H-20** — Replace disabled "View Positions" button with a notification sign-up CTA

### Clean up when possible (POLISH)
19. **H-17 to H-19 / S-31 to S-36** — Unify button variants, badge styles, card padding, and icon colors into a single design token set
20. **S-30** — Show `X / 100 minimum` in the text upload character counter
21. **H-14** — Audit hero headline size on 375px screens to keep CTA above fold
22. **S-22** — Add horizontal scroll shadow to sidebar tab bar on mobile
