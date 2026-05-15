"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, logout } from "@/lib/auth";
import { getMe, updateProfile, uploadProfilePicture, UserOut } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, LogOut, Pencil, Check, X, Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function AccountPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingPic, setUploadingPic] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const [editingUni, setEditingUni] = useState(false);
  const [uniInput, setUniInput] = useState("");

  const [editingCollege, setEditingCollege] = useState(false);
  const [collegeInput, setCollegeInput] = useState("");

  const [editingYear, setEditingYear] = useState(false);
  const [yearInput, setYearInput] = useState(1);

  const [savingField, setSavingField] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }

    getMe()
      .then((res) => {
        setUser(res.data);
        setNameInput(res.data.name ?? "");
        setUniInput(res.data.university ?? "");
        setCollegeInput(res.data.college ?? "");
        setYearInput(res.data.year_of_study ?? 1);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPic(true);
    try {
      const res = await uploadProfilePicture(file);
      setUser(res.data);
    } catch {
      // fallback: keep local
    } finally {
      setUploadingPic(false);
      e.target.value = "";
    }
  }

  async function handleSaveField(field: string, value: string | number) {
    if (!user) return;
    setSavingField(field);
    setFieldError("");
    try {
      const payload: Record<string, string | number> = {};
      if (field === "name") {
        if (typeof value === "string" && !value.trim()) {
          setFieldError("Name cannot be empty");
          setSavingField(null);
          return;
        }
        payload.name = typeof value === "string" ? value.trim() : value;
      }
      if (field === "university") payload.university = typeof value === "string" ? value.trim() : value;
      if (field === "college") payload.college = typeof value === "string" ? value.trim() : value;
      if (field === "year_of_study") payload.year_of_study = value;

      const res = await updateProfile(payload);
      setUser(res.data);
      setEditingName(false);
      setEditingUni(false);
      setEditingCollege(false);
      setEditingYear(false);
    } catch {
      setFieldError("Failed to save. Please try again.");
    } finally {
      setSavingField(null);
    }
  }

  function handleCancelEdit(field: string) {
    if (!user) return;
    if (field === "name") { setNameInput(user.name ?? ""); setEditingName(false); }
    if (field === "university") { setUniInput(user.university ?? ""); setEditingUni(false); }
    if (field === "college") { setCollegeInput(user.college ?? ""); setEditingCollege(false); }
    if (field === "year_of_study") { setYearInput(user.year_of_study ?? 1); setEditingYear(false); }
    setFieldError("");
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

  const picSrc = user?.profile_picture
    ? `${API_URL.replace("/api", "")}/uploads/${user.profile_picture}`
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 md:pb-0">
      <AppHeader activePage="Account" />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
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
                disabled={uploadingPic}
              >
                <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/40 bg-muted flex items-center justify-center text-3xl font-bold text-primary">
                  {uploadingPic ? (
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  ) : picSrc ? (
                    <img src={picSrc} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                  <Camera className="w-5 h-5 text-white" />
                </span>
              </button>
              <button
                onClick={handleAvatarClick}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                disabled={uploadingPic}
              >
                {uploadingPic ? "Uploading..." : "Change photo"}
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
            <EditableField
              label="Display name"
              value={nameInput}
              editing={editingName}
              onStartEdit={() => setEditingName(true)}
              onSave={() => handleSaveField("name", nameInput)}
              onCancel={() => handleCancelEdit("name")}
              onChange={setNameInput}
              saving={savingField === "name"}
              error={editingName ? fieldError : ""}
            />

            {/* University edit */}
            <EditableField
              label="University"
              value={uniInput}
              editing={editingUni}
              onStartEdit={() => setEditingUni(true)}
              onSave={() => handleSaveField("university", uniInput)}
              onCancel={() => handleCancelEdit("university")}
              onChange={setUniInput}
              saving={savingField === "university"}
              error={editingUni ? fieldError : ""}
            />

            {/* College edit */}
            <EditableField
              label="College"
              value={collegeInput}
              editing={editingCollege}
              onStartEdit={() => setEditingCollege(true)}
              onSave={() => handleSaveField("college", collegeInput)}
              onCancel={() => handleCancelEdit("college")}
              onChange={setCollegeInput}
              saving={savingField === "college"}
              error={editingCollege ? fieldError : ""}
            />

            {/* Year edit */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Year</label>
              {editingYear ? (
                <div className="flex items-center gap-2">
                  <select
                    autoFocus
                    value={yearInput}
                    onChange={(e) => setYearInput(Number(e.target.value))}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {[1, 2, 3, 4, 5, 6].map((y) => (
                      <option key={y} value={y}>Year {y}</option>
                    ))}
                  </select>
                  <Button size="icon" variant="default" className="h-9 w-9" onClick={() => handleSaveField("year_of_study", yearInput)} disabled={savingField === "year_of_study"}>
                    {savingField === "year_of_study" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => handleCancelEdit("year_of_study")}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between h-9 rounded-md border border-input bg-muted/30 px-3">
                  <span className="text-sm">{user?.year_of_study != null ? `Year ${user.year_of_study}` : <span className="text-muted-foreground italic">Not set</span>}</span>
                  <button
                    onClick={() => setEditingYear(true)}
                    className="text-muted-foreground hover:text-foreground transition-colors ml-2"
                    aria-label="Edit year"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {editingYear && fieldError && <p className="text-xs text-destructive">{fieldError}</p>}
            </div>
          </CardContent>
        </Card>

        {/* Account info (read-only) */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Account Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Email" value={user?.email ?? "—"} />
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

function EditableField({
  label,
  value,
  editing,
  onStartEdit,
  onSave,
  onCancel,
  onChange,
  saving,
  error,
}: {
  label: string;
  value: string;
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: (v: string) => void;
  saving: boolean;
  error: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancel();
            }}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <Button size="icon" variant="default" className="h-9 w-9 shrink-0" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-4 h-4" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between h-9 rounded-md border border-input bg-muted/30 px-3">
          <span className="text-sm">{value || <span className="text-muted-foreground italic">Not set</span>}</span>
          <button
            onClick={onStartEdit}
            className="text-muted-foreground hover:text-foreground transition-colors ml-2 shrink-0"
            aria-label={`Edit ${label}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {editing && error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
