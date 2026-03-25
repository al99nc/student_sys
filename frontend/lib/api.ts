import axios from "axios";
import { removeToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach token automatically
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Redirect to /auth on any 401 (expired or invalid token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined" && error?.response?.status === 401) {
      removeToken();
      window.location.href = "/auth";
    }
    return Promise.reject(error);
  }
);

export type Difficulty = "high_yield_revision" | "hard" | "harder";

// Auth
export const signup = (email: string, password: string) =>
  api.post("/auth/signup", { email, password });

export const login = (email: string, password: string) =>
  api.post("/auth/login", { email, password });

// Lectures
export const uploadLecture = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const getLectures = () => api.get("/lectures");

export const estimateProcessing = (lectureId: number, difficulty: Difficulty = "hard") =>
  api.get(`/estimate/${lectureId}?difficulty=${difficulty}`);

export const processLecture = (lectureId: number, difficulty: Difficulty = "hard") =>
  api.post(`/process/${lectureId}?difficulty=${difficulty}`);

export const getResults = (lectureId: number) =>
  api.get(`/results/${lectureId}`);
