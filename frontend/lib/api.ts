import axios from "axios";
import { getToken, removeToken, saveToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000, // 15 s — prevents requests from hanging forever if backend is unreachable
});

// Attach token automatically, but don't override an explicitly-provided Authorization header.
api.interceptors.request.use((config) => {
  if (!config.headers.Authorization) {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// On every response, rotate the JWT if a new one was issued (session binding).
// Redirect to /auth on any 401 (expired or invalid token).
let _redirectingTo401 = false;
api.interceptors.response.use(
  (response) => {
    const newJwt = response.headers["x-new-jwt"];
    if (newJwt && typeof newJwt === "string") {
      saveToken(newJwt);
    }
    return response;
  },
  (error) => {
    if (typeof window !== "undefined" && error?.response?.status === 401) {
      if (!_redirectingTo401) {
        _redirectingTo401 = true;
        console.warn("Received 401 — clearing token and redirecting to /auth");
        removeToken();
        window.location.replace("/auth");
        setTimeout(() => { _redirectingTo401 = false; }, 5000);
      }
    }
    return Promise.reject(error);
  }
);

export type Difficulty = "revision" | "exam" | "harder" | "essay";

export interface CustomContext {
  exam_type: string;
  time_to_exam: string;
  prior_knowledge: string;
  difficulty: string;
  mcq_count: number;
  weak_topics: string;
  model?: string;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface UserOut {
  id: string;
  email: string;
  name: string | null;
  university: string | null;
  college: string | null;
  year_of_study: number | null;
  subject: string | null;
  topic_area: string | null;
  credit_balance: number;
  plan: "free" | "pro" | "enterprise";
  is_admin: boolean;
  created_at: string;
  profile_picture: string | null;
}

export interface TokenOut {
  access_token: string;
  token_type: string;
  is_new_user?: boolean;
}

export interface LectureOut {
  id: number;
  user_id: string;
  title: string;
  file_path: string;
  created_at: string;
  is_processed?: boolean;
  has_essays?: boolean;
  pending_job_id?: string | null;
  generation_started_at?: string | null;
}

export interface McqItem {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: string;
  explanation: string;
}

export interface ResultOut {
  id: number;
  lecture_id: number;
  summary: string | null;
  key_concepts: string[];
  mcqs: McqItem[];
  created_at: string;
  share_token: string | null;
  view_count: number;
}

export interface SharedResultOut {
  lecture_id: number;
  lecture_title: string;
  summary: string | null;
  key_concepts: string[];
  mcqs: McqItem[];
  view_count: number;
}

export interface QuizSessionOut {
  answers: Record<string, string>;
  retake_count: number;
}

export interface ViewersOut {
  view_count: number;
  active_viewers: number;
  share_token: string | null;
}

// Auth (passwordless)
export const checkEmail = (email: string) =>
  api.get<{ exists: boolean }>("/auth/check-email", { params: { email } });

export const requestMagicLink = (email: string) =>
  api.post<{ message: string; email: string }>("/auth/request-link", { email });

export const verifyCode = (email: string, code: string) =>
  api.post<TokenOut>("/auth/verify-code", { email, code });

export const getMe = () => api.get<UserOut>("/auth/me");

export const deleteMe = () => api.delete("/auth/me");

export interface BillingConfig {
  credit_price_cents: number;
  currency: string;
  credit_price_iqd: number;
}

export const getBillingConfig = () => api.get<BillingConfig>("/billing/config");

export const createWaylCheckoutSession = (credits: number) =>
  api.post<{ checkout_url: string; reference_id: string }>("/billing/wayl-checkout", { credits });

export const verifyWaylPayment = (referenceId: string) =>
  api.post<{ detail: string; credit_balance: number }>(`/billing/wayl-verify/${referenceId}`);

export const syncWaylPayments = () =>
  api.post<{ payments_found: number; credits_added: number; credit_balance: number }>("/billing/wayl-sync");

export interface Entitlements {
  plan: "free" | "pro" | "enterprise";
  premium: boolean;
  credit_balance: number;
  uploads_this_month: number;
  uploads_limit: number;
  coach_messages_this_month: number;
  coach_messages_limit: number;
  free_ai_model: string;
  premium_ai_model: string;
  credit_cost_mcq_process: number;
  credit_cost_coach_message: number;
  extra_usage_enabled: boolean;
  monthly_credit_limit: number | null;
  monthly_credits_used: number;
}

export const getEntitlements = () =>
  api.get<Entitlements>("/billing/entitlements", { params: { _t: Date.now() } });

export const toggleExtraUsage = () =>
  api.post<{ extra_usage_enabled: boolean }>("/billing/extra-usage/toggle");

export const setMonthlyLimit = (limit: number | null) =>
  api.put<{ monthly_credit_limit: number | null; monthly_credits_used: number }>("/billing/monthly-limit", { limit });

export const createCheckoutSession = (credits: number) =>
  api.post<{ checkout_url: string }>("/billing/checkout-session", { credits });

export const saveOnboarding = (name: string, university: string, college: string, year_of_study: number) =>
  api.post("/auth/onboarding", { name, university, college, year_of_study });

export const updateProfile = (data: {
  name?: string;
  university?: string;
  college?: string;
  year_of_study?: number;
}) => api.put<UserOut>("/auth/profile", data);

export interface SessionOut {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

export const listSessions = () => api.get<SessionOut[]>("/auth/sessions");

export const revokeSession = (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`);

export const uploadProfilePicture = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post<UserOut>("/auth/profile/picture", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Lectures
export const uploadLecture = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/lap", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180000, // 3 minutes - sufficient for slow mobile uploads
  });
};

export const uploadText = (text: string, title: string) =>
  api.post("/lap-text", { text, title });

export const extractImageText = (imageFile: File) => {
  const form = new FormData();
  form.append("file", imageFile);
  return api.post<{ text: string }>("/extract-image-text", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getLectures = () => api.get("/lectures");
export const deleteLecture = (lectureId: number) =>
  api.delete(`/lectures/${lectureId}`);
export const getSolvedLectures = () => api.get("/lectures/solved");

export const estimateProcessing = (lectureId: number, difficulty: Difficulty = "revision") =>
  api.get(`/estimate/${lectureId}?mode=${difficulty}`);

export const processLecture = (
  lectureId: number,
  difficulty: Difficulty = "revision",
  customContext?: CustomContext,
  focus?: string,
  model?: string,
) => {
  const modeParam =
    difficulty === "essay"
      ? customContext ? "essay_custom" : "essay"
      : customContext ? "custom" : difficulty;
  const params = new URLSearchParams({ mode: modeParam });
  if (focus && focus.trim()) params.append("focus", focus.trim());

  // Merge model into customContext or create a partial object
  const body = customContext ? { ...customContext, model } : (model ? { model } : null);

  return api.post(
    `/process/${lectureId}?${params.toString()}`,
    body,
    { timeout: 600_000 },
  );
};

export const getStats = () => api.get("/stats");

// Single aggregated dashboard endpoint — replaces separate calls to /auth/me,
// /billing/entitlements, /stats, and all /analytics/* on initial page load.
export interface DashboardData {
  user: {
    id: string;
    email: string;
    name: string | null;
    university: string | null;
    college: string | null;
    year_of_study: number | null;
    credit_balance: number;
    profile_picture: string | null;
  };
  entitlements: {
    plan: string;
    premium: boolean;
    credit_balance: number;
    uploads_this_month: number;
    uploads_limit: number;
    coach_messages_this_month: number;
    coach_messages_limit: number;
    tokens_used_today: number;
    daily_token_budget: number;
    extra_usage_enabled: boolean;
    has_coach_memory: boolean;
    has_analytics: boolean;
    has_exam_simulator: boolean;
    has_cross_doc_query: boolean;
    has_spaced_repetition: boolean;
    has_export: boolean;
    has_priority_queue: boolean;
  };
  lecture_stats: {
    total_lectures: number;
    processed_lectures: number;
    total_mcqs_answered: number;
    avg_score: number;
  };
  overview: {
    overall_accuracy: number;
    total_correct: number;
    total_attempted: number;
    sessions_this_week: number;
    current_streak: number;
    weakest_topic: { topic: string; accuracy_rate: number } | null;
  };
  accuracy_timeline: {
    days: number;
    data: { date: string; correct: number; total: number; accuracy_percent: number }[];
  };
  weak_topics: {
    topics: { subtopic: string; error_count: number; decay_rate: number; decay_severity: string; accuracy_rate: number; total_attempts: number }[];
  };
  confidence_calibration: {
    data: { confidence_level: number; attempts: number; correct: number; accuracy_percent: number }[];
    danger_zone_points: number;
  };
  time_of_day: {
    data: { time_of_day: string; accuracy_rate: number; is_peak: boolean }[];
    best_time: string;
  };
  co_failures: {
    topic_pairs: { topic_a: string; topic_b: string; co_fail_count: number }[];
  };
  ai_insight: {
    data: { insight_text: string; generated_at: string; minutes_ago: number } | null;
    message: string | null;
  };
}

export const getDashboard = (timelineDays = 7) =>
  api.get<DashboardData>(`/analytics/dashboard?timeline_days=${timelineDays}`);

export const getAnalyticsOverview = () => api.get("/analytics/overview");
export const getAnalyticsTimeline = (days = 7) => api.get(`/analytics/accuracy-timeline?days=${days}`);
export const getAnalyticsWeakTopics = (limit = 10) => api.get(`/analytics/weak-topics?limit=${limit}`);
export const getAnalyticsConfidence = () => api.get("/analytics/confidence-calibration");
export const getAnalyticsCoFailures = () => api.get("/analytics/co-failures");

export const getResults = (lectureId: number) =>
  api.get(`/results/${lectureId}`);

export const createShareLink = (lectureId: number) =>
  api.post(`/results/${lectureId}/share`);

export const getActiveViewers = (lectureId: number) =>
  api.get(`/results/${lectureId}/active-viewers`);

export const getSharedResult = (token: string) =>
  api.get(`/shared/${token}`);

export const pingSharedSession = (token: string, sessionId: string) =>
  api.post(`/shared/${token}/ping`, null, { params: { session_id: sessionId } });

export const getQuizSession = (lectureId: number) =>
  api.get(`/sessions/${lectureId}`);

export const saveQuizSession = (lectureId: number, answers: Record<number, string>) =>
  api.put(`/sessions/${lectureId}`, { answers });

export const retakeQuizSession = (lectureId: number) =>
  api.post(`/sessions/${lectureId}/retake`);

export const getMySharedSessions = () =>
  api.get("/my-shared-sessions");

export const getNextBestAction = () =>
  api.get("/api/v1/performance/students/me/next-action");

export const postChatCoach = (message: string, conversationHistory?: {role: string; content: string}[]) =>
  api.post("/api/v1/performance/students/me/chat", {
    message,
    ...(conversationHistory?.length ? { conversation_history: conversationHistory } : {}),
  });

// ── Coach conversations ───────────────────────────────────────────────────────

export const coachListConversations = () =>
  api.get("/api/v1/coach/conversations");

export const coachCreateConversation = () =>
  api.post("/api/v1/coach/conversations");

export const coachGetConversation = (id: string) =>
  api.get(`/api/v1/coach/conversations/${id}`);

export const coachDeleteConversation = (id: string) =>
  api.delete(`/api/v1/coach/conversations/${id}`);

export interface QuizResult {
  topic: string;
  score: number;
  total: number;
}

export const coachSendMessage = (
  convId: string,
  message: string,
  imageData?: string,
  imageMime?: string,
  quizResult?: QuizResult,
  modelPreference?: "llama" | "gemini",
) =>
  api.post(`/api/v1/coach/conversations/${convId}/messages`, {
    message,
    ...(imageData ? { image_data: imageData, image_mime: imageMime } : {}),
    ...(quizResult ? { quiz_result: quizResult } : {}),
    ...(modelPreference ? { model_preference: modelPreference } : {}),
  });

export interface FreshMCQ {
  question: string;
  options: string[];   // ["A. ...", "B. ...", "C. ...", "D. ..."]
  answer: string;      // "A" | "B" | "C" | "D"
  explanation?: string;
  topic?: string;
  distractors?: Record<string, string>; // wrong letter → why it's wrong
}

export const coachGeneratePractice = (topic: string, count: number) =>
  api.post<{ topic: string; questions: FreshMCQ[] }>("/api/v1/coach/practice/generate", {
    topic,
    count,
  });

export const coachGeneratePracticeMCQs = (conversationId: string, topic: string, count: number) =>
  api.post<{ session_id: string; topic: string; questions: FreshMCQ[] }>(`/api/v1/coach/practice/mcqs/${conversationId}`, {
    topic,
    count,
  });

export const coachGeneratePracticeEssays = (conversationId: string, topic: string, count: number) =>
  api.post<{ session_id: string; topic: string; questions: EssayQuestion[]; summary: string; key_concepts: string[] }>(
    `/api/v1/coach/practice/essay/${conversationId}`,
    { topic, count },
  );

export const coachGenerateEssay = (topic: string, count: number) =>
  api.post<{ session_id: string; topic: string; questions: EssayQuestion[]; summary: string; key_concepts: string[] }>(
    `/api/v1/coach/practice/essay/temp`,
    { topic, count },
  );

export const coachSearch = (q: string) =>
  api.get("/api/v1/coach/search", { params: { q } });

// ── Memory (ai-tools) ─────────────────────────────────────────────────────────

export interface StudentMemory {
  key: string;
  label: string;
  value: string;
  type: "identity" | "goal" | "context" | "behavior" | "emotional";
  importance: number;
  reason: string | null;
  updated_at: string;
  last_accessed_at: string;
}

export const listMemories = () =>
  api.get<StudentMemory[]>("/api/v1/ai-tools/memory");

export const deleteMemory = (key: string) =>
  api.delete(`/api/v1/ai-tools/memory/${key}`);

// Performance tracking
export const getPerformanceQuestions = (documentId: number) =>
  api.get(`/api/v1/performance/questions/${documentId}`);

export const startPerformanceSession = (documentId: number, mode: string, totalQuestions: number) =>
  api.post("/api/v1/performance/sessions/start", {
    document_id: documentId,
    mode,
    total_questions: totalQuestions,
  });

export const submitPerformanceAnswer = (
  sessionId: string,
  questionId: string,
  selectedAnswer: string,
  correctAnswer: string,
  timeSpentSeconds: number,
  extra: {
    pre_answer_confidence: number;
    time_to_confidence: number;
    answer_changed: boolean;
    original_answer: string | null;
    time_to_first_change: number | null;
    answer_timeline: {
      time_on_option_a: number;
      time_on_option_b: number;
      time_on_option_c: number;
      time_on_option_d: number;
      second_choice: string | null;
      re_read_question: boolean;
      re_read_count: number;
    };
  }
) =>
  api.post(`/api/v1/performance/sessions/${sessionId}/answer`, {
    question_id: questionId,
    selected_answer: selectedAnswer,
    correct_answer: correctAnswer,
    time_spent_seconds: timeSpentSeconds,
    pre_answer_confidence: extra.pre_answer_confidence,
    time_to_confidence: extra.time_to_confidence,
    answer_changed: extra.answer_changed,
    original_answer: extra.original_answer,
    time_to_first_change: extra.time_to_first_change,
    answer_timeline: extra.answer_timeline,
  });

export const completePerformanceSession = (sessionId: string) =>
  api.post(`/api/v1/performance/sessions/${sessionId}/complete`);

export const savePerformanceQuestions = (documentId: number, mode: string, mcqs: unknown[]) =>
  api.post("/api/v1/performance/questions/save", { document_id: documentId, mode, mcqs });

export const recordQuizResult = (documentId: number, correct: number, total: number, startedFrom = "quiz_page") =>
  api.post("/api/v1/performance/sessions/record-quiz", {
    document_id: documentId,
    correct,
    total,
    mode: "quiz_mode",
    started_from: startedFrom,
  });

export interface DailyMission {
  goal: number;
  answered_today: number;
  correct_today: number;
  accuracy_today: number;
  streak_days: number;
  completed: boolean;
  fsrs_due_count: number;
}

export const getDailyMission = () =>
  api.get<DailyMission>("/api/v1/performance/students/me/daily-mission");

export interface DailyTestQuestion {
  id: string;
  topic: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
  difficulty_type: string;
}

export interface DailyTestData {
  topic: string;
  question_count: number;
  generated_at: string;
  date: string;
  has_questions: boolean;
  questions: DailyTestQuestion[];
  answers?: Record<string, string>;
}

export const getDailyTest = () =>
  api.get<DailyTestData>("/api/v1/performance/students/me/daily-test");

export const saveDailyTestAnswer = (answers: Record<string, string>) =>
  api.post("/api/v1/performance/students/me/daily-test/save-answer", { answers });

export interface NextSessionDueQuestion {
  id: string;
  question_text: string;
  topic: string;
  days_overdue: number;
  lapses: number;
  state: number;
}

export interface NextSessionTopic {
  topic: string;
  due_count: number;
  priority: "critical" | "high" | "normal";
  questions: NextSessionDueQuestion[];
}

export interface NextSessionResponse {
  due_count: number;
  topics: NextSessionTopic[];
}

export const getNextSession = () =>
  api.get<NextSessionResponse>("/api/v1/performance/next-session");

export interface XrayQuestion {
  id: string;
  topic: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface XrayResult {
  document_id: number;
  questions: XrayQuestion[];
  topic_count: number;
  total_questions_in_lecture: number;
}

export const getXrayQuestions = (documentId: number) =>
  api.get<XrayResult>(`/api/v1/performance/xray/${documentId}`);

// ── Essay Q types ─────────────────────────────────────────────────────────────

export interface EssayQuestion {
  question: string;
  ideal_answer: string;
  topic?: string;
  max_score: number;
  key_points?: string[];
}

export interface EssayResultOut {
  id: number;
  lecture_id: number;
  questions: EssayQuestion[];
  created_at: string;
}

export interface EssayGradeResult {
  score: number;
  feedback: string;
  key_points_covered: string[];
  key_points_missed: string[];
}

export const getEssayResults = (lectureId: number) =>
  api.get<EssayResultOut>(`/essay-results/${lectureId}`);

export const getSolved = (lectureId: number) =>
  api.get(`/solved/${lectureId}`);

export const gradeEssayAnswer = (
  lectureId: number,
  questionIndex: number,
  studentAnswer: string,
  idealAnswer: string,
) =>
  api.post<EssayGradeResult>(
    `/essay/grade`,
    { lecture_id: lectureId, question_index: questionIndex, student_answer: studentAnswer, ideal_answer: idealAnswer },
    { timeout: 60_000 },
  );

// ── Flashcards ────────────────────────────────────────────────────────────────

export interface FlashcardOut {
  id: string;
  document_id: number;
  topic: string;
  front: string;
  back: string;
  memory_tip: string | null;
  card_type: string;
  difficulty: string;
  is_starred: boolean;
  fsrs_state: number | null;
  days_overdue: number | null;
  lapses: number | null;
}

export const updateFlashcard = (id: string, data: Partial<FlashcardOut>) =>
  api.patch<FlashcardOut>(`/api/v1/flashcards/${id}`, data);

export const createManualFlashcard = (documentId: number, data: Partial<FlashcardOut>) =>
  api.post<FlashcardOut>(`/api/v1/flashcards/?document_id=${documentId}`, data);

export const deleteFlashcard = (id: string) =>
  api.delete(`/api/v1/flashcards/${id}`);

export interface DueCardsResponse {
  due_count: number;
  cards: FlashcardOut[];
}

export interface ReviewResponse {
  next_due: string;
  interval_days: number;
  state: number;
  new_stability: number | null;
}

export interface FlashcardStats {
  total_cards_seen: number;
  total_reviews: number;
  cards_due_today: number;
  cards_mastered: number;
  avg_rating: number | null;
  topic_breakdown: { topic: string; total: number; mastered: number; due: number }[];
  streak_days: number;
}

export interface FlashcardScheduleTopic {
  topic: string;
  retention_pct: number;
  due_count: number;
  next_due: string | null;
  total_cards: number;
}

export const generateFlashcards = (documentId: number, mode = "revision") =>
  api.post<{ generated_count: number; card_ids: string[] }>(
    `/api/v1/flashcards/generate/${documentId}`,
    { mode },
    { timeout: 120_000 },
  );

export const getDueFlashcards = (documentId?: number, limit = 20) =>
  api.get<DueCardsResponse>("/api/v1/flashcards/due", {
    params: { ...(documentId ? { document_id: documentId } : {}), limit },
  });

export const reviewFlashcard = (flashcardId: string, rating: number, timeSpentSeconds?: number) =>
  api.post<ReviewResponse>(`/api/v1/flashcards/${flashcardId}/review`, {
    rating,
    ...(timeSpentSeconds != null ? { time_spent_seconds: timeSpentSeconds } : {}),
  });

export const getDocumentFlashcards = (
  documentId: number,
  filters?: { topic?: string; card_type?: string; difficulty?: string },
) =>
  api.get<FlashcardOut[]>(`/api/v1/flashcards/document/${documentId}`, {
    params: filters,
  });

export const getFlashcardStats = () =>
  api.get<FlashcardStats>("/api/v1/flashcards/stats");

export const getFlashcardSchedule = () =>
  api.get<{ topics: FlashcardScheduleTopic[] }>("/api/v1/flashcards/schedule");

export const updateStudyTime = (lectureId: number, seconds: number) =>
  api.post(`/lectures/${lectureId}/study-time`, { seconds });

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminStats {
  total_users: number;
  free_users: number;
  pro_users: number;
  enterprise_users: number;
  total_credits: number;
  new_users_today: number;
  new_users_this_week: number;
}

export interface SetCreditsResponse {
  email: string;
  credit_balance: number;
}

export const getAdminStats = () => api.get<AdminStats>("/admin/stats");

export const adminSetCredits = (email: string, credits: number) =>
  api.post<SetCreditsResponse>("/admin/set-credits", { email, credits });

// ── Companion widget ──────────────────────────────────────────────────────────

export const companionAsk = (question: string, currentPage: string) =>
  api.post<{ answer: string | null; escalate: boolean; escalate_reason: string | null }>(
    "/api/v1/coach/companion/ask",
    { question, current_page: currentPage },
    { timeout: 20_000 },
  );
