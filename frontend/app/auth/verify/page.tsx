"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const Spinner = () => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
    <p className="text-sm text-muted-foreground">Verifying your link…</p>
  </div>
);

function VerifyInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      window.location.replace("/auth?error=invalid_link");
      return;
    }
    // Forward to the backend verify endpoint through the Next.js proxy.
    window.location.replace(`/api/auth/verify?token=${encodeURIComponent(token)}`);
  }, []);

  return <Spinner />;
}

export default function AuthVerifyPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <VerifyInner />
    </Suspense>
  );
}
