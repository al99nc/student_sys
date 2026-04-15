const universities = ["STANFORD", "MIT", "HARVARD", "OXFORD", "BERKELEY"]

export function SocialProof() {
  return (
    <section className="px-4 sm:px-6 lg:px-8 py-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="mb-8 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Trusted by students at
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {universities.map((name) => (
            <span 
              key={name} 
              className="text-lg font-bold tracking-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground sm:text-xl"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
