"use client";

import { useState } from "react";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import legalData from "@/data/legal-content.json";

export default function LegalPage() {
  const { privacy, terms, meta } = legalData;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <AppHeader activePage="Legal" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="flex flex-col items-center mb-12 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl mb-4 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
            Legal Center
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Everything you need to know about your privacy and our terms. 
            Last updated: <span className="text-foreground font-medium">{meta.lastUpdated}</span>
          </p>
        </div>

        <Tabs defaultValue="privacy" className="w-full">
          <div className="flex justify-center mb-10">
            <TabsList className="grid w-full max-w-md grid-cols-2 bg-muted/50 p-1">
              <TabsTrigger value="privacy" className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all">
                Privacy Policy
              </TabsTrigger>
              <TabsTrigger value="terms" className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all">
                Terms of Service
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="privacy" className="space-y-6 focus-visible:outline-none">
            <section className="mb-8">
              <h2 className="text-2xl font-bold mb-4">{privacy.title}</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your privacy is important to us. This policy explains how we collect, use, and protect your data when using {meta.siteName}.
              </p>
            </section>

            {privacy.sections.map((section) => (
              <Card key={section.id} className="border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
                  <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center border-primary/20 bg-primary/5 text-primary font-bold text-sm shrink-0">
                    {section.num}
                  </Badge>
                  <CardTitle className="text-xl font-semibold">{section.heading}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {section.content.map((paragraph, idx) => (
                      <p key={idx} className="text-muted-foreground leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="terms" className="space-y-6 focus-visible:outline-none">
            <section className="mb-8">
              <h2 className="text-2xl font-bold mb-4">{terms.title}</h2>
              <p className="text-muted-foreground leading-relaxed">
                By using {meta.siteName}, you agree to these terms. Please read them carefully to understand your rights and responsibilities.
              </p>
            </section>

            {terms.sections.map((section) => (
              <Card key={section.id} className="border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
                  <Badge variant="outline" className="h-8 w-8 rounded-full flex items-center justify-center border-primary/20 bg-primary/5 text-primary font-bold text-sm shrink-0">
                    {section.num}
                  </Badge>
                  <CardTitle className="text-xl font-semibold">{section.heading}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {section.content.map((paragraph, idx) => (
                      <p key={idx} className="text-muted-foreground leading-relaxed">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>

        <div className="mt-20 pt-10 border-t border-border/50 text-center">
          <p className="text-muted-foreground text-sm">
            Have questions? Reach out to us at <a href={`mailto:${meta.contactEmail}`} className="text-primary hover:underline font-medium">{meta.contactEmail}</a>
          </p>
        </div>
      </main>
    </div>
  );
}
