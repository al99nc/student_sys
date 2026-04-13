"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

/**
 * Tiny client component — only responsibility is redirecting logged-in users
 * to /dashboard. Kept separate so the landing page itself can be a server
 * component (renders as static HTML, no JS hydration overhead).
 */
export function AuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (isAuthenticated()) router.push("/dashboard");
  }, [router]);
  return null;
}
