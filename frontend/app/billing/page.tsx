"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  createCheckoutSession,
  createWaylCheckoutSession,
  verifyWaylPayment,
  syncWaylPayments,
  getBillingConfig,
  getEntitlements,
  toggleExtraUsage,
  setMonthlyLimit,
  getMe,
  type BillingConfig,
  type Entitlements,
  type UserOut,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { StepNav } from "@/components/step-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const LIMIT_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: "No limit", value: null },
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

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
  const [togglingUsage, setTogglingUsage] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshEntitlements = useCallback(async () => {
    setRefreshing(true);
    try {
      const [meRes, entRes] = await Promise.all([getMe(), getEntitlements()]);
      setUser(meRes.data);
      setEnt(entRes.data);
    } catch {
      setError("Could not refresh balance. Please reload the page.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    const checkout = searchParams.get("checkout");
    if (checkout === "canceled") setBanner("canceled");

    (async () => {
      try {
        const waylRef = sessionStorage.getItem("wayl_ref");
        if (checkout === "success" && waylRef) {
          try {
            await verifyWaylPayment(waylRef);
          } catch (e: unknown) {
            const status = (e as { response?: { status?: number } })?.response?.status;
            if (!status || status >= 500) throw e;
          }
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
  const monthlyLimit = ent?.monthly_credit_limit ?? null;
  const monthlyUsed = ent?.monthly_credits_used ?? 0;
  const usedPct =
    monthlyLimit != null && monthlyLimit > 0
      ? Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100))
      : 0;

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

  const handleToggleExtraUsage = async () => {
    setTogglingUsage(true);
    setError("");
    try {
      await toggleExtraUsage();
      // Re-fetch authoritative state — the toggle may have been auto-disabled
      // by the monthly limit on the server side.
      await refreshEntitlements();
    } catch {
      setError("Could not update credit usage setting.");
    } finally {
      setTogglingUsage(false);
    }
  };

  const handleSetLimit = async (value: number | null) => {
    setSavingLimit(true);
    setError("");
    try {
      const res = await setMonthlyLimit(value);
      // Update state immediately from the server response — no polling needed.
      setEnt((e) =>
        e
          ? {
              ...e,
              monthly_credit_limit: res.data.monthly_credit_limit,
              monthly_credits_used: res.data.monthly_credits_used,
            }
          : e,
      );
    } catch {
      setError("Could not update monthly limit.");
    } finally {
      setSavingLimit(false);
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
      <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/50">
        <div className="max-w-7xl mx-auto flex h-14 items-center px-4 sm:px-6 gap-3">
          <Link href="/dashboard" prefetch={false} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <span className="text-xl font-bold text-foreground">cortexQ</span>
          <span className="text-sm text-muted-foreground">· Credits &amp; Usage</span>
        </div>
        <StepNav steps={[{ label: "Dashboard", href: "/dashboard" }, { label: "Credits & Usage" }]} />
      </header>

      <main className="pt-8 pb-16 px-4 max-w-2xl mx-auto space-y-px">
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

        {/* ── Section: Use credits toggle ── */}
        <div className="rounded-t-2xl bg-card border border-border/60 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold mb-1">Use credits</h2>
              <p className="text-sm text-muted-foreground">
                Allow the app to spend from your credit balance when you reach the free tier limit.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={ent?.extra_usage_enabled ?? false}
              onClick={handleToggleExtraUsage}
              disabled={togglingUsage}
              className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                ent?.extra_usage_enabled ? "bg-white" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform duration-200 ${
                  ent?.extra_usage_enabled ? "translate-x-6 bg-black" : "translate-x-0 bg-muted-foreground"
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
            {monthlyLimit != null ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                {monthlyUsed} / {monthlyLimit} credits used
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No monthly cap</p>
            )}
          </div>

          {monthlyLimit != null && (
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usedPct >= 100
                    ? "bg-destructive"
                    : usedPct >= 80
                    ? "bg-amber-400"
                    : "bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD]"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          )}

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

          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={handleSyncWayl}
              disabled={syncing}
              className="text-xs text-[#00D2FD] hover:underline disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "↻ Sync Wayl payments"}
            </button>
            <button
              type="button"
              onClick={refreshEntitlements}
              disabled={refreshing}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Section: Monthly spend limit ── */}
        <div className="bg-card border-x border-border/60 px-6 py-5 space-y-3">
          <div>
            <p className="text-base font-semibold">Monthly spend limit</p>
            <p className="text-sm text-muted-foreground">
              Stop charging credits once you hit this amount. The toggle turns off automatically when the limit is reached.
            </p>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {LIMIT_PRESETS.map(({ label, value }) => {
              const isSelected = monthlyLimit === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  disabled={savingLimit}
                  onClick={() => handleSetLimit(value)}
                  className={`rounded-xl py-2.5 text-sm font-semibold transition-all border disabled:opacity-50 ${
                    isSelected
                      ? "border-[#7B2FFF] bg-[#7B2FFF]/20 text-white"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  {savingLimit && isSelected ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                  ) : (
                    label
                  )}
                </button>
              );
            })}
          </div>

          {monthlyLimit != null && (
            <p className="text-xs text-muted-foreground">
              {monthlyUsed} of {monthlyLimit} credits used this month
              {usedPct >= 100 && (
                <span className="ml-2 text-destructive font-medium">
                  · Limit reached — toggle auto-disabled
                </span>
              )}
            </p>
          )}
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
            disabled={paying || !config || !(ent?.extra_usage_enabled ?? false)}
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
            disabled={payingWayl || !config || !(ent?.extra_usage_enabled ?? false)}
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

          {!(ent?.extra_usage_enabled ?? false) && (
            <p className="text-xs text-muted-foreground text-center">
              Enable credit usage above to buy credits.
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
