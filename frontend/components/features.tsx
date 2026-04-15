import { Card, CardContent } from "@/components/ui/card"
import { 
  BrainCircuit, 
  FileText, 
  Layers, 
  BarChart3 
} from "lucide-react"

const features = [
  {
    icon: BrainCircuit,
    title: "AI-Generated MCQs",
    description: "Instant multiple-choice questions extracted directly from your course material context.",
  },
  {
    icon: FileText,
    title: "Smart Summaries",
    description: "Condense 2-hour lectures into 10-minute high-yield reading modules with key takeaways.",
  },
  {
    icon: Layers,
    title: "Flashcard Decks",
    description: "Automatic Anki-style decks synced across all your devices for spaced-repetition learning.",
  },
  {
    icon: BarChart3,
    title: "Progress Analytics",
    description: "Visual heatmaps and performance data to identify exactly where you need more focus.",
  },
]

export function Features() {
  return (
    <section id="features" className="px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
      <div className="mx-auto max-w-7xl">
        {/* Section Header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything you need to study smarter
          </h2>
          <p className="mt-4 text-pretty text-lg text-muted-foreground">
            Powerful AI tools that transform how you learn and retain information.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card 
              key={feature.title}
              className="group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-primary/20 hover:bg-card"
            >
              <CardContent className="p-6">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
