import axios from "axios";
import { getToken, logout, removeToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
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

export type Difficulty = "highyield" | "exam" | "harder";

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

export const getLectures = () => api.get("/lectures");

export const estimateProcessing = (lectureId: number, difficulty: Difficulty = "highyield") =>
  api.get(`/estimate/${lectureId}?mode=${difficulty}`);

export const processLecture = (lectureId: number, difficulty: Difficulty = "highyield") =>
  api.post(`/process/${lectureId}?mode=${difficulty}`, null, { timeout: 600_000 });

export const getStats = () => api.get("/stats");

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
) =>
  api.post(`/api/v1/coach/conversations/${convId}/messages`, {
    message,
    ...(imageData ? { image_data: imageData, image_mime: imageMime } : {}),
    ...(quizResult ? { quiz_result: quizResult } : {}),
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
sessionId: string, questionId: string, selectedAnswer: string, correctAnswer: string, timeSpentSeconds: number, p0: { pre_answer_confidence: number; time_to_confidence: number; answer_changed: boolean; original_answer: string | null; time_to_first_change: number | null; answer_timeline: { time_on_option_a: number; time_on_option_b: number; time_on_option_c: number; time_on_option_d: number; second_choice: string | null; re_read_question: boolean; re_read_count: number; }; }) =>
  api.post(`/api/v1/performance/sessions/${sessionId}/answer`, {
    question_id: questionId,
    selected_answer: selectedAnswer,
    correct_answer: correctAnswer,
    time_spent_seconds: timeSpentSeconds,
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
