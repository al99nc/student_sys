import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function LapSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navigation bar Skeleton */}
      <div className="sticky top-16 md:top-20 z-30 flex items-center justify-center pt-4 pb-2 shrink-0 bg-background/50 backdrop-blur-sm">
        <div className="flex items-center p-1.5 gap-1.5 bg-background border border-border/40 rounded-full shadow-lg">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
      </div>

      <main className="flex-grow flex flex-col w-full overflow-hidden">
        <div className="flex flex-1 overflow-x-auto snap-x snap-mandatory scrollbar-hide">
          <section className="min-w-[100vw] snap-start overflow-y-auto">
            <div className="px-4 sm:px-6 max-w-3xl mx-auto w-full pb-32">
              <div className="space-y-8">
                <div className="text-center space-y-3 pt-6">
                  <Skeleton className="h-10 w-3/4 mx-auto" />
                  <Skeleton className="h-4 w-1/2 mx-auto" />
                </div>

                <div className="flex gap-2 justify-center">
                  <Skeleton className="h-10 w-32 rounded-xl" />
                  <Skeleton className="h-10 w-32 rounded-xl" />
                </div>

                <Skeleton className="h-[240px] w-full rounded-xl" />

                <Skeleton className="h-14 w-full rounded-xl" />

                <div className="rounded-xl border border-border/40 bg-muted/10 p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
