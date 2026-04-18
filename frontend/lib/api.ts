import axios from "axios";
import { getToken, logout, removeToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000, // 15 s — prevents requests from hanging forever if backend is unreachable
});

// Attach token automatically
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to /auth on any 401 (expired or invalid token)
let isLoggingOut = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error?.response?.status === 401) {
      // Prevent multiple logout attempts
      if (!isLoggingOut) {
        isLoggingOut = true;
        console.warn("Received 401 - logging out");
        removeToken();
        setTimeout(() => {
          window.location.href = "/auth";
        }, 100);
      }
    }
    return Promise.reject(error);
  }
);

export type Difficulty = "highyield" | "exam" | "harder" | "essay";

export interface CustomContext {
  exam_type: string;
  time_to_exam: string;
  prior_knowledge: string;
  difficulty: string;
  mcq_count: number;
  weak_topics: string;
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
  created_at: string;
}

export interface TokenOut {
  access_token: string;
  token_type: string;
}

export interface LectureOut {
  id: number;
  user_id: string;
  title: string;
  file_path: string;
  created_at: string;
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

// Auth
export const signup = (email: string, password: string) =>
  api.post("/auth/signup", { email, password });

export const login = (email: string, password: string) =>
  api.post("/auth/login", { email, password });

export const getMe = () => api.get<UserOut>("/auth/me");

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
}

export const getEntitlements = () => api.get<Entitlements>("/billing/entitlements");

export const toggleExtraUsage = () =>
  api.post<{ extra_usage_enabled: boolean }>("/billing/extra-usage/toggle");

export const createCheckoutSession = (credits: number) =>
  api.post<{ checkout_url: string }>("/billing/checkout-session", { credits });

export const saveOnboarding = (name: string, university: string, college: string, year_of_study: number) =>
  api.post("/auth/onboarding", { name, university, college, year_of_study });

// Lectures
export const uploadLecture = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const uploadText = (text: string, title: string) =>
  api.post("/upload-text", { text, title });

export const extractImageText = (imageFile: File) => {
  const form = new FormData();
  form.append("file", imageFile);
  return api.post<{ text: string }>("/extract-image-text", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getLectures = () => api.get("/lectures");
export const getSolvedLectures = () => api.get("/lectures/solved");

export const estimateProcessing = (lectureId: number, difficulty: Difficulty = "highyield") =>
  api.get(`/estimate/${lectureId}?mode=${difficulty}`);

export const processLecture = (
  lectureId: number,
  difficulty: Difficulty = "highyield",
  customContext?: CustomContext,
) =>
  api.post(
    `/process/${lectureId}?mode=${
      difficulty === "essay"
        ? customContext ? "essay_custom" : "essay"
        : customContext ? "custom" : difficulty
    }`,
    customContext ?? null,
    { timeout: 600_000 },
  );

export const getStats = () => api.get("/stats");

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
}

export const coachGeneratePractice = (topic: string, count: number) =>
  api.post<{ topic: string; questions: FreshMCQ[] }>("/api/v1/coach/practice/generate", {
    topic,
    count,
  });

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

// ── Essay Q types ─────────────────────────────────────────────────────────────

export interface EssayQuestion {
  question: string;
  ideal_answer: string;
  topic?: string;
  max_score: number;
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
