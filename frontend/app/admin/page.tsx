"use client";
import { useState } from "react";
import { api, getAdminStats, adminSetCredits, AdminStats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, CreditCard, TrendingUp, Star, ShieldCheck, LogOut, Eye, EyeOff } from "lucide-react";

type Screen = "login" | "dashboard";

export default function AdminPage() {
  const [screen, setScreen] = useState<Screen>("login");
  const [adminToken, setAdminToken] = useState("");

  // Login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Dashboard data
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState("");

  // Set-credits form
  const [creditEmail, setCreditEmail] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditMsg, setCreditMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const tokenRes = await api.post<{ access_token: string }>("/auth/login", { email, password });
      const token = tokenRes.data.access_token;

      const meRes = await api.get<{ is_admin: boolean }>("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!meRes.data.is_admin) {
        setLoginError("This account does not have admin access.");
        return;
      }

      setAdminToken(token);

      const statsRes = await api.get<AdminStats>("/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStats(statsRes.data);
      setScreen("dashboard");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } };
      if (axiosErr?.response?.status === 401) {
        setLoginError("Invalid email or password.");
      } else {
        setLoginError(axiosErr?.response?.data?.detail ?? "Login failed.");
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSetCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(creditAmount, 10);
    if (!creditEmail || isNaN(amount) || amount < 0) {
      setCreditMsg({ type: "err", text: "Enter a valid email and a non-negative number." });
      return;
    }
    setCreditLoading(true);
    setCreditMsg(null);
    try {
      const res = await api.post<{ email: string; credit_balance: number }>(
        "/admin/set-credits",
        { email: creditEmail.trim(), credits: amount },
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      setCreditMsg({ type: "ok", text: `Done — ${res.data.email} now has ${res.data.credit_balance} credits.` });
      setCreditEmail("");
      setCreditAmount("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setCreditMsg({ type: "err", text: axiosErr?.response?.data?.detail ?? "Request failed." });
    } finally {
      setCreditLoading(false);
    }
  };

  const refreshStats = async () => {
    setStatsError("");
    try {
      const res = await api.get<AdminStats>("/admin/stats", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      setStats(res.data);
    } catch {
      setStatsError("Failed to refresh stats.");
    }
  };

  // ── Login screen ──────────────────────────────────────────────────────────
  if (screen === "login") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 justify-center">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">Admin Access</span>
          </div>

          <Card>
            <CardContent className="p-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="admin@example.com"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <p className="text-sm text-destructive">{loginError}</p>
                )}

                <Button type="submit" className="w-full" disabled={loginLoading}>
                  {loginLoading ? "Verifying…" : "Sign In"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Dashboard screen ──────────────────────────────────────────────────────
  const statCards = [
    { label: "Total Users",    value: stats?.total_users ?? 0,       icon: Users,      badge: null },
    { label: "Free",           value: stats?.free_users ?? 0,        icon: Users,      badge: "free" },
    { label: "Pro",            value: stats?.pro_users ?? 0,         icon: Star,       badge: "pro" },
    { label: "Enterprise",     value: stats?.enterprise_users ?? 0,  icon: ShieldCheck, badge: "enterprise" },
    { label: "Total Credits",  value: stats?.total_credits ?? 0,     icon: CreditCard, badge: null },
    { label: "New Today",      value: stats?.new_users_today ?? 0,   icon: TrendingUp, badge: null },
    { label: "New This Week",  value: stats?.new_users_this_week ?? 0, icon: TrendingUp, badge: null },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="max-w-5xl mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold">Admin</span>
            <Badge variant="secondary" className="text-xs">cortexQ</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refreshStats}>
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setScreen("login"); setAdminToken(""); setStats(null); }}
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Overview</h1>
          <p className="text-sm text-muted-foreground">Live stats from the database.</p>
          {statsError && <p className="mt-2 text-sm text-destructive">{statsError}</p>}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <Card key={s.label}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                  {s.badge && <Badge variant="outline" className="text-xs">{s.badge}</Badge>}
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Set Credits */}
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Set Credits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-5">
              Overwrite a user&apos;s credit balance to an exact amount.
            </p>
            <form onSubmit={handleSetCredits} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                placeholder="user@example.com"
                value={creditEmail}
                onChange={(e) => setCreditEmail(e.target.value)}
                required
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="number"
                placeholder="Credits"
                min={0}
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                required
                className="w-full sm:w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="submit" disabled={creditLoading} className="shrink-0">
                {creditLoading ? "Saving…" : "Set Credits"}
              </Button>
            </form>
            {creditMsg && (
              <p className={`mt-3 text-sm ${creditMsg.type === "ok" ? "text-emerald-500" : "text-destructive"}`}>
                {creditMsg.text}
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
