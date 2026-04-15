import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, Sparkles } from "lucide-react"

export function CTA() {
  return (
    <section className="px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
      <div className="mx-auto max-w-4xl">
        <Card className="relative overflow-hidden border-border/50 bg-card">
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
          
          <CardContent className="relative p-8 sm:p-12 lg:p-16 text-center">
            <div className="mx-auto mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            
            <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Ready to learn smarter?
            </h2>
            
            <p className="mx-auto mt-4 max-w-lg text-pretty text-muted-foreground">
              Join thousands of students already using cortexQ to ace their exams. 
              Start for free, no credit card required.
            </p>
            
            <div className="mt-8">
              <Link href="/auth">
                <Button size="lg" className="gap-2 px-8">
                  Start for Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
