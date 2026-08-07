"use client";

import { useState } from "react";
import { Modal, Upload, Button, Table, Select, Steps, App, Typography, Alert } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { post } from "@/lib/api-client";

/** BOM CSV/Excel 导入向导：上传 → 字段映射 → 预览提交 */
interface Props {
  open: boolean;
  projectId: string;
  phaseId: string | null;
  onClose: (imported?: boolean) => void;
}

const TARGET_FIELDS = [
  { key: "mpn", label: "MPN 物料编码*", required: true },
  { key: "name", label: "名称*" },
  { key: "spec", label: "规格" },
  { key: "refDes", label: "位号 RefDes" },
  { key: "qty", label: "数量" },
  { key: "status", label: "状态" },
  { key: "supplierUrl", label: "供应商链接" },
  { key: "eta", label: "预计到货日" },
  { key: "isCritical", label: "卡脖子物料" },
];

// 常见表头自动映射
const AUTO_MAP: Record<string, string> = {
  mpn: "mpn", "物料编码": "mpn", "料号": "mpn", "part number": "mpn", "pn": "mpn",
  name: "name", "名称": "name", "品名": "name",
  spec: "spec", "规格": "spec", "规格型号": "spec",
  refdes: "refDes", "位号": "refDes", "ref des": "refDes",
  qty: "qty", "数量": "qty", "用量": "qty",
  status: "status", "状态": "status",
  supplier: "supplierUrl", "供应商": "supplierUrl", "link": "supplierUrl", "链接": "supplierUrl",
  eta: "eta", "交期": "eta", "到货日": "eta",
  critical: "isCritical", "卡脖子": "isCritical",
};

export default function ImportWizard({ open, projectId, phaseId, onClose }: Props) {
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStep(0);
    setHeaders([]);
    setRows([]);
    setMapping({});
  };

  const parseFile = async (file: File) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    let parsedRows: Record<string, string>[] = [];
    if (isExcel) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      parsedRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
    } else {
      const text = await file.text();
      const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      parsedRows = result.data;
    }
    if (!parsedRows.length) {
      message.warning("未解析到数据行");
      return false;
    }
    const hdrs = Object.keys(parsedRows[0]);
    setHeaders(hdrs);
    setRows(parsedRows);
    // 自动映射
    const auto: Record<string, string> = {};
    for (const h of hdrs) {
      const hit = AUTO_MAP[h.trim().toLowerCase()];
      if (hit) auto[hit] = h;
    }
    setMapping(auto);
    setStep(1);
    return false;
  };

  const submit = async () => {
    if (!mapping.mpn || !mapping.name) {
      message.error("请至少映射 MPN 与 名称 字段");
      return;
    }
    setSubmitting(true);
    try {
      const payload = rows.map((r) => ({
        mpn: r[mapping.mpn],
        name: r[mapping.name],
        spec: mapping.spec ? r[mapping.spec] : undefined,
        refDes: mapping.refDes ? r[mapping.refDes] : undefined,
        qty: mapping.qty ? Number(r[mapping.qty]) || 1 : 1,
        status: mapping.status ? r[mapping.status] : "Unordered",
        supplierUrl: mapping.supplierUrl ? r[mapping.supplierUrl] : undefined,
        eta: mapping.eta ? r[mapping.eta] : undefined,
        isCritical: mapping.isCritical ? /y|是|true|1/i.test(r[mapping.isCritical] ?? "") : false,
      })).filter((r) => r.mpn && r.name);
      const res = await post<{ count: number }>("/api/bom/import", { projectId, phaseId, rows: payload });
      message.success(`成功导入 ${res.count} 条物料`);
      reset();
      onClose(true);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const previewRows = rows.slice(0, 8).map((r) => {
    const out: Record<string, string> = {};
    for (const f of TARGET_FIELDS) out[f.key] = mapping[f.key] ? r[mapping[f.key]] : "";
    return out;
  });

  return (
    <Modal
      title="BOM 导入（CSV / Excel）"
      open={open}
      width={860}
      onCancel={() => { reset(); onClose(false); }}
      footer={step === 1 ? [
        <Button key="back" onClick={() => setStep(0)}>重新上传</Button>,
        <Button key="ok" type="primary" loading={submitting} onClick={submit}>确认导入 {rows.length} 行</Button>,
      ] : null}
    >
      <Steps
        current={step}
        size="small"
        items={[{ title: "上传文件" }, { title: "字段映射与预览" }]}
        style={{ marginBottom: 24 }}
      />
      {step === 0 && (
        <Upload.Dragger accept=".csv,.xlsx,.xls" showUploadList={false} beforeUpload={(file) => parseFile(file)}>
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 CSV / Excel 文件到此上传</p>
          <p className="ant-upload-hint">系统将智能识别表头并提示字段映射</p>
        </Upload.Dragger>
      )}
      {step === 1 && (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`识别到 ${rows.length} 行数据，请确认字段映射（已自动匹配常见表头）`} />
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={TARGET_FIELDS}
            columns={[
              { title: "目标字段", dataIndex: "label", width: 160 },
              {
                title: "源列（上传文件的表头）",
                render: (_, f) => (
                  <Select
                    style={{ width: 240 }}
                    allowClear={!f.required}
                    placeholder="选择源列"
                    value={mapping[f.key] ?? undefined}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                    options={headers.map((h) => ({ value: h, label: h }))}
                  />
                ),
              },
            ]}
          />
          <Typography.Title level={5} style={{ marginTop: 16 }}>数据预览（前 8 行）</Typography.Title>
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            scroll={{ x: true }}
            pagination={false}
            dataSource={previewRows}
            columns={TARGET_FIELDS.map((f) => ({ title: f.label, dataIndex: f.key, ellipsis: true }))}
          />
        </>
      )}
    </Modal>
  );
}
