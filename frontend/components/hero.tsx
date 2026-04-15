import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Play, Zap } from "lucide-react"

export function Hero() {
  return (
    <section className="relative px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-20 sm:pb-32">
      <div className="mx-auto max-w-4xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-1.5 backdrop-blur-sm">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
            <Zap className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            New: AI Flashcard Engine
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Turn Your Lectures Into{" "}
          <span className="relative inline-block text-primary">
            Mastery
            <svg
              className="absolute -bottom-1 left-0 w-full"
              viewBox="0 0 200 8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2 6C50 2 150 2 198 6"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="text-primary/40"
              />
            </svg>
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Upload recordings, PDFs, or notes. Our AI generates active recall tools 
          so you learn faster and remember longer.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/auth" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto gap-2 px-8">
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button 
            variant="outline" 
            size="lg" 
            className="w-full sm:w-auto gap-2 px-8"
          >
            <Play className="h-4 w-4" />
            Watch Demo
          </Button>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-8 border-t border-border pt-8">
          <div>
            <div className="text-2xl font-bold text-foreground sm:text-3xl">50K+</div>
            <div className="mt-1 text-sm text-muted-foreground">Active Students</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground sm:text-3xl">2M+</div>
            <div className="mt-1 text-sm text-muted-foreground">Cards Generated</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground sm:text-3xl">98%</div>
            <div className="mt-1 text-sm text-muted-foreground">Pass Rate</div>
          </div>
        </div>
      </div>
    </section>
  )
}
