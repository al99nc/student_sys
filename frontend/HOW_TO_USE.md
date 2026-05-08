# CortexQ (themcq) — How To Use Every Page

This file is the AI companion knowledge base. It documents every page of the app.

---

## Page: /dashboard

**What it does:** Your home base. Shows your readiness score, recent lectures, daily mission, study streak, and AI-recommended next action.

**How to use it:**
1. The "Next Best Action" card at the top tells you exactly what to study next — follow it
2. Click any lecture card to go to its results page and start practicing
3. "Daily Mission" shows today's focused task — complete it to maintain your streak
4. Use the filter tabs (All / Processed / Unprocessed) to find lectures by status
5. Click "Upload" (top right or the Upload card) to add a new lecture

**Common problems:**
- Page shows "Loading...": Refresh once — it usually resolves in 2-3 seconds
- No lectures showing: You haven't uploaded any yet — go to /upload first
- Readiness score is 0: Complete at least one quiz session to generate your first score

```tsx
﻿"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDashboard, getLectures, getMySharedSessions, getNextBestAction, getDailyMission, DailyMission } from "@/lib/api";
import { isAuthenticated, logout } from "@/lib/auth";
import { prefetch } from "@/lib/prefetch-cache";
import { AppHeader } from "@/components/app-header";
import { StepNav } from "@/components/step-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  BookOpen,
  TrendingUp,
  Target,
  Bot,
  ArrowRight,
  FileText,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronRight,
  BarChart3,
  Flame,
  Brain,
  Zap,
} from "lucide-react";

interface Lecture {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
  is_processed: boolean;
  has_essays: boolean;
}

interface SharedSession {
  lecture_id: number;
  lecture_title: string;
  share_token: string;
  answered: number;
  total: number;
  correct: number;
  retake_count: number;
  updated_at: string | null;
}

type Filter = "all" | "processed" | "unprocessed";


function isValid(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "none";
  }
  return true;
}

export default function DashboardPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingNextAction, setLoadingNextAction] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [stats, setStats] = useState({ total_lectures: 0, processed_lectures: 0, total_mcqs_answered: 0, avg_score: 0 });
  const [sharedSessions, setSharedSessions] = useState<SharedSession[]>([]);
  const [nextAction, setNextAction] = useState<{
    action_type?: string;
    topic?: string | null;
    next_step?: string | null;
    short_message?: string | null;
    predicted_readiness_24h?: number | null;
    reason?: string[];
  } | null>(null);
  const [userName, setUserName] = useState("Student");
  const [dailyMission, setDailyMission] = useState<DailyMission | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = () => {
    (prefetch.dashboard ?? getDashboard())
      .then((res) => {
        if (!res) return;
        if (res.data.user.name) setUserName(res.data.user.name);
        setStats(res.data.lecture_stats);
      })
      .catch(() => setError("Fa
```

---

## Page: /upload

**What it does:** Upload a PDF lecture or paste text/image to generate AI-powered MCQs and study materials.

**How to use it:**
1. Choose your input method: drag & drop a PDF, paste text, or upload an image of notes
2. Select your mode: "Study" tab = revision-focused MCQs; "Exam" tab = broader exam coverage
3. Optionally expand "Customize" to set difficulty, focus topics, or add context
4. Click "Generate" — processing takes 1–4 minutes (progress bar will appear)
5. You'll be automatically redirected to /results/[id] when done

**Common problems:**
- "Only PDF files are supported": Convert your file to PDF first
- "File exceeds the 50 MB limit": Compress the PDF or split into smaller files
- "File too small to contain useful content": Your PDF may be image-only or corrupted — try pasting text instead
- Generation seems stuck: Wait up to 4 minutes; free users have lower priority
- "Not enough text": Paste at least 100 characters of meaningful content

```tsx
﻿"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  uploadLecture,
  uploadText,
  extractImageText,
  processLecture,
  getEntitlements,
  Difficulty,
  CustomContext,
} from "@/lib/api";
import CustomizeBar from "@/components/customize-bar";
import { isAuthenticated, getToken } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CloudUpload, FileText, Loader2, CheckCircle2,
  BookOpen, Medal, Brain, Layers,
  ClipboardPaste, Image as ImageIcon,
  AlignLeft, ImagePlus, XCircle,
} from "lucide-react";

type Tab = "study" | "exam";
type Mode = "revision" | "exam" | "harder";
type InputMode = "file" | "paste";

// ── Validation types ─────────────────────────────────────────────────────────
interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// ── Validators ───────────────────────────────────────────────────────────────
function validatePDF(file: File): ValidationResult {
  if (file.type !== "application/pdf")
    return { valid: false, error: "Only PDF files are supported" };
  if (file.size < 1024)
    return { valid: false, error: "File is too small to contain useful content" };
  if (file.size > 50 * 1024 * 1024)
    return { valid: false, error: "File exceeds the 50 MB limit" };
  if (file.size > 20 * 1024 * 1024)
    return { valid: true, warning: "Large file — processing may take a few extra minutes" };
  return { valid: true };
}

function validateImage(file: File): ValidationResult {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))
    return { valid: false, error: "Only JPEG, PNG, or WebP images are supported" };
  if (file.size < 5 * 1024)
    return { valid: false, error: "Image is too small — make sure it shows the full page" };
  if (file.size > 10 * 1024 * 1024)
    return { valid: false, error: "Image exceeds the 10 MB limit" };
  return { valid: true };
}

function validateText(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return { valid: false, error: "Please paste some content first" };
  if (trimmed.length < 100)
    return { valid: false, error: `Too short — add at least ${100 - trimmed.length} more characters` };
  if (trimmed.length > 500_000)
    return { valid: false, error: "Text is too long (max 500,000 characters)" };
  // Warn if text looks like it's mostly garbage / non-words
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 2).length;
  if (wordCount < 20)
    return { valid: false, error: "Not enoug
```

---

## Page: /lectures

**What it does:** View all your uploaded lectures and their processing status. Browse, search, and jump into any lecture's MCQs.

**How to use it:**
1. "All" tab shows every lecture; "Uploaded" tab shows only your own uploads
2. Use the search bar to find a specific lecture by name
3. Click any lecture card to open its results page (/results/[id])
4. Lectures with a green checkmark are processed and ready to study
5. Lectures showing "Processing" are still being analyzed — check back in a few minutes

**Common problems:**
- Lecture shows "Unprocessed": Go to /results/[id] and click "Generate" to trigger processing
- Can't find a lecture: Use the search bar — it searches by title
- Lecture is missing: It may still be uploading — check /upload for status

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getResults, getLectures, getMe, getQuizSession, getSolvedLectures } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Sparkles,
  AlertCircle,
  Loader2,
  Search,
  ChevronRight,
  CheckCircle2,
  Clock,
} from "lucide-react";

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface LectureData {
  id: number;
  title: string;
  mcqs: MCQ[];
  answeredIndices: Set<number>;
  sessionAnswers: Record<string, any>;
  has_essays: boolean;
  source: "uploaded" | "generated";
  createdAt: string;
}

interface SolvedLecture {
  id: number;
  title: string;
  created_at: string;
  mcq_count: number;
  has_essays: boolean;
}

interface RawLecture {
  id: number;
  title: string;
  created_at: string;
  is_processed: boolean;
  has_essays: boolean;
}

type Tab = "all" | "uploaded";

export default function LecturesPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<LectureData[]>([]);
  const [solvedLectures, setSolvedLectures] = useState<SolvedLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [allUploads, setAllUploads] = useState<RawLecture[]>([]);
  const [userName, setUserName] = useState("Lecturer");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [meRes, lecturesRes, solvedRes] = await Promise.all([getMe(), getLectures(), getSolvedLectures()]);
      setUserName(meRes.data.name || "Lecturer");
      setAllUploads(lecturesRes.data);

      // Only fetch results/sessions for processed lectures — unprocessed ones
      // will never have either, so calling those endpoints just generates 404s.
      const lectureDataPromises = lecturesRes.data
        .filter((lecture: any) => lecture.is_processed)
        .map((lecture: any) =>
          Promise.all([
            getResults(lecture.id).catch((e: unknown) => {
              if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
              throw e;
            }),
            getQuizSession(lecture.id).catch((e: unknown) => {
              if ((e as { response
```

---

## Page: /quiz/[id]

**What it does:** Take an MCQ quiz for a lecture. Answer questions one by one, see explanations, and get your score at the end.

**How to use it:**
1. Questions are shown one at a time — click an answer option (A, B, C, D) to select it
2. Click "Check" to reveal whether you were right and read the explanation
3. Use the arrow buttons to move to the next question
4. At the end, you'll see your total score and a breakdown by topic
5. Click "Review" to go back and check your answers, or "Retake" to try again

**Common problems:**
- Quiz won't load: The lecture may still be processing — wait and try again
- Question count is different than expected: Some lectures have fewer MCQs; fresh/practice quizzes may have a custom count
- Timer running out: The timer is informational only — there's no penalty for taking your time

```tsx
﻿"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getResults, recordQuizResult, coachGeneratePractice, FreshMCQ } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { StepNav } from "@/components/step-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Timer,
  XCircle,
  RotateCcw,
  BookOpen,
  Bot,
  Check,
} from "lucide-react";

interface QuizMCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
  distractors?: Record<string, string>;
}

export default function QuizPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lectureId = parseInt(params.id as string);
  const fromConvId = searchParams.get("from");
  const countParam = searchParams.get("count");
  const questionLimit = countParam ? parseInt(countParam) : null;
  const freshMode = searchParams.get("fresh") === "true";
  const freshTopic = searchParams.get("topic") ?? "";
  const backHref = fromConvId ? `/coach/${fromConvId}` : `/results/${lectureId}`;

  const [questions, setQuestions] = useState<QuizMCQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<"quiz" | "result">("quiz");
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [redirectCancelled, setRedirectCancelled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }

    loadTimeoutRef.current = setTimeout(() => {
      setLoadError(true);
      setLoading(false);
    }, 12000);

    const clearLoadTimeout = () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };

    if (freshMode && freshTopic) {
      const count = questionLimit ?? 5;
      coachGeneratePractice(freshTopic, count)
        .then((res) => {
          clearLoadTimeout();
          const qs: QuizMCQ[] = (res.data.questions as FreshMCQ[]).map((q) => ({
            question: q.question,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            topic: q.topic ?? freshTopic,
            distractors: q.distractors,

```

---

## Page: /results/[id]

**What it does:** See all MCQs, the AI-generated summary, and key concepts for a lecture. Start or retake quizzes, share results, and track performance.

**How to use it:**
1. "MCQs" tab: Browse all generated questions grouped by topic
2. Click "Start Quiz" to begin an interactive quiz session
3. "Summary" tab: Read the AI-generated lecture summary
4. "Concepts" tab: See the key concepts extracted from the lecture
5. Use the share button to generate a shareable link for this lecture's MCQs
6. If the lecture hasn't been processed yet, click "Generate MCQs" to trigger processing

**Common problems:**
- "No MCQs yet": Click the "Generate" button — processing can take 1–4 minutes
- Retake button not showing: Complete at least one quiz attempt first
- Share link not working: Regenerate it using the share button

```tsx
﻿"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getResults, processLecture, createShareLink, getActiveViewers,
  getQuizSession, saveQuizSession, retakeQuizSession,
  getPerformanceQuestions, savePerformanceQuestions,
  startPerformanceSession, submitPerformanceAnswer, completePerformanceSession,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { api } from "@/lib/api";
import { StepNav } from "@/components/step-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Share2, Shuffle, RefreshCw, Check, X,
  ChevronRight, Home, BarChart3, Zap, BookOpen, Lightbulb,
  Brain, Target, TrendingUp, AlertTriangle, Calendar,
  CheckCircle2, XCircle, Cloud, CloudOff, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface Results {
  id: number;
  lecture_id: number;
  summary: string;
  key_concepts: string[];
  mcqs: MCQ[];
  created_at: string;
  share_token?: string;
  view_count?: number;
}

type Confidence = "guessed" | "unsure" | "confident";

const CONFIDENCE_TO_INT: Record<Confidence, number> = {
  guessed: 1,
  unsure: 2,
  confident: 3,
};

interface AnswerEntry {
  letter: string;
  confidence: Confidence;
}

interface LiveTimeline {
  time_on_option_a: number;
  time_on_option_b: number;
  time_on_option_c: number;
  time_on_option_d: number;
  second_choice: string | null;
  re_read_question: boolean;
  re_read_count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByTopic(mcqs: MCQ[]): Record<string, MCQ[]> {
  return mcqs.reduce((acc, mcq, idx) => {
    const topic = mcq.topic || "General";
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push({ ...mcq, _index: idx } as MCQ & { _index: number });
    return acc;
  }, {} as Record<string, MCQ[]>);
}

type ActiveTab = "mcqs" | "summary" | "concepts";

const CONFIDENCE_OPTIONS: { value: Confidence; label: string }[] = [
  { value: "guessed",   label: "Guessed"   },
  { value: "unsure",    label: "Unsure"    },
  { value: "confident", label: "Confident" },
];

const CONF_CLASS: Record<Confidence, string> = {
  guessed:   "bg-orange-400/10 border-orange-400/30 text-orange-400",
  unsure:    "bg-yellow-400/10 border-yellow-400/30 text-yellow-400",
  confident: "bg-emerald-400/10 border-emerald-400/30 text-emerald-400",
};

const LETTER_TO_OPTION: Record<string, keyof LiveTimeline> = {
  A: "time_on_option_a",
  B: "time_on_option_b",
  C: "time_on_option_c",
  D: "time_on_option_d",
};

// ─── Timer ─────────────────────────────
```

---

## Page: /coach

**What it does:** Your AI study coach. Have real conversations about your studies, get personalized study plans, generate fresh practice MCQs, and work through difficult topics interactively.

**How to use it:**
1. Click the "+" button (top of sidebar) to start a new conversation
2. Type your message and press Enter or click the send button
3. The coach remembers context within a conversation — ask follow-up questions freely
4. Use the "Practice" panel (dumbbell icon) to generate fresh MCQs or essays on any topic
5. Switch between Llama (free) and Gemini (Pro/credits) models using the model selector
6. Search past conversations using the search bar in the sidebar
7. Click any past conversation in the sidebar to continue it

**Common problems:**
- "Message limit reached": Free users get 300 messages/month; upgrade to Pro or buy credits
- Gemini model locked: Requires Pro plan or credit balance
- Response is slow: Normal for free tier — Groq/Llama can take up to 10 seconds
- Conversation list is empty: Start your first conversation with the "+" button

```tsx
﻿"use client";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import {
  coachListConversations,
  coachCreateConversation,
  coachGetConversation,
  coachDeleteConversation,
  coachSendMessage,
  coachSearch,
  getEntitlements,
  coachGeneratePracticeMCQs,
  coachGeneratePracticeEssays,
  coachGeneratePractice,
  coachGenerateEssay,
  FreshMCQ,
  EssayQuestion,
  QuizResult,
} from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import {
  Plus, Search, X, MessageSquare, Trash2, ArrowLeft,
  Menu, Bot, ArrowUp, Paperclip, Lock, CheckCircle, XCircle,
  Clock, Lightbulb, History, ArrowRight, Dumbbell,
  FileText, AlertCircle, ChevronRight, BookOpen, Sparkles, ChevronDown,
  Eye, Trophy,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface AiMeta {
  action?: string;
  topic_focus?: string | null;
  next_step?: string | null;
  question_count?: number | null;
  why_this_matters?: string | null;
  session_prediction?: string | null;
  calibration_pulse?: string | null;
  check_in?: string | null;
  confidence_tip?: string | null;
  urgency?: string;
  encouraging_note?: string | null;
  practice_document_id?: number | null;
  practice_topic?: string | null;
  practice_questions?: { id: string; document_id: number; topic: string; preview: string }[];
  mastery_progress?: { topic: string; current: number; target: number } | null;
  topic_chain?: string[] | null;
  days_since_last?: number | null;
  is_relapse?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image_data?: string | null;
  image_mime?: string | null;
  ai_metadata?: AiMeta | null;
  created_at: string;
  payg_limit?: boolean;
}

interface PracticeEntry {
  msgId: string;
  type: "mcq" | "essay";
  topic: string;
  timestamp: string;
}
type PracticeMap = Record<string, PracticeEntry[]>;

interface PracticeModalData {
  type: "mcq" | "essay";
  topic: string;
  count: number;
  questions: FreshMCQ[] | EssayQuestion[] | null;
  generating: boolean;
  error?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PRACTICE_KEY = "themcq_practice_map";

function loadPracticeMap(): PracticeMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? "{}"); }
  catch { return {}; }
}

function savePracticeMap(map: PracticeMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRACTICE_KEY, JSON.stringify(map));
}

function groupByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const today = now.
```

---

## Page: /coach/[id]

**What it does:** Opens a specific coach conversation by its ID. Same interface as /coach but loads the conversation directly.

**How to use it:**
1. This page is usually opened automatically when you click a conversation in the sidebar or are redirected from another page
2. You can continue the conversation by typing in the input box at the bottom
3. Use the back arrow to return to the conversations list

```tsx
import CoachPage from "../page";

export default function CoachConversationPage({ params }: { params: { id: string } }) {
  return <CoachPage initialConvId={params.id} />;
}

```

---

## Page: /analytics

**What it does:** Visual performance dashboard showing your accuracy trends, weak topics, confidence calibration, and study streaks over time.

**How to use it:**
1. The overview cards at the top show total sessions, questions answered, accuracy %, and streak
2. Use the "7 days / 30 days" toggle to see different time ranges
3. "Weak Topics" section shows which topics you're struggling with — focus your study there
4. "Accuracy Trend" chart shows your performance over time
5. "Confidence Calibration" shows whether you're over- or under-confident on different question types
6. "Co-Failure Topics" shows pairs of topics you tend to get wrong together — study them in combination

**Common problems:**
- Analytics shows no data: You need to have completed at least one quiz session first
- Accuracy looks low: This is normal early on — keep practicing and it will improve
- "Calibration gap" is large: This means your confidence level doesn't match your actual accuracy — use the coach to target those specific weak areas

```tsx
"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDashboard, getAnalyticsTimeline } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Target, TrendingUp, Flame, AlertTriangle } from "lucide-react";

interface Overview {
  total_sessions: number;
  total_questions_answered: number;
  overall_accuracy: number;
  current_streak: number;
}

interface TimelineDay {
  date: string;
  accuracy: number;
  questions_answered: number;
}

interface WeakTopic {
  topic: string;
  accuracy: number;
  attempts: number;
}

interface ConfidenceData {
  confidence_level: string;
  accuracy: number;
  count: number;
}

interface CoFailure {
  topic_a: string;
  topic_b: string;
  co_fail_count: number;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeline, setTimeline] = useState<TimelineDay[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [confidence, setConfidence] = useState<ConfidenceData[]>([]);
  const [coFailures, setCoFailures] = useState<CoFailure[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    getDashboard(days)
      .then(({ data }) => {
        const o = data.overview;
        setOverview({
          total_sessions: o.sessions_this_week ?? 0,
          total_questions_answered: o.total_attempted ?? 0,
          overall_accuracy: o.overall_accuracy ?? 0,
          current_streak: o.current_streak ?? 0,
        });
        setTimeline(
          (data.accuracy_timeline.data ?? []).map((d) => ({
            date: d.date,
            accuracy: d.accuracy_percent ?? 0,
            questions_answered: d.total ?? 0,
          }))
        );
        setWeakTopics(
          (data.weak_topics.topics ?? []).map((t) => ({
            topic: t.subtopic ?? "",
            accuracy: t.accuracy_rate ?? 0,
            attempts: t.total_attempts ?? 0,
          }))
        );
        setConfidence(
          (data.confidence_calibration.data ?? []).map((c) => ({
            confidence_level: String(c.confidence_level),
            accuracy: c.accuracy_percent ?? 0,
            count: c.attempts ?? 0,
          }))
        );
        setCoFailures(data.co_failures.topic_pairs ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (
```

---

## Page: /billing

**What it does:** Manage your plan, buy credits, and configure usage limits. Credits can be used to unlock extra messages or upload more lectures beyond the free tier.

**How to use it:**
1. Your current plan (Free/Pro) and credit balance are shown at the top
2. To buy credits: enter the number of credits you want and click "Buy with Card" or "Buy with Wayl" (IQD)
3. To upgrade to Pro: click the "Upgrade to Pro" button
4. Toggle "Extra Usage" to allow credit spending when your monthly limit is hit
5. Set a monthly credit limit to control spending — choose a preset or leave as "No limit"

**Common problems:**
- Payment not reflecting: Click the "Refresh" button to sync your balance
- Wayl payment not appearing: Click "Sync Wayl Payments" after completing the payment
- "Extra usage" toggle not saving: You need a positive credit balance first before enabling it
- Credits show 0 after purchase: Wait 30 seconds and click Refresh — the payment processor may take a moment

```tsx
﻿"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  createCheckoutSession,
  createWaylCheckoutSession,
  verifyWaylPayment,
  syncWaylPayments,
  getBillingConfig,
  getEntitlements,
  toggleExtraUsage,
  setMonthlyLimit,
  getMe,
  type BillingConfig,
  type Entitlements,
  type UserOut,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { StepNav } from "@/components/step-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const LIMIT_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "No limit", value: null },
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserOut | null>(null);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [credits, setCredits] = useState("10");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payingWayl, setPayingWayl] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState<"success" | "canceled" | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [togglingUsage, setTogglingUsage] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshEntitlements = useCallback(async () => {
    setRefreshing(true);
    try {
      const [meRes, entRes] = await Promise.all([getMe(), getEntitlements()]);
      setUser(meRes.data);
      setEnt(entRes.data);
    } catch {
      setError("Could not refresh balance. Please reload the page.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    const checkout = searchParams.get("checkout");
    if (checkout === "canceled") setBanner("canceled");

    (async () => {
      try {
        const waylRef = sessionStorage.getItem("wayl_ref");
        if (checkout === "success" && waylRef) {
          try {
            await verifyWaylPayment(waylRef);
          } catch (e: unknown) {
            const status = (e as { response?: { status?: number } })?.response?.status;
            if (!status || status >= 500) throw e;
          }
          sessionStorage.removeItem("wayl_ref");
        }

        const [meR
```

---

## Page: /account

**What it does:** View and edit your profile — name, university, college, year of study, and avatar. Also shows your plan and credit balance.

**How to use it:**
1. Click the pencil icon next to your name to edit it — press the checkmark to save
2. Click your avatar (or the camera icon) to upload a custom profile picture
3. Your plan status and credit balance are displayed on this page
4. Click "Log out" to sign out of your account

**Common problems:**
- Name not saving: Make sure it's not empty and try again
- Avatar not persisting after reload: Avatars are stored locally in your browser; clearing browser data removes them
- Can't change email: Email changes are not supported — contact support if needed

```tsx
﻿"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import { getMe, saveOnboarding, UserOut } from "@/lib/api";
import { StepNav } from "@/components/step-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Home, Upload, Bot, BarChart3, Camera, LogOut, Pencil, Check, X } from "lucide-react";

const AVATAR_KEY = "themcq_avatar";

export default function AccountPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    const storedAvatar = localStorage.getItem(AVATAR_KEY);
    if (storedAvatar) setAvatar(storedAvatar);

    getMe()
      .then((res) => {
        setUser(res.data);
        setNameInput(res.data.name ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatar(dataUrl);
      localStorage.setItem(AVATAR_KEY, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSaveName() {
    if (!user) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    setSavingName(true);
    setNameError("");
    try {
      await saveOnboarding(
        trimmed,
        user.university ?? "",
        user.college ?? "",
        user.year_of_study ?? 1,
      );
      setUser((prev) => prev ? { ...prev, name: trimmed } : prev);
      setEditingName(false);
    } catch {
      setNameError("Failed to save. Please try again.");
    } finally {
      setSavingName(false);
    }
  }

  function handleCancelEdit() {
    setNameInput(user?.name ?? "");
    setNameError("");
    setEditingName(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-
```

---

