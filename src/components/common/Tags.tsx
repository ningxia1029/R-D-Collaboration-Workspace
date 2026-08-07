"use client";

import { Tag } from "antd";

const STATUS_COLORS: Record<string, string> = {
  "To Do": "default",
  "In Progress": "processing",
  Blocked: "error",
  Testing: "warning",
  Done: "success",
  Unordered: "default",
  Ordered: "processing",
  "In Transit": "cyan",
  Arrived: "success",
  Delayed: "error",
  DRAFT: "default",
  SUBMITTED: "processing",
  PENDING: "processing",
  APPROVED: "success",
  REJECTED: "error",
  CONVERTED: "purple",
  IMPLEMENTED: "success",
  CLOSED: "default",
  active: "success",
  completed: "default",
  archived: "default",
  pending: "default",
  done: "success",
  missed: "error",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
  P3: "default",
};

export function StatusTag({ value }: { value?: string | null }) {
  if (!value) return <Tag>—</Tag>;
  return <Tag color={STATUS_COLORS[value] ?? "default"}>{value}</Tag>;
}

export function PriorityTag({ value }: { value?: string | null }) {
  if (!value) return null;
  return <Tag color={PRIORITY_COLORS[value] ?? "default"}>{value}</Tag>;
}

export function VerdictIcon({ verdict }: { verdict?: string }) {
  if (verdict === "pass") return <span title="达标">🟢</span>;
  if (verdict === "fail") return <span title="未达标">🔴</span>;
  return <span title="未判定">⚪</span>;
}
