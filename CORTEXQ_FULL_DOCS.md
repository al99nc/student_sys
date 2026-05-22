# CortexQ — Complete Project Documentation
> Everything about the codebase. Every system. Every file. Every decision. No gaps.

---

## Table of Contents
1. [What CortexQ Is](#1-what-cortexq-is)
2. [Infrastructure & Hosting](#2-infrastructure--hosting)
3. [Repository Structure](#3-repository-structure)
4. [Environment Variables (.env)](#4-environment-variables-env)
5. [Database & Models](#5-database--models)
6. [Backend — All API Routers](#6-backend--all-api-routers)
7. [AI System](#7-ai-system)
8. [Spaced Repetition (FSRS)](#8-spaced-repetition-fsrs)
9. [Performance & Adaptive Learning Engine](#9-performance--adaptive-learning-engine)
10. [AI Coach System](#10-ai-coach-system)
11. [Billing & Payments](#11-billing--payments)
12. [Entitlements & Plans](#12-entitlements--plans)
13. [Telegram Bot & Mini App](#13-telegram-bot--mini-app)
14. [Frontend — All Pages](#14-frontend--all-pages)
15. [Auth System](#15-auth-system)
16. [Security](#16-security)
17. [Rate Limiting](#17-rate-limiting)
18. [Docker & Deployment](#18-docker--deployment)
19. [Known Gaps & Missing Pieces](#19-known-gaps--missing-pieces)

---

## 1. What CortexQ Is

CortexQ (live at **themcq.xyz**) is an AI-powered study platform for university students, originally built for Iraqi medical students. The core loop is:

1. Student uploads a PDF lecture
2. AI generates MCQs (multiple choice questions) and/or essays from it
3. Student answers questions
4. The system tracks every answer with deep behavioral data (confidence, time, hover patterns)
5. An FSRS spaced repetition algorithm schedules when each question comes back
6. An AI coach analyses the student's weak points and gives personalised coaching

It is a full SaaS product with free and paid plans, Stripe subscriptions, Iraqi payment gateway (Wayl/IQD), a Telegram bot, and a Telegram Mini App.

The GitHub repo is: `https://github.com/al99nc/student_sys`

---

## 2. Infrastructure & Hosting

| Thing | Detail |
|---|---|
| VPS | Ubuntu, IP `84.235.244.210` |
| Domain | `themcq.xyz` (registered on Namecheap, DNS on Cloudflare) |
| Tunnel | Cloudflare Tunnel, tunnel ID `32460acc-9389-45b9-b5c9-88b6a7ea5957`, named `cortexq` |
| Config file | `~/.cloudflared/config.yml` |
| Database | SQLite in production (`/app/db/students.db`), PostgreSQL-compatible via SQLAlchemy (psycopg2 installed) |
| Deployment | Docker Compose, 3 services: `backend`, `frontend`, `bot` |
| Backend port | 8000 (mapped from container to host) |
| Frontend port | 3000 (mapped from container to host) |
| Uploads folder | `./backend/uploads` mounted to `/app/uploads` in container |
| DB folder | `./backend/db` mounted to `/app/db` in container |

**Known ISP issue:** Iraqi ISPs route Cloudflare traffic to Bulgaria instead of a nearby PoP. Fix in progress using Gcore CDN with an `origin.themcq.xyz` subdomain.

---

## 3. Repository Structure

```
student_sys/
├── docker-compose.yml          ← orchestrates all 3 services
├── setup.sh                    ← server setup script
├── manifest.json               ← PWA manifest
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/                ← database migration history
│   ├── migrations/             ← extra migration scripts
│   └── app/
│       ├── main.py             ← FastAPI app, all routers registered, DB migrations on boot
│       ├── api/
│       │   ├── admin.py        ← admin-only endpoints
│       │   ├── ai_tools.py     ← personal memory system (save/recall facts per student)
│       │   ├── analytics.py    ← usage analytics endpoints
│       │   ├── auth.py         ← signup, login, onboarding, /me
│       │   ├── billing.py      ← Stripe + Wayl payments, subscriptions, credits
│       │   ├── coach.py        ← full conversation management, coach messages
│       │   ├── content.py      ← dynamic site content (CMS-like)
│       │   ├── deps.py         ← get_current_user JWT dependency
│       │   ├── lectures.py     ← PDF upload, MCQ/essay generation, sharing
│       │   ├── performance.py  ← THE BIG ONE: sessions, FSRS, coaching AI, analytics
│       │   └── telegram.py     ← Telegram initData auth, bot temp file endpoints
│       ├── core/
│       │   ├── config.py       ← all settings via pydantic-settings (reads .env)
│       │   ├── coach_router.py ← coach-specific routing logic
│       │   ├── entitlements.py ← plan limits, credit spend/refund, usage counters
│       │   ├── global_token_guard.py ← global daily token cap across ALL users
│       │   ├── limiter.py      ← slowapi rate limiter instance
│       │   ├── security.py     ← bcrypt hashing, JWT creation/decode
│       │   └── usage_guard.py  ← per-user token budget enforcement
│       ├── db/
│       │   └── database.py     ← SQLAlchemy engine, Base, SessionLocal, get_db
│       ├── models/
│       │   ├── ai_tools.py     ← PersonalMemory model
│       │   ├── billing.py      ← Subscription, AIUsageLog models
│       │   ├── coach.py        ← CoachConversation, CoachMessage models
│       │   ├── content.py      ← SiteContent model
│       │   ├── models.py       ← User, Lecture, Result, QuizSession, CoachPerformanceUsage, CheckoutPayment, WaylPayment
│       │   └── performance.py  ← PerformanceSession, McqQuestion, QuestionAttempt, WeakPoint, WeeklyQuizAssignment, TopicCoFailure, TopicSnapshot, AnswerTimeline, LearningPattern, StudentAiInsight, FsrsCard
│       ├── schemas/
│       │   ├── analytics.py
│       │   ├── auth.py
│       │   ├── content.py
│       │   ├── lecture.py
│       │   └── performance.py  ← all request/response Pydantic models for performance endpoints
│       ├── services/
│       │   ├── ai_service.py   ← re-exports from generator, prompts, validators
│       │   ├── analytics_service.py
│       │   ├── generator.py    ← MCQ generation: chunking, parallel AI calls, merging
│       │   ├── pdf_service.py  ← PDF text extraction via pypdf
│       │   ├── prompts.py      ← all system+user prompts for MCQ generation (4 modes)
│       │   └── validators.py   ← MCQ quality filters, deduplication, answer distribution checks
│       └── utils/
│           └── helpers.py      ← sanitize_nulls and other shared utilities
├── bot/
│   ├── Dockerfile
│   ├── requirements.txt        ← aiogram, telethon, aiohttp, python-dotenv
│   ├── bot.py                  ← main Telegram bot (aiogram 3)
│   └── joiner.py               ← Telethon userbot: join group, promote bot as admin, leave
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── next.config.mjs
    ├── app/                    ← Next.js 14 App Router pages
    ├── components/             ← React components
    ├── hooks/                  ← custom React hooks
    ├── lib/                    ← utility functions, API client
    └── public/                 ← static assets
```

---

## 4. Environment Variables (.env)

All variables are read by `backend/app/core/config.py` using pydantic-settings. The file is expected at `../.env` or `.env` relative to the backend directory.

### Auth & Security
| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | `dev-secret-key-change-in-production` | JWT signing key. Must be 32+ chars in production. App hard-exits if weak key detected in prod. |
| `ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT expiry (24 hours) |

### Database
| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./students.db` | SQLAlchemy connection string. In Docker: `sqlite:////app/db/students.db` |
| `UPLOAD_DIR` | `uploads` | Directory where uploaded PDFs are saved |

### AI — MCQ Generation
| Variable | Default | Description |
|---|---|---|
| `AI_API_KEY` | `""` | Primary Groq API key for MCQ generation |
| `AI_API_KEYS` | `""` | Comma-separated extra Groq keys (rotated on rate limit) |
| `AI_MODEL` | `llama-3.3-70b-versatile` | Legacy default model (used in insight generation) |
| `FREE_AI_MODEL` | `llama-3.3-70b-versatile` | Model used for free tier MCQ generation (Groq) |
| `PREMIUM_AI_MODEL` | `gemini-2.5-flash` | Model used for paid tier MCQ generation (auto-synced from GEMINI_PAID_MODEL) |
| `FREE_INTER_CHUNK_WAIT_SECONDS` | `60` | Seconds to wait between PDF chunks for free users (Groq rate limit protection) |
| `PREMIUM_INTER_CHUNK_WAIT_SECONDS` | `20` | Same for paid users |

### AI — Chat/Coach
| Variable | Default | Description |
|---|---|---|
| `CHAT_AI_API_KEY` | `""` | Groq API key used for the AI coach chat (separate from MCQ key) |
| `FREE_CHAT_MODEL` | `llama-3.3-70b-versatile` | Coach model for free users |
| `PREMIUM_CHAT_MODEL` | `gemini-2.5-flash` | Coach model for paid users (auto-synced from GEMINI_PAID_MODEL) |
| `ANALYZER_MODEL` | `gpt-oss-120b` | Model used in the 2-stage pipeline Analyzer step |
| `HUMANIZER_MODEL` | `llama-3.3-70b-versatile` | Model used in the 2-stage pipeline Humanizer step |
| `FREE_CHAT_TIMEOUT_S` | `25.0` | Request timeout for free coach calls (seconds) |
| `PREMIUM_CHAT_TIMEOUT_S` | `120.0` | Request timeout for paid coach calls (seconds) |

### AI — Gemini / OpenRouter
| Variable | Default | Description |
|---|---|---|
| `GEMINI_PAID_API_KEY` | `""` | Google AI Studio API key for Gemini |
| `GEMINI_PAID_MODEL` | `gemini-2.5-flash` | Gemini model name |
| `GEMINI_API_BASE` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI-compatible base URL |
| `open_rout_PAID_API_KEY` | `""` | OpenRouter API key (preferred over Gemini direct if set) |
| `open_rout_PAID_MODEL` | `google/gemini-2.5-flash` | OpenRouter model string |

**Logic:** If `open_rout_PAID_API_KEY` is set, premium calls go to OpenRouter. Otherwise they go directly to Google AI Studio. OpenRouter is preferred because it avoids billing region issues with Iraqi IPs.

### Token Budgets & Limits
| Variable | Default | Description |
|---|---|---|
| `FREE_PDF_UPLOADS_PER_MONTH` | `10` | Max uploads per month for free users |
| `PRO_PDF_UPLOADS_PER_MONTH` | `100` | Max uploads per month for pro users |
| `FREE_COACH_MESSAGES_PER_MONTH` | `300` | Max coach messages per month for free users |
| `PRO_COACH_MESSAGES_PER_MONTH` | `9999` | Effectively unlimited for pro users |
| `FREE_DAILY_TOKEN_BUDGET` | `8000` | Max AI tokens per day for free users |
| `PRO_DAILY_TOKEN_BUDGET` | `600000` | Max AI tokens per day for pro users |
| `ENTERPRISE_DAILY_TOKEN_BUDGET` | `0` | 0 = unlimited for enterprise |
| `GLOBAL_DAILY_TOKEN_BUDGET` | `50000000` | Hard cap across ALL users per UTC day (failsafe) |
| `REDIS_URL` | `""` | Optional Redis for fast global token counter. Empty = DB-backed fallback |

### Credits & Billing
| Variable | Default | Description |
|---|---|---|
| `CREDIT_COST_MCQ_PROCESS` | `6` | Internal units charged per MCQ generation (6 units = 3 credits) |
| `CREDIT_COST_COACH_MESSAGE` | `1` | Internal units charged per coach message (1 unit = 0.5 credits) |
| `CREDIT_PRICE_CENTS` | `100` | Price per credit in cents USD ($1.00 per credit) |
| `CREDIT_PRICE_IQD` | `250` | Price per credit in Iraqi Dinar |
| `CHECKOUT_CURRENCY` | `usd` | Stripe checkout currency |
| `APP_PUBLIC_URL` | `http://localhost:3000` | Frontend URL used for Stripe redirect URLs |
| `COST_PER_1K_TOKENS_FREE` | `0.0001` | Cost logging only (Groq llama) |
| `COST_PER_1K_TOKENS_PREMIUM` | `0.0025` | Cost logging only (gpt-oss-120b) |

### Stripe
| Variable | Default | Description |
|---|---|---|
| `CHECKOUT_SECRET_KEY` | `""` | Stripe secret key (sk_live_... or sk_test_...) |
| `CHECKOUT_WEBHOOK_SECRET` | `""` | Stripe webhook signing secret (whsec_...) |
| `STRIPE_PRICE_PRO_MONTHLY` | `""` | Stripe Price ID for pro monthly subscription |
| `STRIPE_PRICE_PRO_YEARLY` | `""` | Stripe Price ID for pro yearly subscription |

### Wayl (Iraqi Payment Gateway)
| Variable | Default | Description |
|---|---|---|
| `WAYL_API_KEY` | `""` | Wayl merchant API key |
| `WAYL_API_BASE_URL` | `https://api.thewayl.com` | Wayl API base URL |
| `WAYL_WEBHOOK_SECRET` | `""` | Secret sent to Wayl to sign webhooks |

### Telegram
| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `""` | BotFather token for the CortexQ bot |
| `BOT_TOKEN` | `""` | Same token used by the bot Docker service |
| `BOT_SECRET` | `cortexq-bot-secret-2026` | Shared secret between bot and backend for `/api/bot/*` endpoints |
| `MINI_APP_URL` | `https://themcq.xyz/upload` | URL the bot opens as a Mini App |
| `BACKEND_URL` | (hardcoded in docker-compose) | Bot uses `http://84.235.244.210:8000/` |
| `OWNER_ID` | `0` | Your Telegram numeric user ID. Only you can send t.me links to the bot |
| `TELEGRAM_API_ID` | `""` | From my.telegram.org — used by Telethon userbot |
| `TELEGRAM_API_HASH` | `""` | From my.telegram.org — used by Telethon userbot |
| `TELEGRAM_PHONE` | `""` | Your phone number for Telethon session (e.g. +9647...) |
| `BOT_USERNAME` | `""` | Bot username without @ (e.g. cortexq_bot) |

### CORS
| Variable | Default | Description |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000,https://themcq.xyz,https://www.themcq.xyz` | Comma-separated allowed origins |

---

## 5. Database & Models

The database is SQLite in production. All models are SQLAlchemy ORM classes that inherit from `Base`. Tables are auto-created on startup via `Base.metadata.create_all(bind=engine)` in `main.py`. Column additions to existing tables are handled by raw ALTER TABLE statements also in `main.py` (lightweight manual migration).

### `users` table (`models/models.py`)
The central user account.

| Column | Type | Notes |
|---|---|---|
| `id` | String(36) | UUID primary key |
| `email` | String | Unique, indexed. Telegram users get synthetic `tg_{id}@telegram.local` |
| `hashed_password` | String | bcrypt hash. Telegram users get a random unhashable password |
| `name` | String(120) | Set during onboarding |
| `university` | String(255) | Set during onboarding |
| `college` | String(120) | Set during onboarding |
| `year_of_study` | Integer | Set during onboarding |
| `subject` | String(255) | Set during onboarding |
| `topic_area` | String(255) | Set during onboarding |
| `level` | String(50) | Set during onboarding |
| `credit_balance` | Integer | Pay-as-you-go credits. 1 credit = $1 or 250 IQD |
| `plan` | String(20) | `free` / `pro` / `enterprise`. Source of truth for plan |
| `stripe_customer_id` | String(255) | Set on first Stripe checkout, reused after |
| `extra_usage_enabled` | Integer | 1=on, 0=off. Toggle for spending credits beyond plan |
| `is_admin` | Integer | 1=admin. Only set via direct DB update |
| `signup_ip` | String(45) | Used to prevent trial abuse (no bonus credits for same IP) |
| `created_at` | DateTime | UTC timestamp |

**Special signup logic:** If the email local part ends with `-fromali`, the user gets 100 credits on signup (friend referral system). If the IP already has an account, new account gets 0 credits.

### `lectures` table (`models/models.py`)
One row per uploaded PDF.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer | Auto-increment primary key |
| `user_id` | String(36) | FK to users.id |
| `title` | String | Lecture/file name |
| `file_path` | String | Path to the PDF on disk |
| `university`, `college`, `year_of_study`, `subject`, `topic_area`, `level` | Various | Copied from user profile at upload time |
| `created_at` | DateTime | UTC |

### `results` table (`models/models.py`)
Stores AI-generated content for a lecture. One result per lecture.

| Column | Type | Notes |
|---|---|---|
| `id` | Integer | Auto-increment |
| `lecture_id` | Integer | FK to lectures.id |
| `summary` | Text | AI-generated summary |
| `key_concepts` | Text | JSON string of key concepts |
| `mcqs` | Text | JSON string of generated MCQs |
| `essays` | Text | JSON string of essay questions |
| `share_token` | String | Unique token for public sharing |
| `view_count` | Integer | How many times the shared result has been viewed |
| `custom_context` | Text | Extra context the user provided before generation |
| `created_at` | DateTime | UTC |

### `quiz_sessions` table (`models/models.py`)
Legacy. Stores raw answer JSON from the simple quiz page. Separate from the performance tracking system.

### `coach_performance_usage` table (`models/models.py`)
One row every time a user calls `POST /api/v1/performance/students/me/chat`. Used to count monthly usage.

### `checkout_payments` table (`models/models.py`)
Idempotency log for Stripe credit purchases. One row per Stripe Checkout Session ID. Prevents double-crediting.

### `wayl_payments` table (`models/models.py`)
Same as above but for Wayl/IQD payments. One row per Wayl reference ID.

### `subscriptions` table (`models/billing.py`)
Tracks active Stripe subscriptions.

| Column | Notes |
|---|---|
| `stripe_subscription_id` | Primary key |
| `user_id` | FK to users |
| `stripe_customer_id` | Stripe customer |
| `plan` | `pro` / `enterprise` |
| `status` | `active` / `trialing` / `canceled` / `past_due` / `unpaid` / `incomplete_expired` |
| `current_period_end` | When the current billing period ends |
| `cancel_at_period_end` | 1 if scheduled to cancel |

### `ai_usage_logs` table (`models/billing.py`)
One row per AI API call. Used for daily token budget counting and cost reporting.

| Column | Notes |
|---|---|
| `user_id` | Which user |
| `feature` | e.g. `mcq_generation`, `coach_chat` |
| `model` | Which model was called |
| `tokens_input` | Input tokens |
| `tokens_output` | Output tokens |
| `tokens_total` | Input + output |
| `cost_usd` | Estimated cost in USD |

### `coach_conversations` table (`models/coach.py`)
One row per conversation thread in the coach chat.

| Column | Notes |
|---|---|
| `id` | UUID |
| `student_id` | FK to users |
| `title` | Auto-generated from first message |
| `created_at` | UTC |

### `coach_messages` table (`models/coach.py`)
One row per message in a coach conversation.

| Column | Notes |
|---|---|
| `id` | UUID |
| `conversation_id` | FK to coach_conversations |
| `student_id` | FK to users |
| `role` | `user` or `assistant` |
| `content` | The message text |
| `metadata_json` | Extra data (action, topic_focus, urgency, etc.) |
| `created_at` | UTC |

### `personal_memories` table (`models/ai_tools.py`)
Facts the AI coach saves about a student across all conversations.

| Column | Notes |
|---|---|
| `id` | UUID |
| `student_id` | FK to users |
| `key` | snake_case identifier (e.g. `exam_date`) |
| `label` | Human-readable (e.g. "Exam Date") |
| `value` | The saved fact |
| `type` | `identity` / `goal` / `context` / `behavior` / `emotional` |
| `importance` | Float 0.0-1.0. Higher = more important |
| `reason` | Why this was saved |
| `updated_at` | UTC |

### `site_content` table (`models/content.py`)
CMS-style dynamic content for the website. Key-value store for page content that can be edited without a code deploy.

### Performance Models (`models/performance.py`)

#### `performance_sessions`
One quiz session by a student on one lecture.

| Column | Notes |
|---|---|
| `id` | UUID |
| `student_id` | FK users |
| `document_id` | FK lectures |
| `mode` | `highyield` / `exam` / `revision` / `quiz` |
| `started_at` | UTC |
| `completed_at` | UTC, null until complete |
| `total_questions` | How many questions in this session |
| `correct_count` | Running correct answer count |
| `duration_seconds` | Computed on completion |
| `readiness_score` | Float 0-100. `(correct/total * 100) - (weak_topic_penalty * 2)` |
| `avg_time_per_question` | Seconds |
| `abandoned` | Boolean |
| `rushed_count` | Questions answered in < 5 seconds |
| `started_from` | `performance` / `quiz_page` / `weekly_quiz` |
| `device_type` | `mobile` / `desktop` |
| `interruptions` | Count |
| `longest_pause_seconds` | Longest gap mid-session |
| `questions_skipped` | Count |

#### `mcq_questions`
One row per AI-generated MCQ, stored permanently after generation.

| Column | Notes |
|---|---|
| `id` | UUID |
| `document_id` | FK lectures |
| `topic` | Topic label (e.g. "Pharmacology — Beta Blockers") |
| `question_text` | The question |
| `option_a/b/c/d` | The four options |
| `correct_answer` | `A` / `B` / `C` / `D` |
| `explanation` | Why the answer is correct |
| `mode` | `highyield` / `exam` / `revision` |
| `difficulty_type` | `recall` / `application` / `analysis` |
| `global_accuracy_rate` | Across ALL students, what % answer this correctly |
| `global_avg_time` | Average time all students spend on this question |
| `discrimination_index` | Statistical measure of how well the question separates strong from weak students |

#### `question_attempts`
One row per student answer to one MCQ.

| Column | Notes |
|---|---|
| `id` | UUID |
| `session_id` | FK performance_sessions |
| `student_id` | FK users |
| `question_id` | FK mcq_questions |
| `selected_answer` | What the student picked (`A`-`D`) |
| `correct_answer` | The actual correct answer (denormalized) |
| `is_correct` | Boolean |
| `time_spent_seconds` | How long on this question |
| `attempt_number` | How many times this student has answered this question total |
| `confidence_proxy` | `1/time_spent` if correct, `0` if wrong (rough confidence signal) |
| `time_of_day` | Hour 0-23 when this was answered |
| `day_of_week` | 0=Monday |
| `answer_changed` | Did the student change their answer? |
| `original_answer` | What they first picked |
| `time_to_first_change` | Seconds before first answer change |
| `pre_answer_confidence` | 1=guessing / 2=pretty sure / 3=certain. Collected BEFORE answer reveal |
| `time_to_confidence` | Seconds from answer pick to confidence tap |
| `calibration_gap` | `(confidence - 1) * direction`. +1=underconfident, -1=overconfident, -2=dangerous overconfidence (certain + wrong) |
| `created_at` | UTC |

#### `weak_points`
One row per student per topic. The core tracker for the coaching system. Updated on every answer.

| Column | Notes |
|---|---|
| `id` | UUID |
| `student_id` | FK users |
| `topic` | Topic string (must match mcq_questions.topic) |
| `total_attempts` | Total times this student answered questions on this topic |
| `correct_attempts` | How many were correct |
| `accuracy_rate` | `correct_attempts / total_attempts` |
| `consecutive_failures` | How many wrong answers in a row right now |
| `last_attempted_at` | UTC |
| `last_correct_at` | UTC |
| `last_wrong_at` | UTC |
| `flagged_as_weak` | True if `accuracy < 0.6` AND `total_attempts >= 3` |
| `dangerous_misconception` | True if `calibration_gap == -2` (certain + wrong) |
| `most_common_wrong_answer` | The distractor letter this student picks most for this topic |
| `first_mastered_at` | When accuracy first crossed 0.8 |
| `times_mastered` | How many times mastery threshold was crossed |
| `times_relapsed` | How many times accuracy dropped from 0.8 back below 0.6 |
| `decay_rate` | Days from first mastery to first relapse (how fast they forget) |
| `accuracy_7d_ago` | Accuracy from 7 days ago (from TopicSnapshot) |
| `accuracy_trend` | `accuracy_now - accuracy_7d_ago` (positive = improving) |
| `updated_at` | UTC |

**Thresholds:**
- `MASTERY_THRESHOLD = 0.8` — accuracy must reach 80% to be "mastered"
- `RELAPSE_THRESHOLD = 0.6` — dropping below 60% after mastery = relapse

#### `weekly_quiz_assignments`
Auto-generated weekly quiz from flagged weak topics. Triggered when a student has 3+ flagged weak points and no pending assignment this week.

| Column | Notes |
|---|---|
| `student_id` | FK users |
| `week_start` | Date of Monday of the current week |
| `question_ids` | JSON array of McqQuestion UUIDs |
| `status` | `pending` / `completed` / `dismissed` |
| `completed_at` | UTC |

#### `topic_co_failures`
Tracks which topic pairs a student fails together. When a new topic gets flagged weak, it is paired with all other currently-flagged topics. Co-failure count increments on each new pairing.

| Column | Notes |
|---|---|
| `topic_a` | Alphabetically first topic |
| `topic_b` | Alphabetically second topic |
| `co_failure_count` | How many times these topics have been flagged together |
| UniqueConstraint | `(student_id, topic_a, topic_b)` |

#### `topic_snapshots`
Daily accuracy snapshot per topic. One row per student per topic per day. Used to compute 7-day trends.

#### `answer_timelines`
Per-option hover/dwell data. One row per question attempt. Optional — only saved if the frontend sends hover data.

| Column | Notes |
|---|---|
| `time_on_option_a/b/c/d` | Seconds hovered over each option |
| `second_choice` | Which option they almost picked |
| `re_read_question` | Did they scroll back up to re-read? |
| `re_read_count` | How many times |

#### `learning_patterns`
Computed cognitive profile per student. One row per student. This table is **read** everywhere but the write path (the background job that computes and updates it) is a known gap — not currently implemented.

| Column | Notes |
|---|---|
| `exam_date` | User's upcoming exam date (set via `/students/me/exam-date`) |
| `avg_sessions_per_week` | Study frequency |
| `preferred_time_of_day` | Hour 0-23 where performance is best |
| `consistency_score` | How regular is the student |
| `best_question_type` | `recall` / `application` / `analysis` |
| `worst_question_type` | Same |
| `overconfidence_rate` | Rate of certain+wrong answers |
| `answer_change_accuracy` | Do they improve when they change answers? |
| `avg_decay_days` | Average days before forgetting a mastered topic |
| `fastest_forgetting_topic` | Which topic decays fastest |
| `most_stable_topic` | Which topic is most retained |
| `mobile_accuracy` / `desktop_accuracy` | Performance by device |
| `morning/afternoon/evening_accuracy` | Performance by time of day |
| `projected_readiness_7d/14d/30d` | AI-predicted readiness scores |
| `behavioral_flags` | Comma-separated flags (e.g. `overconfident,rushes`) |

#### `student_ai_insights`
Persisted AI insight reports. Only one row is `is_current=True` per student at a time. Old insights are kept for history.

| Column | Notes |
|---|---|
| `insight_json` | Full JSON object from the insight AI call |
| `generated_at` | When it was generated |
| `trigger` | `first_time` / `background_stale` / `forced` |
| `questions_answered_at_generation` | Snapshot of total answer count at generation time |
| `is_current` | True for the active insight |

**Stale threshold:** `INSIGHT_STALE_AFTER_N_ANSWERS = 10`. After 10 new answers, the insight is considered stale and regenerated in the background on next request.

#### `fsrs_cards`
FSRS spaced repetition state per student per MCQ question. One row per `(student_id, question_id)` pair. Created on first answer, updated on every subsequent answer.

| Column | Notes |
|---|---|
| `stability` | FSRS memory half-life in days. Higher = better retained |
| `difficulty` | FSRS difficulty 0-1. Higher = harder to learn |
| `due_date` | Next scheduled review time |
| `last_review_date` | When last reviewed |
| `state` | 0=New / 1=Learning / 2=Review / 3=Relearning |
| `reps` | Total successful review count |
| `lapses` | Times the card was forgotten (Again rating) |
| `elapsed_days` | Days since last review |
| `scheduled_days` | How many days were scheduled for this interval |

---

## 6. Backend — All API Routers

All routers are registered in `main.py`. Base paths below are absolute.

### `/auth` — Authentication
- `POST /auth/signup` — create account. Rate limited 10/min. Checks IP for duplicate accounts.
- `POST /auth/login` — email/password login. Returns JWT. Rate limited 10/min. Rehashes password if bcrypt cost factor changed.
- `GET /auth/me` — returns current user from JWT
- `POST /auth/onboarding` — saves name, university, college, year_of_study
- `POST /auth/telegram` — validates Telegram WebApp `initData` (official HMAC algorithm), auto-creates user if new, returns JWT. Rate limited 20/min.

### `/bot` — Telegram Bot Endpoints
- `POST /bot/upload-temp` — bot uploads a PDF here, gets a one-time token back. Validates bot secret header. Validates PDF magic bytes. Max 50MB. Token expires in 1 hour.
- `GET /bot/temp/{token}` — Mini App fetches the pre-uploaded PDF using the token. Returns FileResponse.

### `/api/v1/performance` — Performance Tracking & AI
The largest router. All endpoints require JWT auth.

- `POST /sessions/start` — create a new quiz session
- `POST /sessions/{id}/answer` — submit one answer. Does: server-side validation, FSRS update, weak_point update, co-failure detection, dangerous misconception flagging, timeline logging, weekly quiz trigger check
- `POST /sessions/{id}/complete` — close a session. Computes readiness score, topic snapshots, 7-day trends. Invalidates current AI insight.
- `POST /sessions/record-quiz` — lightweight endpoint for the simple quiz page (no per-question tracking)
- `GET /next-session` — returns all FSRS cards due today, grouped by topic, sorted by priority (critical/high/normal)
- `GET /study-schedule` — per-topic retention % using FSRS forgetting curve
- `GET /students/me/weak-points` — all flagged weak topics with 7-day trends
- `GET /students/me/readiness` — readiness score from last 14 days of attempts
- `GET /students/me/next-action` — AI-powered next best action (runs Analyzer → Humanizer pipeline). Falls back to rule-based if AI fails.
- `GET /students/me/history` — paginated session history
- `GET /students/me/ai-insight` — AI insight report. Stale-while-revalidate: returns cached immediately, regenerates in background if stale. Force refresh with `?force=true`
- `GET /questions/{document_id}` — all MCQ IDs + text for a document
- `POST /questions/save` — save AI-generated MCQs to DB. Deduplicates by question text.
- `GET /weekly-quiz/pending` — current week's weak-topic quiz assignment
- `POST /weekly-quiz/{id}/dismiss` — dismiss the assignment
- `GET /sessions/{id}/next-question` — adaptive next question selection (scores by weak topic, dangerous misconception, co-failure, difficulty type)
- `POST /students/me/chat` — AI coach chat. Multi-turn. Handles premium/free routing. Saves personal memories. Attaches real practice questions to topic_focus.
- `POST /students/me/exam-date` — set upcoming exam date. Stored in LearningPattern. Invalidates insight.

### `/api/v1/coach` — Coach Conversations
- `GET /conversations` — list all conversation threads
- `POST /conversations` — create new empty conversation
- `GET /conversations/{id}` — get conversation with all messages
- `DELETE /conversations/{id}` — delete conversation
- `POST /conversations/{id}/messages` — send a message, get AI reply. Handles premium/free routing, credits, memory saving.
- `GET /search?q=` — search conversations by title or message content
- `POST /practice/generate` — generate fresh MCQs for a topic. Never reuses stored questions — always generates new ones from AI.

### `/api/v1/ai_tools` — Personal Memory
- `GET /memories` — get all personal memories for current user
- `POST /memories` — save a memory (key, label, value, type, importance)
- `DELETE /memories/{key}` — delete a specific memory by key

### `/analytics` — Analytics
Analytics endpoints for the analytics dashboard page.

### `/billing` — Payments
- `GET /billing/entitlements` — current user's full entitlements snapshot
- `GET /billing/config` — public pricing info (credit prices, Stripe price IDs)
- `POST /billing/extra-usage/toggle` — toggle credit spending on/off
- `POST /billing/checkout-session` — create Stripe Checkout for credits
- `POST /billing/subscribe` — create Stripe Checkout for subscription
- `POST /billing/cancel-subscription` — schedule subscription cancellation at period end
- `POST /billing/webhook` — Stripe webhook (handles: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed)
- `POST /billing/wayl-checkout` — create Wayl payment link (IQD)
- `POST /billing/wayl-verify/{reference_id}` — manually claim Wayl credits after payment
- `POST /billing/wayl-sync` — fetch all complete Wayl payments and credit any unprocessed ones
- `POST /billing/wayl-webhook` — Wayl webhook (re-verifies payment with Wayl API before crediting)

### `/admin` — Admin
Admin-only endpoints (requires `is_admin=1`).

### `/content` — Dynamic Site Content
Read/write endpoints for the CMS-style content system.

---

## 7. AI System

### MCQ Generation Pipeline (`services/generator.py`)

The generation flow:

1. PDF is loaded and chunked. `CHUNK_SIZE = 8000` chars, `CHUNK_OVERLAP` for context. `MAX_CHUNKS` limits total processing.
2. Chunks are processed in parallel using `asyncio.gather`.
3. Each chunk calls `_call_single_chunk` → posts to OpenRouter/Groq with the appropriate prompt for the mode.
4. Failed chunks are retried once. Partial JSON is salvaged with `_salvage_partial_json`.
5. All chunk results are merged with `_merge_chunk_results` and deduplicated.
6. `_validate_and_filter_mcqs` runs quality filters:
   - Removes questions with forbidden option patterns
   - Removes duplicate option text within a question
   - Checks answer letter matches the options
   - Removes trivial questions (too short, just "True/False")
   - Fixes option prefix formatting
   - Checks for known factual errors
   - Deduplicates by question stem
   - Warns if answer distribution is too uneven
7. Saved to `mcq_questions` table via `POST /questions/save`

**Models used for generation:**
- Free tier: `llama-3.3-70b-versatile` on Groq
- Premium tier: `gemini-2.5-flash` via Google AI Studio or OpenRouter

**Rate limit protection:** Free users wait `FREE_INTER_CHUNK_WAIT_SECONDS` (60s) between chunks. Premium users wait 20s.

**API key rotation:** Multiple Groq keys can be set via `AI_API_KEYS`. They are rotated when a 429 is hit.

### Generation Modes
Four modes, each with a different system+user prompt pair in `services/prompts.py`:
- `highyield` — most tested concepts, high-yield exam focus
- `exam` — broad coverage
- `revision` — quick recall cards
- `harder` — explicitly harder questions (application, analysis)

### AI Coach Pipeline (`api/performance.py`)

**2-stage pipeline for next-action recommendations:**

**Stage 1 — Analyzer** (`_run_analyzer`):
- Model: `ANALYZER_MODEL` (`gpt-oss-120b`)
- Temperature: 0.1 (very deterministic)
- Input: weak topics, confirmed weak list, dangerous misconceptions, co-failure pairs, early data topics, overconfidence rate
- Output: structured JSON decision: `{primary_topic, secondary_topic, reason_type, intervention, question_count, target_accuracy, urgency, behavior_issue, confidence_level}`
- Priority rules: dangerous misconceptions > confirmed weak (≥3 attempts, <60%) > co-failures > early signal

**Stage 2 — Humanizer** (`_run_humanizer`):
- Model: `HUMANIZER_MODEL` (`llama-3.3-70b-versatile`)
- Temperature: 0.7 (more natural)
- Input: Analyzer's decision + overconfidence rate
- Output: natural coaching message: `{response, next_step, reason, urgency, confidence_tip}`

**Fallback:** If either stage fails, `_build_next_best_action` runs the same logic in pure Python without AI.

### AI Chat System (`_call_ai_for_chat`)

The coach chat uses a single large prompt that encodes 3 roles:

1. **Friend mode** — casual, short replies, emotional support
2. **Teacher mode** — triggered by "explain", "teach me", wrong answers, confusion
3. **Coach mode** — always active, tracks weak areas, suggests next actions. Disabled during emotional state.

**Learning loop** (studying state only):
- TEACH → explain concept in 4-6 lines
- TEST → ask 1-3 MCQs, populate `mcq_questions` array in response
- ADAPT → evaluate student's answer, re-teach if wrong
- REPEAT

**Emotional state detection:** When the model detects emotional language, it locks into Friend mode and completely disables all coaching, metrics, and study prompts.

**Model routing:**
- Free users: Groq `llama-3.3-70b-versatile`, 25s timeout
- Premium (toggle OFF): still uses free model, no credits spent
- Premium (toggle ON, pro/enterprise plan): uses Gemini 2.5 Flash, 120s timeout
- Premium (toggle ON, free + credits): spends 1 credit, uses Gemini

**Retry:** On 503 from API, waits 2s and retries once.

**Response JSON structure** (what the AI returns):
```json
{
  "response": "the chat message",
  "action": "review_topic|practice_questions|...",
  "topic_focus": "exact topic name or null",
  "next_step": "one coaching suggestion",
  "question_count": 10,
  "why_this_matters": "why this topic matters",
  "session_prediction": "2-3 focused sessions",
  "calibration_pulse": "overconfidence warning or null",
  "check_in": "return-from-gap message or null",
  "confidence_tip": "calibration tip or null",
  "urgency": "low|medium|high|critical",
  "encouraging_note": "honest encouragement or null",
  "loop_phase": "teach|test|adapt|null",
  "mcq_questions": [...],
  "save_memory": {...} or null
}
```

### AI Insight System (`_call_ai_for_insight` / `get_ai_insight`)

Generates a full student insight report using Groq with a detailed system prompt. The report JSON contains:
- `next_topic_to_study` — single most important topic
- `intervention_type` — how to study it
- `personalized_message` — one sentence for the student
- `predicted_readiness_7d` — float 0-100
- `critical_insight` — pattern they likely haven't noticed
- `daily_plan` — 3-day study plan with specific topics and question counts
- `behavioral_warning` — overconfidence warning if applicable
- `strongest_topic` — what they're genuinely good at
- `decay_alert` — most overdue topic
- `urgency_level` — `routine` / `elevated` / `critical`

**Stale-while-revalidate:** On request, if the insight is stale (10+ new answers since generation), the cached version is returned immediately and regeneration fires in a background task using a fresh DB session. This means the student always gets an instant response.

---

## 8. Spaced Repetition (FSRS)

CortexQ uses the **FSRS v5** algorithm via the `fsrs` Python library (`py-fsrs`).

### How it works
FSRS tracks memory stability (half-life in days) and difficulty per card. After each review, the algorithm computes:
- How many days until the next review (interval)
- Updated stability and difficulty values
- Card state (New → Learning → Review → Relearning)

### Rating mapping
When a student answers an MCQ:
- Correct + pre-answer confidence = 3 (certain) → `Rating.Easy`
- Correct + any other confidence → `Rating.Good`
- Wrong → `Rating.Again`

There is no `Rating.Hard` mapping in the current MCQ flow (Hard is reserved for the future flashcard system).

### Forgetting curve
The FSRS v5 retention formula used in `get_study_schedule` and `_fsrs_retention`:
```python
_FSRS_DECAY = -0.5
_FSRS_FACTOR = 0.9 ** (1.0 / _FSRS_DECAY) - 1  # ≈ 0.2346
retention = (1.0 + _FSRS_FACTOR * elapsed_days / stability) ** _FSRS_DECAY
```

### Due card priority in `get_next_session`
Cards are grouped by topic and prioritised:
- **Critical** — lapses >= 2
- **High** — lapses >= 1 OR overdue >= 3 days
- **Normal** — everything else

Topics are sorted critical first, then by due count descending.

### Graceful degradation
Every FSRS call is wrapped in try/except. If `py-fsrs` is not installed or throws, the error is logged and the answer submission continues without FSRS update.

---

## 9. Performance & Adaptive Learning Engine

### Adaptive Question Selection (`get_next_question`)

When a performance session requests the next question, questions are scored:
- `dangerous_misconception` topic: **+15** (highest priority — must correct)
- `weak_topic` (flagged): **+10**
- `co_failure_topic`: **+5**
- `analysis` difficulty_type: **+2**
- `application` difficulty_type: **+1**
- Random noise: `+uniform(0, 0.5)` to prevent deterministic ordering

The question with the highest score is returned, along with a `reason` field telling the frontend why this question was selected.

### Co-Failure Detection

Runs on every answer submission. When a topic becomes **newly flagged** as weak:
1. Find all other topics currently flagged weak for this student
2. For each pair `(topic_a, topic_b)` where `a < b` alphabetically:
   - If row exists in `topic_co_failures`: increment `co_failure_count`
   - If not: create with `co_failure_count = 1`

In `get_next_question`, co-failure topics are loaded (count >= 2) and used in scoring.

### Dangerous Misconception Detection

`calibration_gap == -2` means: pre-answer confidence was 3 (certain) AND the answer was wrong. This is the most dangerous learning state — the student confidently believes wrong information.

When detected:
1. `weak_point.dangerous_misconception = True` for this topic
2. That topic gets +15 priority in question selection
3. The AI insight system must set `intervention_type = "misconception_correction"`
4. The AI chat system treats it with the highest urgency

### Readiness Score

Computed on session completion:
```
base_score = (correct / total) * 100
penalty = weak_topics_with_accuracy_below_50% * 2
readiness = max(0, min(100, base_score - penalty))
```

The rolling readiness used in `get_readiness` uses the last 14 days of attempts.

### Student Context (`_build_student_context`)

Built from scratch on every AI call. Contains:
- `total_questions_answered`
- `weak_topics` — all topics with full stats
- `co_failure_pairs` — pairs with count >= 2
- `recent_sessions` — last 5 completed sessions with lecture title, mode, accuracy, duration, device, rushes
- `calibration` — dangerous overconfidence count/rate, underconfidence count/rate
- `cognitive_profile` — from LearningPattern if it exists
- `personal_memories` — from PersonalMemory table

---

## 10. AI Coach System

### Two entry points

1. **`POST /api/v1/performance/students/me/chat`** — legacy, used by the floating coach widget. Calls `_call_ai_for_chat` directly.
2. **`POST /api/v1/coach/conversations/{id}/messages`** — full conversation management. Creates/updates CoachConversation and CoachMessage rows. Also calls `_call_ai_for_chat` but passes full conversation history.

### Field Awareness

The coach detects what academic field the student is studying based on keyword matching in their messages. Keywords are defined for 11 fields: medicine, law, engineering, computer, pharmacy, nursing, dentistry, business, science, arts, education.

The primary field is stored in personal memory. Secondary fields are tracked when a secondary threshold of 3 questions is reached.

Depth rules:
- Primary field: full depth, domain-specific methods
- Secondary fields: medium depth
- All other fields: 1-3 sentences max, never refuses

### Personal Memory System

The AI can save facts about a student via `save_memory` in its response JSON. The `tool_save_memory` function in `ai_tools.py` persists this to the `personal_memories` table.

Memory types: `identity` / `goal` / `context` / `behavior` / `emotional`

Memory importance scale:
- 0.9-1.0: core identity / major goals (name, exam date, degree)
- 0.7-0.89: clear preferences
- 0.4-0.69: temporary context
- 0.1-0.39: weak signals

Memories with importance < 0.3 are excluded from the context sent to the AI.

---

## 11. Billing & Payments

### Credit System

Credits are the pay-as-you-go currency. 1 credit = $1.00 (USD) or 250 IQD.

Internal unit conversion: the system uses internal units where 2 internal units = 1 credit. So:
- MCQ generation costs 6 internal units = 3 credits
- Coach message costs 1 internal unit = 0.5 credits

### Stripe Flow

1. User calls `POST /billing/checkout-session` with credit count
2. Backend creates a Stripe Checkout session with `mode="payment"`
3. User is redirected to Stripe's hosted checkout page
4. On success, Stripe fires `checkout.session.completed` webhook
5. Backend verifies signature, checks idempotency (CheckoutPayment table), credits user, upgrades plan to `pro` if was `free`

### Stripe Subscription Flow

1. User calls `POST /billing/subscribe` with a Stripe Price ID
2. Stripe Checkout session with `mode="subscription"`
3. After payment: `customer.subscription.created` webhook fires
4. Backend upserts Subscription row, sets `user.plan = "pro"`
5. On renewal: `invoice.paid` fires, backend re-fetches subscription and updates `current_period_end`
6. On cancellation: `customer.subscription.deleted` fires, `user.plan = "free"`
7. Scheduled cancellation: `POST /billing/cancel-subscription` sets `cancel_at_period_end=True` on Stripe

### Wayl Flow (Iraqi IQD)

1. User calls `POST /billing/wayl-checkout`
2. Backend creates a Wayl payment link via Wayl API
3. Link includes `customParameter: "{user_id}:{credits}"` for verification
4. User pays via ZainCash / FIB / FastPay / Visa / Mastercard on Wayl's page
5. Two ways credits land:
   - **Webhook**: Wayl calls `POST /billing/wayl-webhook`. Backend re-fetches the link from Wayl API to verify before crediting (never trusts webhook payload alone).
   - **Manual verify**: `POST /billing/wayl-verify/{reference_id}`. User calls this after paying if webhook fails (useful in development).
   - **Sync**: `POST /billing/wayl-sync` fetches all Complete links and credits any unprocessed ones.

### Extra Usage Toggle

Users can toggle credit spending on/off via `POST /billing/extra-usage/toggle`.
- Toggle OFF: user stays on free model, no credits spent even if they have credits
- Toggle ON + credits: use premium model, spend credits

### Credit Spend Logic (`entitlements.py`)

`try_spend_credits(db, user, amount)`:
- Pro/Enterprise: returns True immediately, charges nothing (plan covers it)
- Toggle OFF: returns True immediately, charges nothing (free mode)
- Free + credits: atomic SQL UPDATE that decrements only if balance >= amount. Returns True if successful.
- If balance hits 0 and plan was `pro`, downgrades to `free`

`refund_credits(db, user, amount)`: reverses a credit spend (called on AI call failure).

---

## 12. Entitlements & Plans

Three tiers: `free` < `pro` < `enterprise`

### Limits by plan

| Limit | Free | Pro | Enterprise |
|---|---|---|---|
| PDF uploads/month | 10 | 100 | 9999 (unlimited) |
| Coach messages/month | 300 | 9999 (unlimited) | 9999 |
| Daily token budget | 8,000 | 600,000 | 0 (unlimited) |
| MCQ model | llama-3.3-70b (Groq) | gemini-2.5-flash | gemini-2.5-flash |
| Coach model | llama-3.3-70b (Groq) | gemini-2.5-flash | gemini-2.5-flash |

### Capability flags (all False for free, True for pro/enterprise)
- `has_coach_memory` — AI remembers facts across conversations
- `has_analytics` — access to analytics dashboard
- `has_exam_simulator` — exam simulation mode
- `has_cross_doc_query` — query across multiple documents
- `has_spaced_repetition` — FSRS review system
- `has_export` — export results
- `has_priority_queue` — priority question queue

### Global token guard
A hard daily cap across ALL users combined. Default: 50 million tokens/day. When hit, all AI calls fail with 429. This is a failsafe against a single runaway user or bug exhausting the API quota.

If `REDIS_URL` is set, the counter uses Redis for fast atomic increments. Otherwise it uses a DB query (slower but works).

---

## 13. Telegram Bot & Mini App

### Bot (`bot/bot.py`) — aiogram 3

**Commands/Handlers:**
- `/start` — sends welcome message with a "Open CortexQ" button (WebApp type, opens MINI_APP_URL)
- PDF document received → downloads from Telegram → uploads to `/api/bot/upload-temp` with `X-Bot-Secret` header → gets token → sends "Generate MCQs" button with `?tg_file={token}` deep link
- Text message from OWNER_ID containing a t.me/ link → calls `join_and_add_bot`

**PDF flow:**
1. Bot receives PDF file
2. Downloads from Telegram servers
3. POSTs to `{BACKEND_URL}/api/bot/upload-temp` with the PDF bytes
4. If success: creates deep link `{MINI_APP_URL}?tg_file={token}`
5. If failure: falls back to plain Mini App URL without pre-loading
6. Sends reply with inline keyboard button (WebApp type)

**The Mini App:** When the user taps the button in Telegram, it opens the frontend URL as a Telegram Mini App. The `?tg_file=TOKEN` parameter tells the upload page to fetch the PDF from `/api/bot/temp/{token}` and pre-load it.

**Telegram Auth:** When the Mini App loads, it calls `POST /auth/telegram` with `initData` from `window.Telegram.WebApp.initData`. The backend validates this using the official HMAC-SHA256 algorithm, creates a user account if new (synthetic email `tg_{id}@telegram.local`), and returns a JWT. From that point, the Mini App behaves like a normal web session.

### Userbot (`bot/joiner.py`) — Telethon

A separate userbot (your personal Telegram account) that can:
1. Join a group/channel via invite link (private `t.me/+HASH` or public `t.me/username`)
2. Promote the CortexQ bot to admin with specific rights (post, edit, delete, invite, pin — but not add_admins or ban_users)
3. Leave the group

This is triggered by sending a t.me/ link to the bot as the owner. Use case: when a university group chat is found, you join it via the userbot, add the bot as admin, then leave — the bot can then post in the group and receive PDFs forwarded from it.

Session file stored at `bot/owner.session` (Telethon session).

---

## 14. Frontend — All Pages

Built with **Next.js 14 App Router**, TypeScript, Tailwind CSS.

| Route | Description |
|---|---|
| `/` | Landing page |
| `/auth` | Login / Register page |
| `/upload` | PDF upload page. Handles `?tg_file=TOKEN` from Telegram bot (fetches pre-uploaded PDF and auto-fills upload form) |
| `/lectures` | List of all uploaded lectures |
| `/quiz/[id]` | Simple MCQ quiz for a lecture. Uses legacy quiz flow (no per-question performance tracking) |
| `/quiz/solved/[id]` | Results page for the simple quiz |
| `/essay-quiz/[id]` | Essay question mode for a lecture |
| `/results/[id]` | Full results page (MCQs, essays, summary, key concepts) |
| `/coach` | Coach home — list of all conversations |
| `/coach/[id]` | Individual coach conversation with full chat UI |
| `/coach/practice/mcqs/[id]` | Performance-tracked MCQ practice mode (uses `/api/v1/performance/*` endpoints) |
| `/coach/practice/essay/[id]` | Performance-tracked essay practice mode |
| `/dashboard` | Main student dashboard — readiness score, weak points, study schedule, due cards |
| `/analytics` | Performance analytics — accuracy over time, weak topics, confidence calibration, study heatmap |
| `/billing` | Subscription management — plan status, credit balance, buy credits, subscribe, cancel |
| `/account` | Profile settings — name, university, college, year |
| `/admin` | Admin panel (requires is_admin=1) |
| `/about` | About page |
| `/shared/[token]` | Public share page — view someone's MCQs without logging in |
| `/shared/[token]/quiz` | Take the shared quiz without logging in |
| `/solved-shared` | Results for a completed shared quiz |
| `/api/content/[key]/route.ts` | Next.js API route for dynamic site content |
| `/auth-redirect.tsx` | Handles Telegram auth redirect |

---

## 15. Auth System

### Standard JWT flow
1. Signup: `POST /auth/signup` → bcrypt hash password → save user → return user object
2. Login: `POST /auth/login` → verify bcrypt → create JWT with `{sub: user_id, is_admin: bool}` → return token
3. Protected endpoints: `Authorization: Bearer {token}` header → `get_current_user` dependency decodes JWT → returns User

JWT expiry: 24 hours (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`).

Password hashing: bcrypt. If the hash needs rehash (cost factor changed), it is rehashed on next login.

### Telegram JWT flow
1. Mini App loads → `window.Telegram.WebApp.initData` available
2. Frontend sends initData to `POST /auth/telegram`
3. Backend validates HMAC: `HMAC-SHA256(HMAC-SHA256("WebAppData", bot_token), data_check_string)`
4. Checks timestamp: must be within 5 minutes (prevents replay attacks)
5. Parses user object from initData
6. Creates or finds user with email `tg_{telegram_id}@telegram.local`
7. Returns JWT — from here, same flow as standard auth

---

## 16. Security

- **JWT:** HS256, 24h expiry, validated on every protected endpoint
- **bcrypt:** password hashing, rehash on cost factor change
- **Bot secret:** `X-Bot-Secret` header on all `/api/bot/*` endpoints. Constant-time comparison via `hmac.compare_digest`
- **Telegram initData:** official HMAC-SHA256 validation, 5-minute replay protection
- **Stripe webhooks:** signature verification via `stripe.Webhook.construct_event`
- **Wayl webhooks:** re-fetches payment from Wayl API before crediting (never trusts webhook payload alone)
- **Security headers middleware:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- **CORS:** explicit origin whitelist from `CORS_ORIGINS` env var
- **IP-based signup abuse prevention:** tracks `signup_ip`, no bonus credits for duplicate IPs
- **Rate limiting:** slowapi on all auth and payment endpoints
- **Answer validation:** server always validates the correct answer from DB. Client-provided `correct_answer` field is ignored.
- **SECRET_KEY validation:** app hard-exits at startup if weak key in production environment

---

## 17. Rate Limiting

Uses slowapi (wraps limits.io). The limiter instance is in `core/limiter.py`.

| Endpoint | Limit |
|---|---|
| `POST /auth/signup` | 10/minute |
| `POST /auth/login` | 10/minute |
| `POST /auth/telegram` | 20/minute |
| `POST /billing/checkout-session` | 20/minute |
| `POST /billing/subscribe` | 10/minute |
| `POST /billing/cancel-subscription` | (not explicitly limited) |
| `POST /billing/wayl-checkout` | 20/minute |
| `POST /billing/wayl-verify/{id}` | 10/minute |
| `POST /billing/wayl-sync` | 5/minute |

---

## 18. Docker & Deployment

Three services in `docker-compose.yml`:

### `backend`
- Build from `./backend/Dockerfile`
- Port: 8000 → 8000
- Volumes: `./backend/uploads:/app/uploads`, `./backend/db:/app/db`
- Key env vars: `SECRET_KEY`, `AI_API_KEY`, `DATABASE_URL=sqlite:////app/db/students.db`

### `bot`
- Build from `./bot/Dockerfile`
- Always restarts on failure
- `BACKEND_URL` is hardcoded to `http://84.235.244.210:8000/` (should use service name `http://backend:8000/` in compose network — this is a known issue)
- Depends on backend

### `frontend`
- Build from `./frontend/Dockerfile` with `BACKEND_URL` build arg
- Port: 3000 → 3000
- `BACKEND_URL` also hardcoded to `http://84.235.244.210:8000/`
- Depends on backend

### DB Migrations
No Alembic is used at runtime. Instead, `main.py` runs raw `ALTER TABLE` statements on startup for each column addition. These are wrapped in try/except to ignore "column already exists" errors. This is safe but fragile — adding a new column requires adding a new ALTER TABLE line in main.py.

### Cloudflare Tunnel
Traffic to `themcq.xyz` goes through a Cloudflare Tunnel to the VPS. The tunnel runs as a `cloudflared` service. Config at `~/.cloudflared/config.yml`. Tunnel ID: `32460acc-9389-45b9-b5c9-88b6a7ea5957`.

---

## 19. Known Gaps & Missing Pieces

These are real gaps found by reading the codebase — not speculation:

1. **`LearningPattern` write path is missing.** The model is read by `_build_student_context` and used in AI coaching, but there is no background job or endpoint that actually computes and writes `avg_sessions_per_week`, `preferred_time_of_day`, `overconfidence_rate`, etc. These fields are always null unless manually set.

2. **Bot uses hardcoded VPS IP instead of Docker service name.** `docker-compose.yml` sets `BACKEND_URL=http://84.235.244.210:8000/`. Inside Docker's network, this should be `http://backend:8000`. If the VPS IP changes, the bot breaks.

3. **Frontend `?tg_file=TOKEN` handling** — the upload page is listed in the router, but whether it actually reads the `tg_file` query parameter and fetches the PDF from `/api/bot/temp/{token}` depends on the frontend implementation. Not verified from this read.

4. **No push notifications for FSRS due cards.** The `get_next_session` endpoint exposes due cards, but there is no scheduled job to notify students when cards are due.

5. **`discrimination_index` on `McqQuestion`** is never computed. The column exists but nothing writes to it.

6. **`device_type`, `interruptions`, `longest_pause_seconds`, `questions_skipped`** on PerformanceSession are defined but never written to by the backend (would need to come from the frontend).

7. **`LearningPattern.behavioral_flags`** is a comma-separated text field that is read by `_build_student_context` but never written to by any automated system.

8. **Alembic is installed** (`alembic.ini` and `alembic/` directory exist) but the live system uses manual ALTER TABLE statements in `main.py` instead. The two migration systems are not in sync.

9. **`content.py` router** exists but its exact endpoints and use in the frontend are not fully documented here — would need a separate read.

10. **Analytics router** (`api/analytics.py`) is registered but its exact endpoints are not documented here.
