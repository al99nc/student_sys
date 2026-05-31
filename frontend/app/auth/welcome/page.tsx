"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteMe } from "@/lib/api";
import { removeToken } from "@/lib/auth";
import { Loader2 } from "lucide-react";

function WelcomePageInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [declining, setDeclining] = useState(false);

  const handleAgree = () => {
    localStorage.setItem("cortexq_agreed_terms", "true");
    router.replace("/auth?onboarding=true");
  };

  const handleDecline = async () => {
    setDeclining(true);
    try {
      await deleteMe();
      removeToken();
      router.replace("/auth?message=Account creation cancelled");
    } catch (err) {
      console.error("Failed to delete account:", err);
      // Fallback: just clear token and redirect
      removeToken();
      router.replace("/auth");
    } finally {
      setDeclining(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-2xl border-primary/20 bg-card/95 backdrop-blur-md">
        <CardHeader className="text-center pb-2">
          <div className="text-2xl font-black tracking-tight mb-4">
            the<span className="text-primary">mcq</span>
          </div>
          <CardTitle className="text-2xl font-black">Final Step</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-8 pt-4">
          <p className="text-muted-foreground text-center leading-relaxed">
            Welcome to CortexQ! Before you start, please confirm that you agree to our{" "}
            <a 
              href="/legal" 
              target="_blank" 
              className="text-primary hover:underline font-semibold"
            >
              Privacy Policy
            </a>{" "}
            and Terms of Service.
          </p>

          <div className="flex flex-col gap-3">
            <Button 
              onClick={handleAgree} 
              disabled={declining}
              className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 font-bold text-base"
            >
              I Agree & Continue
            </Button>
            <Button 
              variant="ghost" 
              onClick={handleDecline} 
              disabled={declining}
              className="w-full h-12 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              {declining ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Decline & Cancel Account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    }>
      <WelcomePageInner />
    </Suspense>
  );
}
