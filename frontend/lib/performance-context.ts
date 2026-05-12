import { getDashboard } from "./api";

let _cache: { text: string; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Returns a compact performance context string ready to be prepended to a
 * coach message. Covers accuracy, weak topics, and confused topic pairs.
 * Results are cached for 5 minutes. Returns "" if no data exists yet.
 */
export async function getPerformanceContext(): Promise<string> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.text;

  try {
    const { data } = await getDashboard();
    const { overview, weak_topics, co_failures } = data;

    if (!overview.total_attempted) return "";

    const lines: string[] = [
      `[Student Performance Context — use this to personalise your advice]`,
      `Overall accuracy: ${overview.overall_accuracy}% (${overview.total_correct} correct / ${overview.total_attempted} attempted)`,
    ];

    if (overview.weakest_topic) {
      lines.push(
        `Weakest topic: ${overview.weakest_topic.topic} (${Math.round(overview.weakest_topic.accuracy_rate * 100)}% accuracy)`,
      );
    }

    if (weak_topics.topics.length > 0) {
      const topFive = weak_topics.topics
        .slice(0, 5)
        .map((t) => `  • ${t.subtopic}: ${Math.round(t.accuracy_rate * 100)}% acc, ${t.error_count} errors (${t.decay_severity})`)
        .join("\n");
      lines.push(`Struggling topics:\n${topFive}`);
    }

    if (co_failures.topic_pairs.length > 0) {
      const p = co_failures.topic_pairs[0];
      lines.push(`Most confused pair: "${p.topic_a}" and "${p.topic_b}" (${p.co_fail_count} co-failures)`);
    }

    const text = lines.join("\n");
    _cache = { text, at: Date.now() };
    return text;
  } catch {
    return "";
  }
}

/** Call after the student completes a quiz to bust the cache. */
export function invalidatePerformanceContext(): void {
  _cache = null;
}
