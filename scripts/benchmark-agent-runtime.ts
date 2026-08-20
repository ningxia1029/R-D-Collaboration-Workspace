import { performance } from "node:perf_hooks";
import { ScriptedProvider } from "../agent-worker/src/provider";
import type { ProviderDecision } from "../agent-worker/src/provider";
import { PROMPT_VERSION } from "../agent-worker/src/prompts";

const CONFIG = {
  warmupIterations: 100,
  iterations: 5_000,
  concurrency: 32,
  p95BudgetMs: 25,
  maxErrorRate: 0,
  maxEstimatedCostMicros: 0,
} as const;

function percentile(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(value * sorted.length) - 1));
  return sorted[index];
}

async function runBatch(iterations: number): Promise<{ latencies: number[]; errors: number; costMicros: number }> {
  const latencies = new Array<number>(iterations);
  let nextIndex = 0;
  let errors = 0;
  let costMicros = 0;

  const workers = Array.from({ length: Math.min(CONFIG.concurrency, iterations) }, async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= iterations) return;
      const decision: ProviderDecision = { kind: "answer", answer: `确定性回答-${index}` };
      const provider = new ScriptedProvider([decision]);
      const started = performance.now();
      try {
        const response = await provider.generate({
          systemPrompt: "benchmark",
          promptVersion: PROMPT_VERSION,
          question: "benchmark",
          tools: [],
          toolResults: [],
        });
        costMicros += response.usage.estimatedCostMicros ?? 0;
      } catch {
        errors += 1;
      } finally {
        latencies[index] = performance.now() - started;
      }
    }
  });
  await Promise.all(workers);
  return { latencies, errors, costMicros };
}

async function main(): Promise<void> {
  await runBatch(CONFIG.warmupIterations);
  const started = performance.now();
  const result = await runBatch(CONFIG.iterations);
  const durationMs = performance.now() - started;
  const sorted = [...result.latencies].sort((left, right) => left - right);
  const errorRate = result.errors / CONFIG.iterations;
  const report = {
    scope: "deterministic-provider-adapter-only",
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations: CONFIG.iterations,
    concurrency: CONFIG.concurrency,
    durationMs,
    throughputPerSecond: (CONFIG.iterations / durationMs) * 1_000,
    latencyMs: {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: percentile(sorted, 1),
    },
    errors: result.errors,
    errorRate,
    estimatedCostMicros: result.costMicros,
    budgets: {
      p95Ms: CONFIG.p95BudgetMs,
      maxErrorRate: CONFIG.maxErrorRate,
      maxEstimatedCostMicros: CONFIG.maxEstimatedCostMicros,
    },
  };
  const passed =
    report.latencyMs.p95 <= CONFIG.p95BudgetMs &&
    errorRate <= CONFIG.maxErrorRate &&
    result.costMicros <= CONFIG.maxEstimatedCostMicros;

  console.log(JSON.stringify({ ...report, gate: passed ? "PASS" : "FAIL" }, null, 2));
  console.log("[agent-benchmark] 仅证明本机确定性 Provider Adapter 开销，不代表外部模型、网络、数据库或生产端到端 P95。 ");
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[agent-benchmark] fatal=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
