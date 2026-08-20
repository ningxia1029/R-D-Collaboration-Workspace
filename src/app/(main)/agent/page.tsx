import { Suspense } from "react";
import { Spin } from "antd";
import AgentWorkbench from "@/components/agent/AgentWorkbench";

export default function AgentPage() {
  return (
    <Suspense fallback={<Spin size="large" />}>
      <AgentWorkbench />
    </Suspense>
  );
}
