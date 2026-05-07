import Link from "next/link"
import { Sparkles } from "lucide-react"

const footerLinks = [
  { label: "About", href: "/about" },
  { label: "Privacy", href: "#" },
  { label: "Terms", href: "#" },
  { label: "Twitter", href: "#" },
  { label: "Discord", href: "#" },
]

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col items-center gap-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-foreground">
              themcq
            </span>
          </Link>

          {/* Links */}
          <nav className="flex flex-wrap items-center justify-center gap-6">
  {footerLinks.map((link) => {
    const isButton = link.label === "About";
    return (
      <Link
        key={link.label}
        href={link.href}
        className={
          isButton
            ? "text-sm bg-primary text-foreground px-3 py-1.5 rounded-md hover:bg-primary-600"
            : "text-sm text-muted-foreground transition-colors hover:text-foreground"
        }
      >
        {link.label}
      </Link>
    );
  })}
          </nav>

          {/* Copyright */}
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} themcq. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
