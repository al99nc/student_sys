"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  createCheckoutSession,
  createWaylCheckoutSession,
  verifyWaylPayment,
  syncWaylPayments,
  getBillingConfig,
  getEntitlements,
  getMe,
  type BillingConfig,
  type Entitlements,
  type UserOut,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Info, Loader2 } from "lucide-react";

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

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
  const [creditsEnabled, setCreditsEnabled] = useState(true);
  const [monthlyLimit, setMonthlyLimit] = useState(50);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState("50");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    const checkout = searchParams.get("checkout");
    if (checkout === "canceled") setBanner("canceled");

    (async () => {
      try {
        // Auto-verify Wayl payment if returning from checkout
        const waylRef = sessionStorage.getItem("wayl_ref");
        if (checkout === "success" && waylRef) {
          try {
            await verifyWaylPayment(waylRef);
          } catch { /* already credited or not complete yet — ignore */ }
          sessionStorage.removeItem("wayl_ref");
        }

        const [meRes, cfgRes, entRes] = await Promise.all([
          getMe(),
          getBillingConfig(),
          getEntitlements(),
        ]);
        setUser(meRes.data);
        setConfig(cfgRes.data);
        setEnt(entRes.data);
        if (checkout === "success") setBanner("success");
      } catch {
        setError("Could not load billing info.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, searchParams]);

  const parsedCredits = Math.max(0, Math.floor(Number.parseFloat(credits) || 0));
  const priceCents =
    config && parsedCredits > 0 ? parsedCredits * config.credit_price_cents : 0;
  const minCreditsForStripe =
    config && config.credit_price_cents > 0
      ? Math.max(1, Math.ceil(50 / config.credit_price_cents))
      : 1;

  const balance = user?.credit_balance ?? 0;
  // derive a "spent" figure — credits consumed relative to monthly limit
  const spentCredits = Math.max(0, monthlyLimit - balance);
  const usedPct = monthlyLimit > 0 ? Math.min(100, Math.round((spentCredits / monthlyLimit) * 100)) : 0;

  const handlePay = async () => {
    setError("");
    if (!config) return;
    if (parsedCredits < 1) {
      setError("Enter how many credits you want (at least 1).");
      return;
    }
    if (priceCents < 50) {
      setError(
        `Minimum card charge is typically 50¢. Buy at least ${minCreditsForStripe} credits.`,
      );
      return;
    }
    setPaying(true);
    try {
      const res = await createCheckoutSession(parsedCredits);
      const url = res.data.checkout_url;
      if (url) window.location.href = url;
      else setError("No checkout URL returned.");
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not start checkout.");
    } finally {
      setPaying(false);
    }
  };

  const handlePayWayl = async () => {
    setError("");
    if (!config) return;
    if (parsedCredits < 1) {
      setError("Enter how many credits you want (at least 1).");
      return;
    }
    const totalIqd = parsedCredits * (config.credit_price_iqd ?? 5000);
    if (totalIqd < 1000) {
      setError(`Minimum payment is 1,000 IQD. Buy at least ${Math.ceil(1000 / (config.credit_price_iqd ?? 5000))} credits.`);
      return;
    }
    setPayingWayl(true);
    try {
      const res = await createWaylCheckoutSession(parsedCredits);
      const url = res.data.checkout_url;
      if (url) {
        sessionStorage.setItem("wayl_ref", res.data.reference_id);
        window.location.href = url;
      } else setError("No payment URL returned.");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not start Wayl checkout.");
    } finally {
      setPayingWayl(false);
    }
  };

  const handleSyncWayl = async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await syncWaylPayments();
      const { credits_added, credit_balance } = res.data;
      setUser((u) => u ? { ...u, credit_balance } : u);
      setEnt((e) => e ? { ...e, credit_balance } : e);
      if (credits_added > 0) setBanner("success");
      else setError("No new Wayl payments found to credit.");
    } catch {
      setError("Could not sync Wayl payments.");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="grain-overlay" />
      <header className="fixed top-0 w-full flex items-center px-6 py-4 bg-card/80 backdrop-blur-xl z-50 border-b border-border/50 gap-4">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <span className="text-lg font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
          Credits &amp; Usage
        </span>
      </header>

      <main className="pt-24 pb-16 px-4 max-w-2xl mx-auto space-y-px">
        {banner === "success" && (
          <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            Payment received — credits will appear in your balance within a minute.
          </div>
        )}
        {banner === "canceled" && (
          <div className="mb-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Checkout canceled. You were not charged.
          </div>
        )}

        {/* ── Section: Extra usage toggle ── */}
        <div className="rounded-t-2xl bg-card border border-border/60 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Extra usage</h2>
              <p className="text-sm text-muted-foreground">
                Turn on extra usage to keep using the AI features if you hit a limit.
              </p>
            </div>
            {/* Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={creditsEnabled}
              onClick={() => setCreditsEnabled((v) => !v)}
              className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                creditsEnabled ? "bg-white" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                  creditsEnabled ? "translate-x-6 bg-black" : "translate-x-0 bg-muted-foreground"
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Section: Usage bar ── */}
        <div className="bg-card border-x border-border/60 px-6 py-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-base font-semibold tabular-nums">{balance} credits</p>
              <p className="text-sm text-muted-foreground">
                Current balance
                {ent && (
                  <> · <span className={ent.premium ? "text-emerald-400" : ""}>{ent.premium ? "Premium" : "Free tier"}</span></>
                )}
              </p>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">{usedPct}% used</p>
          </div>
          <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          {ent && (
            <div className="mt-3 flex gap-6 text-xs text-muted-foreground">
              <span>
                Uploads: <span className="text-foreground tabular-nums">{ent.uploads_this_month}/{ent.uploads_limit}</span>
              </span>
              <span>
                Coach msgs: <span className="text-foreground tabular-nums">{ent.coach_messages_this_month}/{ent.coach_messages_limit}</span>
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleSyncWayl}
            disabled={syncing}
            className="mt-3 text-xs text-[#00D2FD] hover:underline disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "↻ Sync Wayl payments"}
          </button>
        </div>

        {/* ── Section: Monthly limit ── */}
        <div className="bg-card border-x border-border/60 px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-base font-semibold tabular-nums">{monthlyLimit} credits</p>
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Monthly spend limit</p>
            </div>
            {editingLimit ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value)}
                  className="w-24 h-9 tabular-nums text-sm"
                />
                <Button
                  size="sm"
                  className="h-9 px-3 text-sm font-medium"
                  onClick={() => {
                    const v = Math.max(1, Math.floor(Number(limitInput) || 1));
                    setMonthlyLimit(v);
                    setLimitInput(String(v));
                    setEditingLimit(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 px-3 text-sm"
                  onClick={() => {
                    setLimitInput(String(monthlyLimit));
                    setEditingLimit(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 text-sm font-medium rounded-xl"
                onClick={() => setEditingLimit(true)}
              >
                Adjust limit
              </Button>
            )}
          </div>
        </div>

        {/* ── Section: Buy credits ── */}
        <div className="rounded-b-2xl bg-card border border-border/60 px-6 py-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-base font-semibold">Buy credits</p>
              {config && (
                <p className="text-sm text-muted-foreground">
                  {formatMoney(config.credit_price_cents, config.currency)} per credit
                </p>
              )}
            </div>
          </div>

          {/* Preset + custom */}
          <div className="grid grid-cols-4 gap-2">
            {[10, 25, 50, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCredits(String(p))}
                className={`rounded-xl py-3 text-sm font-semibold transition-all border ${
                  parsedCredits === p
                    ? "border-[#7B2FFF] bg-[#7B2FFF]/20 text-white"
                    : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="tabular-nums flex-1"
              placeholder="Custom amount"
            />
            {config && parsedCredits > 0 && (
              <span className="text-base font-bold tabular-nums shrink-0">
                {formatMoney(priceCents, config.currency)}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full synapse-gradient text-white font-semibold h-11 rounded-xl"
            onClick={handlePay}
            disabled={paying || !config || !creditsEnabled}
          >
            {paying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Opening checkout…
              </>
            ) : (
              "Pay with card (USD)"
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full font-semibold h-11 rounded-xl border-[#00D2FD]/50 text-[#00D2FD] hover:bg-[#00D2FD]/10"
            onClick={handlePayWayl}
            disabled={payingWayl || !config || !creditsEnabled}
          >
            {payingWayl ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Opening checkout…
              </>
            ) : (
              <>
                Pay with Wayl{config && parsedCredits > 0 ? ` — ${((parsedCredits * (config.credit_price_iqd ?? 5000))).toLocaleString()} IQD` : " (IQD)"}
              </>
            )}
          </Button>

          {!creditsEnabled && (
            <p className="text-xs text-muted-foreground text-center">
              Turn on extra usage above to purchase credits.
            </p>
          )}

          {ent && (
            <p className="text-[11px] text-muted-foreground text-center">
              −{ent.credit_cost_mcq_process} per MCQ run · −{ent.credit_cost_coach_message} per coach message
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}
