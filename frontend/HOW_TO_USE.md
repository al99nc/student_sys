# themcq — Complete User Guide

Everything you can do in this app, on every page, every button, every interaction.

---

## Table of Contents

1. [Home Page (`/`)](#1-home-page-)
2. [Auth Page (`/auth`)](#2-auth-page-auth)
3. [Dashboard (`/dashboard`)](#3-dashboard-dashboard)
4. [Upload Page (`/upload`)](#4-upload-page-upload)
5. [Waiting Room (`/upload/[jobId]`)](#5-waiting-room-uploadjobid)
6. [Results Page (`/results/[id]`)](#6-results-page-resultsid)
7. [Quiz Page (`/quiz/[id]`)](#7-quiz-page-quizid)
8. [Flashcards Hub (`/flashcards`)](#8-flashcards-hub-flashcards)
9. [Flashcard Review (`/flashcards/review`)](#9-flashcard-review-flashcardsreview)
10. [Coach Page (`/coach`)](#10-coach-page-coach)
11. [Analytics Page (`/analytics`)](#11-analytics-page-analytics)
12. [Account Page (`/account`)](#12-account-page-account)
13. [Billing Page (`/billing`)](#13-billing-page-billing)
14. [Shared Page (`/shared/[token]`)](#14-shared-page-sharedtoken)
15. [Shared Quiz (`/shared/[token]/quiz`)](#15-shared-quiz-sharedtokenquiz)
16. [Admin Page (`/admin`)](#16-admin-page-admin)
17. [About Page (`/about`)](#17-about-page-about)
18. [Global Patterns](#18-global-patterns)

---

## 1. Home Page (`/`)

The public landing page. Unauthenticated users land here.

### Header Navigation
| Element | Action |
|---|---|
| "Home" link | Scrolls to top of page |
| "Features" link | Scrolls to `#features` section |
| "Pricing" link | Scrolls to `#pricing` section |
| "Log in" button (ghost, desktop only) | Navigates to `/auth` |
| "Upload" button | Navigates to `/auth` (redirects to dashboard if already logged in) |

### Auto-Redirect
- If a valid token exists in `localStorage`, the page automatically redirects to `/dashboard` without any user action needed.

---

## 2. Auth Page (`/auth`)

Handles both login and signup. After signup, runs a 4-step onboarding flow.

### Login / Signup Toggle
| Element | Action |
|---|---|
| "Log In" tab | Switches form to login mode |
| "Sign Up" tab | Switches form to signup mode |
| "Don't have an account? Sign up" link | Switches to signup mode |
| "Already have an account? Sign in" link | Switches to login mode |

### Login Form Fields
| Element | Behavior |
|---|---|
| Email field | `type="email"`, required |
| Password field | Text input, masked by default |
| Eye / EyeOff icon (right of password) | Toggles password visibility |
| "Remember Me" toggle | Stores session preference |
| "Forgot password?" link | Opens a mailto to `support@themcq.app` |
| "Continue" button | Submits login, shows spinner while loading, disabled during request |
| "Continue with Google" button | Initiates Google OAuth login |

### Signup Form Fields
| Element | Behavior |
|---|---|
| Email field | `type="email"`, required |
| Password field | Shows real-time strength meter: Weak / Fair / Good / Strong / Very strong (color-coded) |
| Eye / EyeOff icon | Toggles password visibility |
| Confirm password field | Validates match in real time |
| "Create Account" button | Submits signup, disabled during loading, shows spinner |
| "Continue with Google" button | Initiates Google OAuth signup |

### Feedback Banners
| Condition | Banner |
|---|---|
| Signup success (email ending `-fromali`) | Green banner: "yo bro 👊 welcome — 100 free credits dropped for you!" |
| Signup success (all others) | Green banner: "Account created! Signing you in…" |
| Any error | Red banner showing server error message |

---

### Onboarding Flow (4 Steps — After Signup)

Triggered automatically after a new account is created.

#### Step 0 — Welcome
| Element | Action |
|---|---|
| 3 feature cards (Upload, Generate, Improve) | Display only, not clickable |
| "Let's get started" button (with arrow icon) | Advances to Step 1 |

#### Step 1 — Name
| Element | Behavior |
|---|---|
| Name input field | `autofocus`, placeholder "Your first name" |
| Pressing **Enter** | Advances to Step 2 |
| "Continue" button (arrow icon) | Advances to Step 2 |

#### Step 2 — University
| Element | Behavior |
|---|---|
| University input field | Text field, placeholder "University or College name" |
| Pressing **Enter** | Advances to Step 3 |
| "Continue" button | Advances to Step 3 |

#### Step 3 — College / Faculty Selection
| Element | Behavior |
|---|---|
| Faculty card (e.g. Medicine, Pharmacy, Dentistry, Nursing, Engineering, Computer Science, Business, Law, Science, Arts & Humanities, Education, Other) | Click to select; selected card shows primary background + green checkmark |
| "Continue" button | Advances to Step 4; only one selection allowed |

#### Step 4 — Year of Study
| Element | Behavior |
|---|---|
| Year buttons: 1 – 6 | Click to select year; selected button shows primary background |
| "Start studying" button (arrow icon) | Completes onboarding, enters app; **disabled** until a year is selected |

#### Onboarding Navigation
| Element | Action |
|---|---|
| Back button (left side) | Goes to previous step |
| Progress dots | Visual indicator of current step (not clickable) |
| "Step X of 4" label | Display only |

---

## 3. Dashboard (`/dashboard`)

The main hub after login.

### Header (AppHeader)
| Element | Action |
|---|---|
| Logo | Navigates to `/dashboard` |
| Credits display | Shows current credit balance |
| Profile avatar | Navigates to `/account` |

### Greeting Section
- Shows "Hey {name}" with badges for total lectures and total MCQs answered.
- Red error banner shown if data fails to load.

### Stats Card
Displays: Total Uploads, Processed, MCQs Answered, Avg. Score — read only.

### Daily Mission Card
| Element | Behavior |
|---|---|
| Progress bar | Shows today's question progress toward goal |
| Flame icon + streak badge | Displays current streak in days |
| "Mission complete!" message | Shown when daily goal is reached |
| FSRS due count (Brain icon) | Shows how many spaced-review questions are due today |

### Coach / Hero Card
| Element | Action |
|---|---|
| Circular readiness score (desktop) | Display only — shows predicted readiness % |
| Next action box | Display only — shows recommended next step + topic |
| Suggestion chip: "Plan my study session" | Navigates to `/coach?q=Plan%20my%20study%20session` |
| Suggestion chip: "What are my weak points?" | Navigates to `/coach?q=What%20are%20my%20weak%20points%3F` |
| Suggestion chip: "Quiz me on my worst topic" | Navigates to `/coach?q=Quiz%20me%20on%20my%20worst%20topic` |
| Suggestion chip: "Review a topic" | Navigates to `/coach?q=Review%20a%20topic` |
| Suggestion chip: "Motivate me" | Navigates to `/coach?q=Motivate%20me` |
| "Open Coach" button (Bot icon) | Navigates to `/coach` |
| "+ Upload Lecture" button | Navigates to `/upload` |

### Shared With You Card (visible only if shared sessions exist)
| Element | Action |
|---|---|
| Each shared lecture card | Navigates to the shared session |
| Progress bar + score | Display only |

### Your Lectures Card
| Element | Action |
|---|---|
| "All" tab | Shows all lectures |
| "Processed" tab | Filters to processed only |
| "Unprocessed" tab | Filters to unprocessed only |
| Each lecture row (processed) | Navigates to `/results/{id}` |
| Each lecture row (unprocessed) | Navigates to `/upload` |
| "View All MCQs" button | Navigates to `/lectures` |

---

## 4. Upload Page (`/upload`)

Where you submit content to generate MCQs.

### Telegram Announcement Modals

**First-time user modal:**
| Element | Action |
|---|---|
| "take me to the bot →" button | Opens Telegram bot link |
| "nah I'll find my files" button | Closes modal (disabled for 25 seconds) |

**In-Telegram modal:**
| Element | Action |
|---|---|
| "close & forward files →" button | Closes modal and proceeds |
| "nah I'll upload here" button | Closes modal (disabled for 10 seconds) |

### Mode Selector
| Element | Action |
|---|---|
| "Study" tab (BookOpen icon) | Selects study/revision mode |
| "Exam" tab (Medal icon) | Selects exam mode |

**Exam sub-mode cards (only visible in Exam mode):**
| Element | Action |
|---|---|
| "Hard" card | Selects hard exam mode (40% FALSE EXCEPT questions) |
| "Harder" card | Selects harder exam mode (~50% FALSE EXCEPT), cyan border when selected |

### Essay Mode Toggle
| Element | Action |
|---|---|
| Toggle switch | Enables / disables essay question generation mode |

### Smart Context Bar (CustomizeBar)
Visible if user has permissions. Allows customizing generation context.

### Input Mode Selector
| Element | Action |
|---|---|
| "PDF File" tab (CloudUpload icon) | Switches to file upload input |
| "Paste" tab (ClipboardPaste icon) | Switches to text/image paste input |

---

### File Upload Mode

| Element | Behavior |
|---|---|
| Drop zone | Drag a PDF file onto this area to attach it |
| Click drop zone | Opens system file picker (PDF only) |
| Attached file name + size | Displayed after attach |
| Validation badge (green checkmark) | "Looks good" — file is valid |
| Validation badge (orange warning) | File may have issues |
| Validation badge (red error) | File is invalid, cannot proceed |
| "Attached from Telegram" label | Shown if file came from Telegram bot |

**Upload states:**
- Default: dashed border drop zone
- Loading: Spinner + "Attaching your PDF..." + progress bar
- Success: Emerald styling
- Error: Destructive (red) styling

---

### Paste Mode

| Element | Behavior |
|---|---|
| Text area | Paste or type lecture notes; char counter shown |
| `Ctrl+V` hint | Shown before any content |
| Char counter | "{length} chars" — turns to warning if below 100 minimum |
| Validation badge | Shown after content is entered |
| "Upload image from phone / gallery" button (ImagePlus icon) | Opens image file picker (`image/*`) |
| Image thumbnail (after paste or gallery) | Preview shown with "Image pasted" or "Image from gallery" badge |
| "Switch to text instead" button | Clears image, returns to text area |
| Title input field | Optional, max 120 chars, placeholder "Title (optional) — e.g. Cardiology Lecture 3" |

---

### Generate Button

| State | Behavior |
|---|---|
| No content | Button hidden |
| Content ready | Large synapse-gradient button visible |
| Submitting | Button disabled + shows spinner |

**Button labels by mode:**
- Study: "Generate Revision MCQs"
- Exam Hard: "Generate Exam Questions"
- Exam Harder: "Generate Harder Questions"
- Essay on: "Generate Essay Questions"

### Global Error Message
Red banner with XCircle icon shown if upload fails.

### Info Cards (Bottom)
Three display-only cards describing features: MCQ Questions, Smart Summary, Flashcard Deck.

---

## 5. Waiting Room (`/upload/[jobId]`)

Shown while the backend processes your uploaded content.

### Processing State
| Element | Behavior |
|---|---|
| SVG circular progress ring | Animates from 0% to 100% as job progresses |
| Center text: "{progress}%" | Updates live |
| Status badge | Yellow = Queued, Blue = Generating, Green = Done, Red = Failed |
| Progress label | Text description of current step |
| Time estimate | "About X minutes remaining" → "About 1 minute" → "Almost done..." → "Wrapping up..." |
| Info card (info icon) | Tells you it's safe to close the tab — processing continues |
| Bookmark hint | Suggests bookmarking URL to return later |

Auto-redirects to `/results/{id}` when done.

### Error State
| Element | Action |
|---|---|
| Red X circle icon | Display only |
| "Generation Failed" heading | Display only |
| Error message text | Display only |
| "Try Again" button | Navigates back to `/upload` |

---

## 6. Results Page (`/results/[id]`)

Displays your MCQs, answers, summary, and key concepts after processing.

### Sticky Header
| Element | Behavior |
|---|---|
| Saving spinner | Shown while auto-saving progress |
| Saved checkmark | Shown when saved |
| Cloud-off icon | Shown when offline / unable to save |

---

### Sidebar

#### Performance Card
| Element | Action |
|---|---|
| Score display "{score} / {totalCount}" | Display only |
| Progress bar (violet → cyan gradient) | Display only |
| Accuracy % + answered count | Display only |
| Retake count (if > 0) | Display only |
| "Retake" button (RefreshCw icon) | Opens confirmation modal |
| Confirmation modal "Yes" button | Clears all answers, resets quiz |
| Confirmation modal "Cancel" button | Closes modal, keeps answers |
| Shuffle toggle (Shuffle icon) | Randomizes question order |

#### Sidebar Tabs
| Tab | Content |
|---|---|
| "Next" | Readiness score + recommended next action + weak topics |
| "AI" | AI-generated insight about your performance |
| "Plan" | 3-day study plan |
| "Quiz" | Weekly review quiz (if available) |

**Next Tab:**
| Element | Action |
|---|---|
| Circular readiness score | Display only |
| Next action box | Display only — shows recommended step, topic, reason bullets |
| Overconfidence alert (orange) | Display only — "Overconfidence pattern detected" |
| Weak topic rows (red/orange dots) | Display only — topic name + accuracy % |
| "Knowledge X-Ray" link | Navigates to `/xray/{id}` |

**AI Tab:**
| Element | Action |
|---|---|
| Refresh button (top-right) | Regenerates AI insight |
| Urgency badge | Display only (red / orange / green) |
| Insight message box | Display only |
| "Study Now" topic | Display only |
| "Hidden Pattern" (if available) | Display only |
| Loading state | Spinner + "Generating insight..." |

**Plan Tab:**
| Element | Behavior |
|---|---|
| Day 1, 2, 3 sections | Display only — priority badge, focus, question count |

**Quiz Tab:**
| Element | Action |
|---|---|
| "Start Quiz" button | Starts the weekly review quiz |
| "Dismiss" button | Hides the quiz card |
| Empty state (target icon) | Display only — prompts you to answer 3+ questions in weak topics |

#### Key Concepts Card (sidebar)
- Shows first 6 concepts as pills — display only.

---

### Main Content Area

#### Title Section
| Element | Behavior |
|---|---|
| "{totalCount} MCQs" badge | Display only |
| "Created {date}" badge | Display only |

#### Content Tabs
| Tab | Shows |
|---|---|
| "MCQs" | The full MCQ list |
| "Summary" | AI-generated summary text |
| "Key Concepts" | All key concepts as pills |

---

### MCQ Cards (MCQs Tab)

Each MCQ card has the following interactions:

| Element | Behavior |
|---|---|
| Option button (A / B / C / D) | Click to select answer (locks in your choice) |
| Option hover | Highlights with violet/10 background |
| Correct answer (after selection) | Shows emerald background + Check icon |
| Incorrect answer (after selection) | Shows red background + X icon |
| Other options (after reveal) | Show which would have been correct |

**After selecting an answer — Confidence Prompt:**
| Element | Action |
|---|---|
| "Guessed" button (orange) | Records confidence = Guessed |
| "Unsure" button (yellow) | Records confidence = Unsure |
| "Confident" button (emerald) | Records confidence = Confident |

**After submitting confidence — Explanation shown:**
- Green background if correct, violet if incorrect.
- Displays: "Answer: {letter} — {explanation}"
- Confidence badge shown.

#### Complete Score Banner (when all answered)
| Element | Action |
|---|---|
| Score display | Display only |
| "Great work!" or "Keep studying!" message | Display only |
| Retake button | Clears answers, resets quiz |

---

### Mobile Bottom Tools Bar
| Button | Action |
|---|---|
| Quiz button (violet) | Navigates to `/quiz/{id}` |
| X-Ray button (sky-blue) | Navigates to `/xray/{id}` |
| Shuffle toggle | Randomizes question order |
| Share button | Copies shareable link to clipboard |

### Mobile Bottom Navigation
| Icon | Destination |
|---|---|
| Home | `/dashboard` |
| Study (active) | Current page |
| Stats | `/analytics` |

---

## 7. Quiz Page (`/quiz/[id]`)

Timed quiz mode for focused practice.

### Sticky Header
| Element | Behavior |
|---|---|
| Timer (centered) | Counts up from 0:00 |
| Question counter (e.g. "3 / 10") | Display only |
| Exit link (X icon) | Navigates back to results / previous page |

### Quiz Screen
| Element | Behavior |
|---|---|
| Progress bar (top of page) | Fills as you advance through questions |
| Question text | Display only |
| Option button A / B / C / D | Click to select and reveal answer |
| Selected option (before reveal) | Violet/10 background |
| Correct option (after reveal) | Emerald/10 + Check icon |
| Incorrect option (after reveal) | Red/10 + X icon |
| Explanation text (after reveal) | Emerald background if correct, violet if incorrect |
| Wrong Answer Autopsy (if incorrect) | Red/10 box explaining why your choice was wrong |
| "Skip" link | Skips current question without answering |
| "Next" button | Advances to next question; **disabled** until answer is revealed |
| "Finish" button (last question) | Goes to result screen; disabled until answered |

### Result Screen
| Element | Action |
|---|---|
| Score display "{score} / {totalCount}" | Display only |
| Progress bar | Display only |
| Result message | "Well done — you're ready." (≥70%) or "Keep reviewing and try again." (<70%) |
| "Retake" button (secondary) | Resets quiz from beginning |
| "Review" button (primary) | Navigates to `/results/{id}` |
| "Back to Coach with Results" button (if from coach) | Returns to coach with score data |

---

## 8. Flashcards Hub (`/flashcards`)

Overview of all your flashcard decks.

### Header
| Element | Action |
|---|---|
| "{total_cards_seen} seen" badge | Display only |
| "{streak_days}d streak" badge | Display only |
| "Review {dueToday} card(s)" button | Navigates to `/flashcards/review` |
| "All caught up" button | Display only (disabled when 0 due) |

### Stats Grid
Four display-only cards: Streak, Mastered, Seen, Reviews.

### Retention by Topic Card
| Element | Behavior |
|---|---|
| Topic rows | Display only — topic name + retention % + progress bar |

### By Lecture Card
| Element | Action |
|---|---|
| Each lecture row | Display only |
| "Review" button | Starts review session for that lecture |
| "Browse" button | Opens browse/browse mode for that lecture |

### Empty State
| Element | Action |
|---|---|
| "+ Upload Lecture" button | Navigates to `/upload` |

---

## 9. Flashcard Review (`/flashcards/review`)

FSRS-based spaced repetition review session.

### Header
| Element | Action |
|---|---|
| X (close) button | Navigates back to `/flashcards` |
| Progress bar | Visual indicator of session completion |
| "{currentIndex + 1} / {cards.length}" | Display only |

### Card — Front Side (Question)
| Element | Behavior |
|---|---|
| Card type badge | Display only |
| Topic label | Display only |
| Question text (large, centered) | Display only |
| "Show Answer" button | Flips card to reveal answer |
| **Space** key | Flips card to reveal answer |
| **Enter** key | Flips card to reveal answer |

### Card — Back Side (Answer)
| Element | Behavior |
|---|---|
| Answer text | Display only |
| Memory tip (yellow/10 box) | Display only |
| 🔴 "Again" button | Rates card — schedules for very soon |
| 🟠 "Hard" button | Rates card — harder interval |
| 🟢 "Good" button | Rates card — normal interval |
| ⚡ "Easy" button | Rates card — longer interval |
| **Key 1** | Same as "Again" |
| **Key 2** | Same as "Hard" |
| **Key 3** | Same as "Good" |
| **Key 4** | Same as "Easy" |

### Done Screen
| Element | Action |
|---|---|
| Cards reviewed count | Display only |
| Time taken | Display only |
| Average rating | Display only |
| "Back to Hub" button | Navigates to `/flashcards` |
| "Review More" button (RefreshCw icon) | Starts a new review session |

---

## 10. Coach Page (`/coach`)

AI study advisor with persistent conversation history.

### Sidebar

| Element | Action |
|---|---|
| "New Conversation" button | Creates a new chat, clears active conversation |
| Search input field | Filters conversation list by text |
| X button (in search) | Clears search query |
| Conversation item (click) | Opens that conversation |
| Orange pulsing dot on conversation | Click to open practice sessions popover for that conversation |
| Practice session item (in popover) | Opens that specific practice session |
| Delete button (trash icon, hover) | Deletes that conversation |
| "Back to Dashboard" link (bottom) | Navigates to `/dashboard` |

### Header
| Element | Action |
|---|---|
| Hamburger menu (mobile) | Toggles sidebar open/closed |
| Plus (+) button | Creates new conversation |

### Messages Area
| Element | Behavior |
|---|---|
| User message bubble | Display only (right-aligned) |
| Image attachment (in user message) | Display only |
| Assistant message bubble | Display only (left-aligned) |
| Quick Reply chip (horizontal scroll) | Click to send that reply as a message |
| Practice card "MCQ" button | Starts an MCQ practice session |
| Practice card "Essay" button | Starts an essay practice session |
| Check-In Banner dismiss (X) | Hides the check-in banner |
| "Why This Matters" expandable | Click to expand/collapse |
| Mastery bar | Display only |
| Topic chain | Display only |
| Calibration Pulse (orange alert) | Display only |
| Thinking state (animated dots) | Display only — AI is responding |

### Input Area

| Element | Action |
|---|---|
| "Llama 3.3" toggle | Switches model to Llama (locked for free users) |
| "Gemini 2.5" toggle | Switches model to Gemini (locked for free users) |
| Practice button (dumbbell icon) | Toggles practice panel open/closed |
| Paperclip (attachment) button | Opens image file picker (locked for free users) |
| Image preview thumbnail | Display only |
| X on image preview | Removes attached image |
| Text area | Type your message here (auto-expands, max 140px height) |
| **Enter** key | Sends message |
| **Shift + Enter** | New line without sending |
| Send button (arrow up icon) | Sends message; **disabled** if text area is empty |

### Practice Panel (when toggled open)
| Element | Action |
|---|---|
| Topic input field | Type the topic to practice |
| Count button "3" | Sets question count to 3 |
| Count button "5" | Sets question count to 5 |
| Count button "10" | Sets question count to 10 |
| "MCQs" button | Sets type to MCQ |
| "Essays" button | Sets type to Essay |
| Submit / Start button | Launches practice session modal |

### Lock / Rate Limit Banner
| Element | Action |
|---|---|
| "New Chat" button | Creates a new conversation |
| "Get Pro" link | Navigates to billing / upgrade page |
| Countdown timer | Display only |

---

### Practice Modal (Full-Screen Overlay)

#### Building Phase
| Element | Behavior |
|---|---|
| Animated squares grid | Display only |
| Progress bar | Display only |
| Status text | Display only |

#### Countdown Phase
| Element | Behavior |
|---|---|
| Large countdown: 3 → 2 → 1 → GO! | Display only |
| Motivational text | Display only |

#### MCQ Phase
| Element | Action |
|---|---|
| Progress bar | Display only |
| Question text | Display only |
| Option button (A / B / C / D) | Click to select answer, triggers feedback |
| Correct feedback (emerald) | Display only |
| Incorrect feedback (red + explanation) | Display only |
| Auto-advance countdown bar | Automatically moves to next question |

#### Essay Phase
| Element | Action |
|---|---|
| Progress bar | Display only |
| Question text | Display only |
| Key points badges | Display only |
| "Show Model Answer" button | Reveals the model answer card |
| Model answer card | Display only |
| "Next Question" button | Advances to next essay question |
| "Finish Review" button (last question) | Ends session |

#### Done Phase
| Element | Action |
|---|---|
| Score % (large, colored) | Display only |
| Score bar | Display only |
| "Back to Coach" button | Closes modal, returns to coach chat |

---

## 11. Analytics Page (`/analytics`)

Your performance history and statistics.

### Header
| Element | Action |
|---|---|
| "7d" button | Filters data to last 7 days |
| "14d" button | Filters data to last 14 days |
| "30d" button | Filters data to last 30 days |

### Stats Row
Four display-only metric cards: Sessions, Questions, Accuracy, Streak.

### Accuracy Timeline Chart
| Element | Behavior |
|---|---|
| Each bar | Hover to see tooltip: "{accuracy}% · {questions_answered}q" |
| X-axis date labels | Display only |
| Y-axis guide lines | Display only |

### Confidence vs Accuracy Card
Colored bar chart — display only.

### Weak Topics Card
| Element | Behavior |
|---|---|
| Topic rows | Display only — topic name, accuracy %, attempt count, progress bar |
| AlertTriangle icon | Shown for topics below 50% accuracy |

### Co-Failing Topics Card
Display-only pairs of topics that you tend to fail together.

### Empty State
Shown when no quiz data exists. Display only with message to complete quizzes.

---

## 12. Account Page (`/account`)

Manage your profile and session.

### Header
| Element | Action |
|---|---|
| Back to Dashboard link | Navigates to `/dashboard` |

### Profile Card
| Element | Action |
|---|---|
| Avatar (24×24, initial letter) | Click to open image file picker |
| Avatar hover (camera icon overlay) | Visual cue to click |
| "Change photo" text link | Click to open image file picker |
| Hidden file input | `accept="image/*"` — triggered by avatar or link click |
| Display name (view mode) | Display only |
| Pencil icon (next to name) | Switches name to edit mode |
| Name input field (edit mode) | Type new display name |
| Check button (edit mode) | Saves new name |
| X button (edit mode) | Cancels edit, restores original name |
| **Enter** key (edit mode) | Saves new name |
| **Escape** key (edit mode) | Cancels edit |
| Error message (below name) | Display only if save fails |

### Account Info Card
All rows are display only:
- Email, University, College, Year, Plan (badge), Credits

### Logout Card
| Element | Action |
|---|---|
| "Log out" button (destructive, LogOut icon) | Logs out and redirects to `/auth` |

### Mobile Bottom Navigation
| Icon | Destination |
|---|---|
| Home | `/dashboard` |
| Upload | `/upload` |
| Coach | `/coach` |
| Analytics | `/analytics` |

---

## 13. Billing Page (`/billing`)

Manage credits and payments.

### Banners (shown based on URL params)
| Condition | Banner |
|---|---|
| Payment success | Green: "Payment received — credits will appear shortly" |
| Checkout canceled | Gray: "Checkout canceled. You were not charged." |

### Use Credits Toggle
| Element | Action |
|---|---|
| Toggle switch | Enables / disables credit spending for uploads and coach messages |
| When disabled | All buy/pay buttons become `opacity-50` and non-functional |

### Usage Bar Section
| Element | Action |
|---|---|
| "↻ Sync Wayl payments" link | Triggers sync of Wayl payment records |
| "Refresh" button (with spinner) | Refreshes credit balance from server |
| Usage progress bar | Display only — color changes: gradient (<80%), amber (80–99%), red (≥100%) |
| "Uploads: X/Y" | Display only |
| "Coach msgs: X/Y" | Display only |

### Monthly Spend Limit
| Element | Action |
|---|---|
| "No limit" button | Sets no monthly spend cap |
| "10" button | Sets cap to 10 credits/month |
| "25" button | Sets cap to 25 |
| "50" button | Sets cap to 50 |
| "100" button | Sets cap to 100 |
| Selected button | Shows violet background |

### Buy Credits Section
| Element | Action |
|---|---|
| Preset button "10" | Sets purchase amount to 10 |
| Preset button "25" | Sets purchase amount to 25 |
| Preset button "50" | Sets purchase amount to 50 |
| Preset button "100" | Sets purchase amount to 100 |
| Custom amount input | Type any number (min = 1) |
| Price display | Updates automatically based on amount |
| "Pay with card (USD)" button | Initiates Stripe checkout for USD payment |
| "Pay with Wayl (IQD)" button | Initiates Wayl checkout for IQD payment |
| Cost footnote | Display only — shows per-upload and per-message credit cost |

---

## 14. Shared Page (`/shared/[token]`)

A public shareable view of an MCQ set.

### Header
| Element | Action |
|---|---|
| Logo | Navigates to `/dashboard` (logged in) or `/` (guest) |
| "Shared" badge (desktop) | Display only |
| Cloud save indicator (logged in) | Green = saving, orange = not saving (guest) |
| View count button | Display only |
| "Quiz Mode" button | Navigates to `/shared/{token}/quiz` |
| "Share" button | Copies shareable link to clipboard |
| Shuffle button | Toggles shuffle mode |
| Home button | Navigates to `/dashboard` |

### Tabs
| Tab | Content |
|---|---|
| MCQs | Full MCQ list |
| Summary | AI summary text |
| Key Concepts | All concepts as pills |

### Sidebar — Progress Card
| Element | Action |
|---|---|
| Progress bar | Display only |
| "{answeredCount}/{totalCount} answered" | Display only |
| "Retake" button (Refresh icon) | Opens confirmation modal |
| Confirmation "Yes" button | Clears all answers |
| Confirmation "Cancel" button | Closes modal |
| Guest retake gate (after 1 retake) | Shows "Sign up to retake" — links to `/auth?redirect=/shared/{token}` |

### Sidebar — Key Concepts Card
Pills (up to 6) — display only.

### MCQ Cards
Same interactions as [Results Page MCQ Cards](#mcq-cards-mcqs-tab) — select answer, confidence prompt, explanation revealed.

**Guest tooltips:**
- Before answering: "Your answers are not saved — create free account to auto-save"
- After wrong answer: "Track your weak spots" → links to sign up

### Mobile Tools Bar (logged in only)
| Button | Action |
|---|---|
| "Quiz Mode" button | Navigates to `/shared/{token}/quiz` |
| Shuffle toggle | Randomizes question order |
| Share button | Copies link to clipboard |

### Mobile Bottom Navigation
| State | Links |
|---|---|
| Logged in | Home (`/dashboard`), Upload (`/upload`), Analytics (`/analytics`) |
| Guest | Home (`/`), Quiz (`/shared/{token}/quiz`), Sign up (`/auth`) |

---

## 15. Shared Quiz (`/shared/[token]/quiz`)

Quiz mode for a shared MCQ set. Same interactions as [Quiz Page (`/quiz/[id]`)](#7-quiz-page-quizid) — see that section for all controls.

---

## 16. Admin Page (`/admin`)

Admin-only access. No public link.

### Login Screen
| Element | Action |
|---|---|
| Email input | Type admin email |
| Password input | Type admin password |
| Eye / EyeOff icon | Toggle password visibility |
| "Sign In" button | Submits login; disabled during loading |
| Error banner (red) | Display only if login fails |

### Dashboard Screen (after login)
| Element | Action |
|---|---|
| Refresh button | Refreshes all stats |
| "Sign out" button | Logs out of admin session |

**Stat Cards** — all display only:
Total Users, Free users, Pro users, Enterprise users, Total Credits, New Today, New This Week.

**Set Credits Form:**
| Element | Action |
|---|---|
| Email input | Target user's email |
| Credits input (number) | Amount to set |
| "Set Credits" button | Applies credit change |
| Success / error message | Display only |

---

## 17. About Page (`/about`)

Static informational page. All content is display only, loaded from `/api/content/about`.

---

## 18. Global Patterns

### Keyboard Shortcuts (all pages)
| Key | Action |
|---|---|
| **Enter** | Submit forms, advance onboarding steps, flip flashcards |
| **Escape** | Cancel edit modes (name edit on account page) |
| **Space** | Flip flashcard (review page) |
| **1** | Rate flashcard "Again" |
| **2** | Rate flashcard "Hard" |
| **3** | Rate flashcard "Good" |
| **4** | Rate flashcard "Easy" |
| **Ctrl+V** | Paste in upload paste mode (hint shown) |

### Toggle Patterns
All toggles (Remember Me, Essay Mode, Use Credits, Shuffle) are custom rounded-full switch components. Click anywhere on the toggle to flip it.

### Progress Bars
Visual only — fill from left to right. Color coding:
- Violet → Cyan gradient: normal progress
- Emerald: daily goal completed
- Amber: approaching limit (80–99%)
- Red/Destructive: limit reached or critical

### Modals / Dialogs
All confirmation modals have:
- A "Yes" / "Confirm" button (destructive action)
- A "Cancel" button (safe exit)
- Clicking outside the modal does NOT close it — you must use the buttons.

### Auto-Save
On Results and Shared pages, your answers are auto-saved to the server as you answer. The save status is shown in the sticky header (spinner → checkmark → cloud-off).

### Error Banners
Red destructive banners appear at the top of page content when a server or network error occurs. They are display only — no interaction needed.

### Mobile Bottom Navigation Bar
Present on most authenticated pages. Fixed to the bottom of the viewport. Tabs:
- Home → `/dashboard`
- Upload → `/upload`
- Lectures or Flashcards (context-dependent)
- Coach → `/coach`
- Analytics → `/analytics`

### AppHeader (authenticated)
- Left: Logo → `/dashboard`
- Right: Credits balance (display) + Avatar → `/account`
