import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Title Skeleton */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div className="space-y-3">
            <Skeleton className="h-9 w-48" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>

        {/* Overview Skeleton */}
        <div className="mb-6 sm:mb-8">
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-20 mb-4" />
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-4 rounded-full" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-4 w-8" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Daily Test Skeleton */}
        <div className="mb-6 sm:mb-8">
          <Card className="overflow-hidden border-primary/20">
            <div className="h-1.5 bg-muted" />
            <CardContent className="p-5 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-6 w-32" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-36 rounded-full" />
                </div>
              </div>

              <Skeleton className="h-24 w-full rounded-xl mb-4" />

              <div className="space-y-2 mb-5">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-xl" />
                ))}
              </div>

              <Skeleton className="h-12 w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column Skeleton */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="overflow-hidden">
              <div className="h-1 bg-muted" />
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-3/4 mb-4" />
                <Skeleton className="h-24 w-full rounded-xl mb-3" />
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </CardContent>
            </Card>
          </div>

          {/* Right Column Skeleton */}
          <div className="lg:col-span-8 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-20" />
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-20 rounded-full shrink-0" />
                  ))}
                </div>
                <div className="space-y-2 mb-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl" />
                  ))}
                </div>
                <Skeleton className="h-10 w-full rounded-lg" />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
