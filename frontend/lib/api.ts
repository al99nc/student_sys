import axios from "axios";
import { getToken, logout } from "./auth";

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
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error?.response?.status === 401) {
      logout();
    }
    return Promise.reject(error);
  }
);

export type Difficulty = "highyield" | "exam" | "harder";

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

export const postChatCoach = (message: string) =>
  api.post("/api/v1/performance/students/me/chat", { message });
