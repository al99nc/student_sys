import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground animate-pulse">
      <header className="px-6 py-4 flex items-center gap-3">
        <Skeleton className="h-6 w-24" />
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <Skeleton className="h-8 w-64 mb-10" />
        <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="flex flex-col items-center pt-8 pb-6 px-6">
            <Skeleton className="h-44 w-44 rounded-full mb-6" />
            <Skeleton className="h-16 w-32 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="border-t border-border/40 mx-6" />
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
        <Skeleton className="w-full max-w-sm h-16 mt-5 rounded-xl" />
        <Skeleton className="mt-5 h-3 w-48" />
      </main>
    </div>
  );
}
