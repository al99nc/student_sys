import Link from "next/link"
import { AuthRedirect } from "./auth-redirect"
import { Header } from "@/components/header"
import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { SocialProof } from "@/components/social-proof"
import { CTA } from "@/components/cta"
import { Footer } from "@/components/footer"
import { MobileNav } from "@/components/mobile-nav"

export default function Home() {
  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-x-hidden">
      <AuthRedirect />
      
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-primary/3 rounded-full blur-[100px]" />
      </div>

      <Header />

      <main className="relative pt-24 pb-32">
        <Hero />
        <Features />
        <SocialProof />
        <CTA />
      </main>

      <Footer />
      <MobileNav />
    </div>
  )
}
