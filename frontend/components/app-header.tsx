"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { Home, Upload, Bot, BookOpen, CreditCard, Layers, Sparkles } from "lucide-react";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Upload", href: "/upload" },
  { label: "Create", href: "/create" },
  { label: "Lectures", href: "/lectures" },
  { label: "Flashcards", href: "/flashcards" },
  { label: "Coach", href: "/coach" },
];

const MOBILE_NAV = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Upload", href: "/upload", icon: Upload },
  { label: "Create", href: "/create", icon: Sparkles },
  { label: "Lectures", href: "/lectures", icon: BookOpen },
  { label: "Flashcards", href: "/flashcards", icon: Layers },
  { label: "Coach", href: "/coach", icon: Bot },
];

export function AppHeader({ activePage }: { activePage: string }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [initial, setInitial] = useState("?");
  const [profilePic, setProfilePic] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then(({ data }) => {
        setCredits(data.credit_balance);
        if (data.name) setInitial(data.name.charAt(0).toUpperCase());
        if (data.profile_picture) setProfilePic(data.profile_picture);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" prefetch={false} className="text-xl font-bold text-foreground">
            themcq
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                prefetch={false}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activePage === item.label
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/billing"
              prefetch={false}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>{credits !== null ? `${credits} cr` : "—"}</span>
            </Link>
            <Link
              href="/account"
              prefetch={false}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm hover:opacity-80 transition-opacity overflow-hidden"
            >
              {profilePic ? (
                <img src={`/uploads/${profilePic}`} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav — scrollable so all items fit on small screens */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex overflow-x-auto scrollbar-none py-2 px-2 gap-1">
          {MOBILE_NAV.map((item) => {
            const active = activePage === item.label || (item.label === "Home" && activePage === "Dashboard");
            return (
              <Link
                key={item.label}
                href={item.href}
                prefetch={false}
                className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-lg transition-colors shrink-0 ${
                  active ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
