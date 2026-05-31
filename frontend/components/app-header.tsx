"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { Home, Upload, Bot, BookOpen, CreditCard, Layers, Zap, User, ShieldCheck, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout } from "@/lib/auth";
import { useRouter } from "next/navigation";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Lap", href: "/lap" },
  { label: "Flashcards", href: "/flashcards" },
  { label: "Coach", href: "/coach" },
];

const MOBILE_NAV = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Lap", href: "/lap", icon: Zap },
  { label: "Flashcards", href: "/flashcards", icon: Layers },
  { label: "Coach", href: "/coach", icon: Bot },
];

export function AppHeader({ activePage }: { activePage: string }) {
  const router = useRouter();
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

    // Prefetch key routes on mount for faster navigation
    const routesToPrefetch = ["/dashboard", "/lap", "/flashcards", "/coach", "/account", "/billing", "/legal"];
    routesToPrefetch.forEach((route) => router.prefetch(route));
  }, [router]);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" prefetch={true} className="text-xl font-bold text-foreground shrink-0">
            themcq
          </Link>

          <nav className="hidden md:flex items-center justify-center gap-6 mx-4">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                prefetch={true}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activePage === item.label
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/billing"
              prefetch={true}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>{credits !== null ? `${credits} cr` : "—"}</span>
            </Link>
            
            <DropdownMenu>
              <DropdownMenuTrigger className="focus:outline-none">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm hover:opacity-80 transition-opacity overflow-hidden cursor-pointer">
                  {profilePic ? (
                    <img src={`/uploads/${profilePic}`} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    initial
                  )}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/account")}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/billing")}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span>Billing</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/legal")}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  <span>Legal</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav — fills width with evenly spaced items */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex justify-around py-2 px-2">
          {MOBILE_NAV.map((item) => {
            const active = activePage === item.label || (item.label === "Home" && activePage === "Dashboard");
            return (
              <Link
                key={item.label}
                href={item.href}
                prefetch={true}
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
