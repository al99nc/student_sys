import { Skeleton } from "@/components/ui/skeleton";

export function CoachSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Skeleton */}
        <aside className="hidden lg:flex flex-col bg-card border-r border-border w-[260px] flex-shrink-0">
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <Skeleton className="h-8 w-24" />
            </div>
            <div className="p-3">
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
            <div className="px-3 pb-2">
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="flex-1 px-2 pb-2 space-y-4 pt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2 px-3">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-8 w-full rounded-lg" />
                  <Skeleton className="h-8 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Area Skeleton */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Header Skeleton */}
          <header className="flex-shrink-0 flex items-center gap-2.5 px-3 border-b border-border bg-background h-[56px]">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex items-center gap-2.5 flex-1">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-10 w-10 rounded-lg" />
          </header>

          {/* Messages Skeleton */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[700px] mx-auto px-4 py-8 space-y-8">
              <div className="flex flex-col items-center justify-center gap-6 py-12">
                <Skeleton className="h-16 w-16 rounded-2xl" />
                <div className="space-y-2 w-full max-w-md">
                  <Skeleton className="h-6 w-3/4 mx-auto" />
                  <Skeleton className="h-4 w-full mx-auto" />
                  <Skeleton className="h-3 w-1/2 mx-auto" />
                </div>
              </div>
              
              {[1, 2].map((i) => (
                <div key={i} className="space-y-4">
                  <div className="flex justify-end pl-[12%]">
                    <Skeleton className="h-12 w-2/3 rounded-2xl rounded-tr-sm" />
                  </div>
                  <div className="flex gap-2 pr-[4%]">
                    <Skeleton className="h-6 w-6 rounded-lg shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-20 w-3/4 rounded-2xl rounded-tl-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Input Area Skeleton */}
          <div className="flex-shrink-0 px-4 border-t border-border bg-background py-4">
            <div className="max-w-[700px] mx-auto space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full ml-auto" />
              </div>
              <Skeleton className="h-12 w-full rounded-[26px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
