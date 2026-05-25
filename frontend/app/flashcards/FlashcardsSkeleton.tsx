import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function FlashcardsSkeleton() {
  return (
    <div className="min-h-screen bg-[#020205] text-white">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-10">
        {/* Header Skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-10 w-48 bg-white/5" />
          <Skeleton className="h-6 w-96 bg-white/5" />
        </div>

        {/* Search & Action Skeleton */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Skeleton className="h-12 flex-1 rounded-xl bg-white/5" />
          <Skeleton className="h-12 w-40 rounded-xl bg-white/5" />
        </div>

        {/* Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="bg-white/5 border-white/10 rounded-2xl overflow-hidden">
              <CardContent className="p-6 space-y-6">
                <div className="flex justify-between items-start">
                  <Skeleton className="h-12 w-12 rounded-xl bg-white/10" />
                  <Skeleton className="h-6 w-24 rounded-full bg-white/10" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-7 w-full bg-white/10" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-20 bg-white/5" />
                    <Skeleton className="h-4 w-20 bg-white/5" />
                  </div>
                </div>
                <div className="pt-4 flex gap-2 border-t border-white/5">
                  <Skeleton className="h-11 flex-1 rounded-xl bg-white/5" />
                  <Skeleton className="h-11 w-24 rounded-xl bg-white/5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
