import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateEnterpriseAgentDataset } from "../src/lib/agent/eval/harness";
import { ENTERPRISE_AGENT_EVAL_CASES } from "../tests/agent/fixtures/enterprise-agent-eval-v1";

async function main(): Promise<void> {
  const outputDir = path.resolve("output", "agent-eval");
  const outputPath = path.join(outputDir, "enterprise-agent-eval-v1.json");
  const report = evaluateEnterpriseAgentDataset(ENTERPRISE_AGENT_EVAL_CASES);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[agent-eval] dataset=${report.datasetVersion}`);
  console.log(`[agent-eval] total=${report.total} passed=${report.passed} failed=${report.failed}`);
  console.log(
    `[agent-eval] permission_leakage=${report.permissionLeakageCount} unconfirmed_write=${report.unconfirmedWriteCount} evidence_coverage=${report.evidenceCoverageRate.toFixed(2)}`,
  );
  console.log(`[agent-eval] deterministic_model_cost_micros=${report.estimatedModelCostMicros}`);
  console.log(`[agent-eval] report=${outputPath}`);
  console.log(`[agent-eval] gate=${report.gatePassed ? "PASS" : "FAIL"}`);

  if (!report.gatePassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`[agent-eval] fatal=${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
