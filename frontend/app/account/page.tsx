"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import { getMe, saveOnboarding, UserOut } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Home, Upload, Bot, BarChart3, Camera, LogOut, Pencil, Check, X } from "lucide-react";

const AVATAR_KEY = "cortexq_avatar";

export default function AccountPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    const storedAvatar = localStorage.getItem(AVATAR_KEY);
    if (storedAvatar) setAvatar(storedAvatar);

    getMe()
      .then((res) => {
        setUser(res.data);
        setNameInput(res.data.name ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatar(dataUrl);
      localStorage.setItem(AVATAR_KEY, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSaveName() {
    if (!user) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    setSavingName(true);
    setNameError("");
    try {
      await saveOnboarding(
        trimmed,
        user.university ?? "",
        user.college ?? "",
        user.year_of_study ?? 1,
      );
      setUser((prev) => prev ? { ...prev, name: trimmed } : prev);
      setEditingName(false);
    } catch {
      setNameError("Failed to save. Please try again.");
    } finally {
      setSavingName(false);
    }
  }

  function handleCancelEdit() {
    setNameInput(user?.name ?? "");
    setNameError("");
    setEditingName(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            cortexQ
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">Dashboard</Link>
            <Link href="/upload" className="text-muted-foreground hover:text-foreground transition-colors">Upload</Link>
            <Link href="/coach" className="text-muted-foreground hover:text-foreground transition-colors">Coach</Link>
            <Link href="/analytics" className="text-muted-foreground hover:text-foreground transition-colors">Analytics</Link>
          </nav>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span>/</span>
          <span className="text-foreground">Account</span>
        </nav>

        <h1 className="text-2xl font-bold mb-8">Account Settings</h1>

        {/* Profile picture + name */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleAvatarClick}
                className="relative group focus:outline-none"
                aria-label="Change profile picture"
              >
                <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/40 bg-muted flex items-center justify-center text-3xl font-bold text-primary">
                  {avatar ? (
                    <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-5 h-5 text-white" />
                </span>
              </button>
              <button
                onClick={handleAvatarClick}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Change photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Name edit */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Display name</label>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <Button size="icon" variant="default" className="h-9 w-9" onClick={handleSaveName} disabled={savingName}>
                    {savingName ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={handleCancelEdit}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between h-9 rounded-md border border-input bg-muted/30 px-3">
                  <span className="text-sm">{user?.name || <span className="text-muted-foreground italic">No name set</span>}</span>
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-muted-foreground hover:text-foreground transition-colors ml-2"
                    aria-label="Edit name"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Account info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Account Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Email" value={user?.email ?? "—"} />
            <Row label="University" value={user?.university ?? "—"} />
            <Row label="College" value={user?.college ?? "—"} />
            <Row label="Year" value={user?.year_of_study != null ? `Year ${user.year_of_study}` : "—"} />
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Plan</span>
              <Badge variant={user?.plan === "pro" ? "default" : "secondary"} className="capitalize">
                {user?.plan ?? "free"}
              </Badge>
            </div>
            <Row label="Credits" value={user?.credit_balance != null ? String(user.credit_balance) : "—"} />
          </CardContent>
        </Card>

        {/* Logout */}
        <Card>
          <CardContent className="pt-6">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => logout()}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Log out
            </Button>
          </CardContent>
        </Card>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-background z-40">
        <div className="flex items-center justify-around h-16 px-2">
          <Link href="/dashboard" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Home className="w-5 h-5" />
            <span className="text-[10px]">Home</span>
          </Link>
          <Link href="/upload" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Upload className="w-5 h-5" />
            <span className="text-[10px]">Upload</span>
          </Link>
          <Link href="/coach" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Bot className="w-5 h-5" />
            <span className="text-[10px]">Coach</span>
          </Link>
          <Link href="/analytics" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px]">Analytics</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
