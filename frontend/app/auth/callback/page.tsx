"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveToken } from "@/lib/auth";
import { getMe } from "@/lib/api";
import { Loader2 } from "lucide-react";

const Spinner = () => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
    <p className="text-sm text-muted-foreground">Signing you in…</p>
  </div>
);

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      router.replace("/auth?error=invalid_link");
      return;
    }

    saveToken(token);

    const redirectToOnboarding = () => {
      router.replace("/auth?onboarding=true");
    };

    const redirectToDashboard = () => {
      const redirectTo = sessionStorage.getItem("auth_redirect") || "/dashboard";
      sessionStorage.removeItem("auth_redirect");
      router.replace(redirectTo);
    };

    const isNewUser = searchParams.get("is_new_user") === "true";
    if (isNewUser) {
      redirectToOnboarding();
      return;
    }

    getMe()
      .then((res) => {
        if (!res.data.name) {
          redirectToOnboarding();
        } else {
          redirectToDashboard();
        }
      })
      .catch(() => {
        redirectToDashboard();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Spinner />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallbackInner />
    </Suspense>
  );
}
