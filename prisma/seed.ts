// 演示数据种子：角色/权限、用户、项目、任务、BOM、Specs、ECO/ECR、产品树、物料库、知识库、工时
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  PERMISSIONS,
  ROLE_PERMISSION_MAP,
  type PermissionCode,
} from "../src/lib/constants";
import { reindexAll } from "../src/lib/services/searchService";

const prisma = new PrismaClient();

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function main() {
  console.log("== 清理旧数据 ==");
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.entityLink.deleteMany(),
    prisma.documentTag.deleteMany(),
    prisma.docVersion.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.document.deleteMany(),
    prisma.timeEntry.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.approvalRecord.deleteMany(),
    prisma.changeImpact.deleteMany(),
    prisma.changeLog.deleteMany(),
    prisma.changeRequest.deleteMany(),
    prisma.productVersion.deleteMany(),
    prisma.projectMember.deleteMany(),
    prisma.task.deleteMany(),
    prisma.bomItem.deleteMany(),
    prisma.techSpec.deleteMany(),
    prisma.phase.deleteMany(),
    prisma.project.deleteMany(),
    prisma.product.deleteMany(),
    prisma.material.deleteMany(),
    prisma.user.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
    prisma.sequenceCounter.deleteMany(),
  ]);

  console.log("== 角色与权限 ==");
  const permissions = await Promise.all(
    PERMISSIONS.map((code) =>
      prisma.permission.create({ data: { code, description: code } })
    )
  );
  const permId = new Map(permissions.map((p) => [p.code, p.id]));

  const roleDefs: { name: string; description: string; perms: readonly PermissionCode[] | "all" }[] = [
    { name: "admin", description: "系统管理员", perms: "all" },
    { name: "pm", description: "项目经理", perms: ROLE_PERMISSION_MAP.pm },
    { name: "engineer", description: "研发工程师", perms: ROLE_PERMISSION_MAP.engineer },
    { name: "viewer", description: "访客", perms: ROLE_PERMISSION_MAP.viewer },
  ];
  const roles: Record<string, string> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.create({
      data: { name: def.name, description: def.description },
    });
    roles[def.name] = role.id;
    const codes = def.perms === "all" ? PERMISSIONS : def.perms;
    await prisma.rolePermission.createMany({
      data: codes.map((c) => ({ roleId: role.id, permissionId: permId.get(c)! })),
    });
  }

  console.log("== 用户 ==");
  const passwordHash = await bcrypt.hash("Demo@123456", 10);
  const admin = await prisma.user.create({
    data: { email: "admin@demo.com", name: "系统管理员", passwordHash, roleId: roles.admin },
  });
  const pm = await prisma.user.create({
    data: { email: "pm@demo.com", name: "张工(项目经理)", passwordHash, roleId: roles.pm },
  });
  const eng = await prisma.user.create({
    data: { email: "eng@demo.com", name: "李工(硬件工程师)", passwordHash, roleId: roles.engineer },
  });
  const guest = await prisma.user.create({
    data: { email: "guest@demo.com", name: "访客", passwordHash, roleId: roles.viewer },
  });

  console.log("== 物料库 ==");
  const materialDefs = [
    { mpn: "STM32F407VGT6", name: "ARM Cortex-M4 主控 MCU", spec: "168MHz / 1MB Flash / LQFP-100", manufacturer: "ST", category: "MCU", unit: "pcs" },
    { mpn: "ESP32-WROOM-32E", name: "WiFi+BLE 模组", spec: "4MB Flash / PCB 天线", manufacturer: "Espressif", category: "无线模组", unit: "pcs" },
    { mpn: "DS18B20", name: "数字温度传感器", spec: "-55~125°C / ±0.5°C / TO-92", manufacturer: "Maxim", category: "传感器", unit: "pcs" },
    { mpn: "SHT31-DIS-B", name: "温湿度传感器", spec: "I2C / ±2%RH / DFN-8", manufacturer: "Sensirion", category: "传感器", unit: "pcs" },
    { mpn: "TPS5430DDAR", name: "降压 DC-DC 转换器", spec: "3A / 5.5-36V / SOP-8", manufacturer: "TI", category: "电源", unit: "pcs" },
    { mpn: "AMS1117-3.3", name: "LDO 稳压器", spec: "3.3V / 1A / SOT-223", manufacturer: "AMS", category: "电源", unit: "pcs" },
    { mpn: "TP4056", name: "锂电池充电管理 IC", spec: "1A 线性充电 / SOP-8", manufacturer: "拓微", category: "电源", unit: "pcs" },
    { mpn: "RES-0603-10K-1%", name: "贴片电阻 10KΩ", spec: "0603 / ±1% / 0.1W", manufacturer: "Yageo", category: "被动元件", unit: "reel" },
    { mpn: "CAP-0603-100NF", name: "贴片电容 100nF", spec: "0603 / X7R / 50V", manufacturer: "Murata", category: "被动元件", unit: "reel" },
    { mpn: "CAP-0805-10UF", name: "贴片电容 10uF", spec: "0805 / X5R / 25V", manufacturer: "Samsung", category: "被动元件", unit: "reel" },
    { mpn: "LED-0603-RED", name: "贴片 LED 红色", spec: "0603 / 20mA", manufacturer: "Everlight", category: "光电器件", unit: "reel" },
    { mpn: "OLED-0.96-I2C", name: "0.96寸 OLED 显示屏", spec: "128x64 / I2C / SSD1306", manufacturer: "通用", category: "显示", unit: "pcs" },
    { mpn: "USB-C-16P-F", name: "USB Type-C 母座", spec: "16Pin / 贴片", manufacturer: "通用", category: "连接器", unit: "pcs" },
    { mpn: "SW-TACT-6X6", name: "轻触开关", spec: "6x6x5mm / 贴片", manufacturer: "通用", category: "连接器", unit: "pcs" },
    { mpn: "PCB-TH100-V1.1", name: "TH-100 主控 PCB", spec: "2层 / 1.6mm / 沉金", manufacturer: "嘉立创", category: "PCB", unit: "pcs" },
    { mpn: "CASE-TH100-ABS", name: "TH-100 ABS 外壳", spec: "上盖+下盖 / 黑色", manufacturer: "开模供应商A", category: "结构件", unit: "pcs" },
    { mpn: "BT-18650-2600", name: "18650 锂电池", spec: "2600mAh / 带保护板", manufacturer: "通用", category: "电源", unit: "pcs" },
    { mpn: "ANT-2.4G-IPEX", name: "2.4G 外置天线", spec: "IPEX / 3dBi", manufacturer: "通用", category: "射频", unit: "pcs" },
    { mpn: "NRF52840-QIAA", name: "BLE 5.0 SoC", spec: "64MHz / 1MB / QFN-73", manufacturer: "Nordic", category: "MCU", unit: "pcs" },
    { mpn: "SCREW-M2X6", name: "十字圆头螺丝", spec: "M2x6 / 304不锈钢", manufacturer: "通用", category: "结构件", unit: "pcs" },
  ];
  const materials: Record<string, string> = {};
  for (const m of materialDefs) {
    const row = await prisma.material.create({ data: { ...m, defaultSupplierUrl: "https://example.com/s/" + m.mpn } });
    materials[m.mpn] = row.id;
  }

  console.log("== 产品树 ==");
  const th100 = await prisma.product.create({
    data: { name: "TH-100 智能温控器", code: "TH-100", nodeType: "PRODUCT", currentVersion: "V1.1" },
  });
  const mainBoard = await prisma.product.create({
    data: { name: "主控板组件", code: "TH-100-MB", parentId: th100.id, nodeType: "ASSEMBLY", currentVersion: "PCB V1.1" },
  });
  const enclosure = await prisma.product.create({
    data: { name: "外壳组件", code: "TH-100-CASE", parentId: th100.id, nodeType: "ASSEMBLY", currentVersion: "V1.0" },
  });
  const powerMod = await prisma.product.create({
    data: { name: "电源组件", code: "TH-100-PWR", parentId: th100.id, nodeType: "ASSEMBLY", currentVersion: "V1.0" },
  });
  await prisma.product.createMany({
    data: [
      { name: "主控 MCU", code: "TH-100-MB-U1", parentId: mainBoard.id, nodeType: "MATERIAL", materialId: materials["STM32F407VGT6"], qty: 1 },
      { name: "WiFi 模组", code: "TH-100-MB-U2", parentId: mainBoard.id, nodeType: "MATERIAL", materialId: materials["ESP32-WROOM-32E"], qty: 1 },
      { name: "温湿度传感器", code: "TH-100-MB-U3", parentId: mainBoard.id, nodeType: "MATERIAL", materialId: materials["SHT31-DIS-B"], qty: 1 },
      { name: "外壳上盖", code: "TH-100-CASE-TOP", parentId: enclosure.id, nodeType: "MATERIAL", materialId: materials["CASE-TH100-ABS"], qty: 1 },
      { name: "充电管理", code: "TH-100-PWR-U1", parentId: powerMod.id, nodeType: "MATERIAL", materialId: materials["TP4056"], qty: 1 },
      { name: "电池", code: "TH-100-PWR-BT", parentId: powerMod.id, nodeType: "MATERIAL", materialId: materials["BT-18650-2600"], qty: 1 },
    ],
  });
  await prisma.productVersion.createMany({
    data: [
      { productId: mainBoard.id, version: "PCB V1.0", note: "EVT 首版", releasedAt: daysFromNow(-60) },
      { productId: mainBoard.id, version: "PCB V1.1", note: "ECO-2026-001：修复电源走线", releasedAt: daysFromNow(-20) },
    ],
  });

  console.log("== 项目 ==");
  const project1 = await prisma.project.create({
    data: {
      name: "TH-100 智能温控器研发",
      code: "TH-100",
      status: "active",
      lifecycleStage: "RD",
      description: "面向智能家居的 WiFi 温控器，含硬件、结构、固件全链路研发",
      ownerId: pm.id,
      startDate: daysFromNow(-90),
      endDate: daysFromNow(120),
      productId: th100.id,
    },
  });
  const project2 = await prisma.project.create({
    data: {
      name: "GW-20 BLE 网关预研",
      code: "GW-20",
      status: "active",
      lifecycleStage: "CONCEPT",
      description: "蓝牙 Mesh 网关技术预研（POC 阶段）",
      ownerId: pm.id,
      startDate: daysFromNow(-20),
    },
  });

  await prisma.projectMember.createMany({
    data: [
      { projectId: project1.id, userId: pm.id },
      { projectId: project1.id, userId: eng.id },
      { projectId: project1.id, userId: guest.id, roleId: roles.viewer },
      { projectId: project2.id, userId: pm.id },
      { projectId: project2.id, userId: eng.id },
    ],
  });

  console.log("== 阶段 ==");
  const p1POC = await prisma.phase.create({
    data: { projectId: project1.id, phaseName: "POC", targetDate: daysFromNow(-70), sortOrder: 0, status: "done" },
  });
  const p1EVT = await prisma.phase.create({
    data: { projectId: project1.id, phaseName: "EVT", targetDate: daysFromNow(10), sortOrder: 1, status: "active" },
  });
  const p1DVT = await prisma.phase.create({
    data: { projectId: project1.id, phaseName: "DVT", targetDate: daysFromNow(60), sortOrder: 2, status: "pending" },
  });
  const p2POC = await prisma.phase.create({
    data: { projectId: project2.id, phaseName: "POC", targetDate: daysFromNow(30), sortOrder: 0, status: "active" },
  });

  console.log("== 任务 ==");
  const t = async (data: Parameters<typeof prisma.task.create>[0]["data"]) => prisma.task.create({ data });
  const taskRoot1 = await t({ projectId: project1.id, title: "EVT 阶段硬件开发", status: "In Progress", priority: "P1", phaseId: p1EVT.id, assigneeId: eng.id, startDate: daysFromNow(-20), dueDate: daysFromNow(8), estimatedHours: 80, createdBy: pm.id, sortOrder: 0 });
  const taskPcb = await t({ projectId: project1.id, title: "PCB V1.1 Layout 设计", status: "Done", priority: "P1", phaseId: p1EVT.id, parentId: taskRoot1.id, assigneeId: eng.id, startDate: daysFromNow(-20), dueDate: daysFromNow(-5), estimatedHours: 32, createdBy: pm.id });
  const taskBom = await t({ projectId: project1.id, title: "EVT 物料采购与齐套", status: "In Progress", priority: "P0", phaseId: p1EVT.id, parentId: taskRoot1.id, assigneeId: eng.id, startDate: daysFromNow(-15), dueDate: daysFromNow(5), estimatedHours: 16, createdBy: pm.id });
  const taskAsm = await t({ projectId: project1.id, title: "样机贴片组装", status: "Blocked", priority: "P0", phaseId: p1EVT.id, parentId: taskRoot1.id, assigneeId: eng.id, startDate: daysFromNow(5), dueDate: daysFromNow(9), estimatedHours: 12, createdBy: pm.id });
  const taskFw = await t({ projectId: project1.id, title: "固件 v1.1 温控逻辑开发", status: "In Progress", priority: "P1", phaseId: p1EVT.id, assigneeId: eng.id, startDate: daysFromNow(-10), dueDate: daysFromNow(12), estimatedHours: 40, createdBy: pm.id });
  const taskTest = await t({ projectId: project1.id, title: "EVT 整机功能测试", status: "To Do", priority: "P1", phaseId: p1EVT.id, assigneeId: eng.id, startDate: daysFromNow(10), dueDate: daysFromNow(15), estimatedHours: 24, createdBy: pm.id });
  const taskReview = await t({ projectId: project1.id, title: "原理图设计评审", status: "Testing", priority: "P2", phaseId: p1EVT.id, assigneeId: pm.id, startDate: daysFromNow(-3), dueDate: daysFromNow(2), estimatedHours: 4, createdBy: pm.id });
  const taskCase = await t({ projectId: project1.id, title: "外壳结构确认与手板打样", status: "To Do", priority: "P2", phaseId: p1DVT.id, assigneeId: eng.id, startDate: daysFromNow(20), dueDate: daysFromNow(40), estimatedHours: 20, createdBy: pm.id });
  const taskMs = await t({ projectId: project1.id, title: "EVT 封样", status: "To Do", priority: "P0", phaseId: p1EVT.id, isMilestone: true, assigneeId: pm.id, startDate: daysFromNow(10), dueDate: daysFromNow(10), createdBy: pm.id });
  await t({ projectId: project1.id, title: "POC 原理验证", status: "Done", priority: "P1", phaseId: p1POC.id, assigneeId: eng.id, startDate: daysFromNow(-85), dueDate: daysFromNow(-70), estimatedHours: 40, createdBy: pm.id });
  await t({ projectId: project1.id, title: "传感器选型报告", status: "Done", priority: "P3", phaseId: p1POC.id, assigneeId: eng.id, startDate: daysFromNow(-80), dueDate: daysFromNow(-72), estimatedHours: 8, createdBy: pm.id });
  await t({ projectId: project1.id, title: "DVT 可靠性测试计划", status: "To Do", priority: "P2", phaseId: p1DVT.id, assigneeId: pm.id, startDate: daysFromNow(45), dueDate: daysFromNow(55), estimatedHours: 10, createdBy: pm.id });

  const taskGw1 = await t({ projectId: project2.id, title: "BLE Mesh 协议调研", status: "In Progress", priority: "P1", phaseId: p2POC.id, assigneeId: eng.id, startDate: daysFromNow(-15), dueDate: daysFromNow(6), estimatedHours: 24, createdBy: pm.id });
  await t({ projectId: project2.id, title: "NRF52840 开发板验证", status: "To Do", priority: "P2", phaseId: p2POC.id, assigneeId: eng.id, startDate: daysFromNow(7), dueDate: daysFromNow(25), estimatedHours: 30, createdBy: pm.id });

  // 任务依赖（FS）
  await prisma.taskDependency.createMany({
    data: [
      { predecessorId: taskPcb.id, successorId: taskAsm.id, type: "FS" },
      { predecessorId: taskBom.id, successorId: taskAsm.id, type: "FS" },
      { predecessorId: taskAsm.id, successorId: taskTest.id, type: "FS" },
      { predecessorId: taskTest.id, successorId: taskMs.id, type: "FS" },
    ],
  });

  // 模拟「Delayed 卡脖子物料 → 自动 Block 组装任务」的审计记录（供恢复逻辑识别）
  await prisma.auditLog.create({
    data: {
      userId: pm.id, action: "AUTO_BLOCK", entityType: "TASK", entityId: taskAsm.id,
      diffJson: JSON.stringify({ from: "To Do", to: "Blocked", reason: "卡脖子物料延迟: ESP32-WROOM-32E, SHT31-DIS-B" }),
      createdAt: daysFromNow(-1),
    },
  });

  // 里程碑
  await prisma.milestone.createMany({
    data: [
      { projectId: project1.id, name: "EVT 封样", date: daysFromNow(10), phaseId: p1EVT.id, status: "pending" },
      { projectId: project1.id, name: "DVT 完成", date: daysFromNow(60), phaseId: p1DVT.id, status: "pending" },
      { projectId: project2.id, name: "POC 评审", date: daysFromNow(30), phaseId: p2POC.id, status: "pending" },
    ],
  });

  console.log("== BOM ==");
  type BomDef = { mpn: string; name: string; spec?: string; refDes?: string; qty?: number; status: string; eta?: number; isCritical?: boolean };
  const bomDefs: BomDef[] = [
    { mpn: "STM32F407VGT6", name: "ARM Cortex-M4 主控 MCU", refDes: "U1", qty: 1, status: "Arrived", isCritical: true },
    { mpn: "ESP32-WROOM-32E", name: "WiFi+BLE 模组", refDes: "U2", qty: 1, status: "Delayed", eta: 12, isCritical: true },
    { mpn: "SHT31-DIS-B", name: "温湿度传感器", refDes: "U3", qty: 1, status: "Delayed", eta: 8, isCritical: true },
    { mpn: "DS18B20", name: "数字温度传感器", refDes: "U4", qty: 2, status: "Arrived" },
    { mpn: "TPS5430DDAR", name: "降压 DC-DC", refDes: "U5", qty: 1, status: "In Transit", eta: 3 },
    { mpn: "AMS1117-3.3", name: "LDO 稳压器", refDes: "U6", qty: 1, status: "Arrived" },
    { mpn: "TP4056", name: "充电管理 IC", refDes: "U7", qty: 1, status: "Ordered", eta: 6 },
    { mpn: "RES-0603-10K-1%", name: "贴片电阻 10KΩ", refDes: "R1-R12", qty: 12, status: "Arrived" },
    { mpn: "CAP-0603-100NF", name: "贴片电容 100nF", refDes: "C1-C15", qty: 15, status: "Arrived" },
    { mpn: "CAP-0805-10UF", name: "贴片电容 10uF", refDes: "C16-C20", qty: 5, status: "In Transit", eta: 2 },
    { mpn: "LED-0603-RED", name: "贴片 LED 红", refDes: "D1-D3", qty: 3, status: "Arrived" },
    { mpn: "OLED-0.96-I2C", name: "OLED 显示屏", refDes: "LCD1", qty: 1, status: "Ordered", eta: 7 },
    { mpn: "USB-C-16P-F", name: "USB-C 母座", refDes: "J1", qty: 1, status: "Arrived" },
    { mpn: "SW-TACT-6X6", name: "轻触开关", refDes: "SW1-SW3", qty: 3, status: "Unordered" },
    { mpn: "PCB-TH100-V1.1", name: "TH-100 主控 PCB", refDes: "—", qty: 5, status: "In Transit", eta: 4, isCritical: true },
    { mpn: "CASE-TH100-ABS", name: "ABS 外壳", refDes: "—", qty: 1, status: "Unordered" },
    { mpn: "BT-18650-2600", name: "18650 锂电池", refDes: "BT1", qty: 1, status: "Arrived" },
    { mpn: "ANT-2.4G-IPEX", name: "2.4G 天线", refDes: "ANT1", qty: 1, status: "Arrived" },
    { mpn: "SCREW-M2X6", name: "M2x6 螺丝", refDes: "—", qty: 4, status: "Arrived" },
  ];
  for (const [i, b] of bomDefs.entries()) {
    await prisma.bomItem.create({
      data: {
        projectId: project1.id,
        phaseId: p1EVT.id,
        materialId: materials[b.mpn],
        mpn: b.mpn,
        name: b.name,
        spec: b.spec ?? null,
        refDes: b.refDes ?? null,
        qty: b.qty ?? 1,
        status: b.status,
        supplierUrl: "https://example.com/s/" + b.mpn,
        eta: b.eta !== undefined ? daysFromNow(b.eta) : null,
        isCritical: b.isCritical ?? false,
      },
    });
  }
  await prisma.bomItem.create({
    data: { projectId: project2.id, phaseId: p2POC.id, materialId: materials["NRF52840-QIAA"], mpn: "NRF52840-QIAA", name: "BLE 5.0 SoC", refDes: "U1", qty: 1, status: "Ordered", eta: daysFromNow(9), isCritical: true },
  });

  console.log("== Tech Specs ==");
  const specDefs = [
    { metricName: "静态功耗", targetValue: "50", actualValue: "62", unit: "mA", compareRule: "lte", phaseId: p1EVT.id },
    { metricName: "充电峰值功率", targetValue: "5", actualValue: "5.2", unit: "W", compareRule: "gte", phaseId: p1EVT.id },
    { metricName: "测温精度", targetValue: "0.5", actualValue: "0.4", unit: "°C", compareRule: "lte", phaseId: p1EVT.id },
    { metricName: "WiFi 通信波特率", targetValue: "115200", actualValue: "115200", unit: "bps", compareRule: "gte", phaseId: p1EVT.id },
    { metricName: "续航时间", targetValue: "72", actualValue: "58", unit: "h", compareRule: "gte", phaseId: p1EVT.id },
    { metricName: "工作温度范围", targetValue: "-10~55", actualValue: "-10~55", unit: "°C", compareRule: "eq", phaseId: p1EVT.id },
  ];
  for (const s of specDefs) {
    await prisma.techSpec.create({ data: { projectId: project1.id, ...s } });
  }
  await prisma.techSpec.create({
    data: {
      projectId: project1.id,
      phaseId: p1EVT.id,
      metricName: "温控逻辑状态机",
      firmwareVersion: "FW v1.1.0",
      contentMd: [
        "# 温控逻辑工作流",
        "",
        "固件 v1.1.0 温控状态机（FSM）：",
        "",
        "```mermaid",
        "stateDiagram-v2",
        "    [*] --> Idle",
        "    Idle --> Heating: temp < target - hysteresis",
        "    Idle --> Cooling: temp > target + hysteresis",
        "    Heating --> Idle: temp >= target",
        "    Cooling --> Idle: temp <= target",
        "    Heating --> Fault: sensor_timeout",
        "    Cooling --> Fault: sensor_timeout",
        "    Fault --> Idle: manual_reset",
        "```",
        "",
        "## 关键参数",
        "- 回差(hysteresis): 0.5°C",
        "- 传感器超时: 5s 无数据进入 Fault",
      ].join("\n"),
    },
  });

  console.log("== ECO / ECR ==");
  const eco1 = await prisma.changeLog.create({
    data: {
      projectId: project1.id, ecoNumber: "ECO-2026-001", type: "Hardware",
      reason: "EVT 首版电源走线压降过大", description: "加粗 5V 电源走线至 30mil，增加去耦电容",
      versionFrom: "PCB V1.0", versionTo: "PCB V1.1", status: "IMPLEMENTED",
      createdBy: eng.id, createdAt: daysFromNow(-20),
    },
  });
  const eco2 = await prisma.changeLog.create({
    data: {
      projectId: project1.id, ecoNumber: "ECO-2026-002", type: "Firmware",
      reason: "温控回差逻辑抖动", description: "状态机增加软件消抖与传感器超时保护",
      versionFrom: "FW v1.0.2", versionTo: "FW v1.1.0", status: "APPROVED",
      createdBy: eng.id, createdAt: daysFromNow(-8),
    },
  });
  await prisma.changeLog.create({
    data: {
      projectId: project1.id, ecoNumber: "ECO-2026-003", type: "BOM",
      reason: "SHT31 交期风险", description: "评估 SHT30 作为替代料",
      status: "DRAFT", createdBy: pm.id, createdAt: daysFromNow(-2),
    },
  });
  await prisma.sequenceCounter.create({ data: { key: "ECO-2026", value: 3 } });

  const ecr1 = await prisma.changeRequest.create({
    data: {
      projectId: project1.id, ecrNumber: "ECR-2026-001", title: "外壳增加挂墙孔位",
      type: "Mechanical", reason: "客户反馈需要壁挂安装", status: "SUBMITTED",
      requestedBy: pm.id, createdAt: daysFromNow(-1),
    },
  });
  await prisma.sequenceCounter.create({ data: { key: "ECR-2026", value: 1 } });

  await prisma.changeImpact.createMany({
    data: [
      { ecoId: eco1.id, entityType: "BOM_ITEM", entityId: "PCB-TH100-V1.1", note: "PCB 改板" },
      { ecoId: eco2.id, entityType: "TASK", entityId: taskFw.id, note: "固件逻辑重构" },
    ],
  });
  await prisma.approvalRecord.createMany({
    data: [
      { targetType: "ECO", targetId: eco1.id, approverId: pm.id, action: "APPROVE", comment: "同意改板", createdAt: daysFromNow(-19) },
      { targetType: "ECO", targetId: eco2.id, approverId: pm.id, action: "APPROVE", comment: "评审通过", createdAt: daysFromNow(-7) },
      { targetType: "ECR", targetId: ecr1.id, approverId: pm.id, action: "SUBMIT", comment: "提交评审", createdAt: daysFromNow(-1) },
    ],
  });

  // 追溯关联：任务 ↔ BOM / 文档 / ECO
  await prisma.entityLink.createMany({
    data: [
      { taskId: taskAsm.id, entityType: "BOM_ITEM", entityId: "ESP32-WROOM-32E" },
      { taskId: taskAsm.id, entityType: "BOM_ITEM", entityId: "SHT31-DIS-B" },
      { taskId: taskFw.id, entityType: "ECO", entityId: eco2.id },
      { taskId: taskPcb.id, entityType: "ECO", entityId: eco1.id },
    ],
  });

  console.log("== 知识库 ==");
  const docDefs = [
    {
      title: "STM32 低功耗设计规范", category: "设计规范", tags: ["低功耗", "STM32", "硬件"],
      summary: "休眠模式选型、外设时钟门控、唤醒源配置 checklist",
      body: "# STM32 低功耗设计规范\n\n## 休眠模式选型\n\n| 模式 | 电流 | 唤醒时间 | 保持内容 |\n|---|---|---|---|\n| Sleep | ~10mA | 即时 | 全部 |\n| Stop | ~20µA | ~5µs | SRAM/寄存器 |\n| Standby | ~2µA | ~50µs | 仅备份域 |\n\n## Checklist\n\n- [ ] 未用 GPIO 配置为模拟输入\n- [ ] 外设时钟按需门控 `__HAL_RCC_xxx_CLK_DISABLE()`\n- [ ] 调试接口(SWD)量产前关闭\n\n```c\nHAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);\n```",
      versions: 2,
    },
    {
      title: "SHT31 I2C 通信调试笔记", category: "调试笔记", tags: ["I2C", "传感器", "调试"],
      summary: "SHT31 读取异常排查过程：上拉电阻、时钟延展、CRC 校验",
      body: "# SHT31 I2C 调试笔记\n\n## 问题现象\n读取温度偶发返回 0xFF。\n\n## 排查过程\n1. 示波器发现 SDA 上升沿过缓 → 上拉从 10K 改为 4.7K\n2. 从机时钟延展(clock stretching)未使能导致主机超时\n3. CRC 校验未处理 NACK\n\n## 结论\n硬件上拉 + 软件使能时钟延展后稳定。`i2c_set_timeout(100ms)`",
      versions: 1,
    },
    {
      title: "电源纹波超标失效分析案例", category: "失效分析", tags: ["电源", "失效分析", "EMC"],
      summary: "TPS5430 输出纹波 120mV 超标根因分析与对策",
      body: "# 电源纹波超标失效分析\n\n## 现象\nTPS5430 输出纹波实测 120mVpp，超规格(50mV)。\n\n## 根因\n输出电容 ESR 过高 + 反馈走线靠近电感。\n\n## 对策\n- 换用低 ESR 陶瓷电容并联 10uF\n- FB 走线远离开关节点，包地处理\n\n改后纹波降至 35mVpp。",
      versions: 2,
    },
    {
      title: "EVT→DVT 试制问题复用案例", category: "经验案例", tags: ["试制", "EVT", "经验复用"],
      summary: "上项目 EVT 阶段 TOP10 问题清单与 DVT 预防动作",
      body: "# EVT→DVT 问题复用案例\n\n1. 贴片立碑 → 焊盘设计对称性检查\n2. 连接器虚焊 → 钢网开口加厚\n3. 外壳卡扣断裂 → 材料从 ABS 改 PC+ABS\n4. 静电打坏传感器 → 增加 TVS 管\n\n**复用建议**：新项目 DVT 评审前逐项核对本清单。",
      versions: 1,
    },
    {
      title: "固件 OTA 升级工作流", category: "工作流", tags: ["OTA", "固件", "流程"],
      summary: "双分区 OTA 升级流程与回滚策略",
      body: "# 固件 OTA 升级工作流\n\n```mermaid\nflowchart LR\n    A[检测新版本] --> B[下载到 B 区]\n    B --> C{CRC 校验}\n    C -->|通过| D[置启动标志]\n    C -->|失败| A\n    D --> E[重启]\n    E --> F{B 区启动成功?}\n    F -->|是| G[确认运行]\n    F -->|否| H[回滚 A 区]\n```\n\n双分区保证刷写失败可回滚。",
      versions: 1,
    },
  ];
  const docIds: string[] = [];
  for (const d of docDefs) {
    const doc = await prisma.document.create({
      data: {
        title: d.title, category: d.category, summary: d.summary,
        projectId: project1.id, createdBy: eng.id, createdAt: daysFromNow(-30), updatedAt: daysFromNow(-3),
      },
    });
    docIds.push(doc.id);
    for (let v = 1; v <= d.versions; v++) {
      await prisma.docVersion.create({
        data: {
          documentId: doc.id, version: v, contentMd: v === d.versions ? d.body : d.body + `\n\n> (v${v} 历史版本)`,
          changeNote: v === 1 ? "初始版本" : "修订完善", createdBy: eng.id, createdAt: daysFromNow(-30 + v * 10),
        },
      });
    }
    for (const tagName of d.tags) {
      const tag = await prisma.tag.upsert({ where: { name: tagName }, create: { name: tagName }, update: {} });
      await prisma.documentTag.create({ data: { documentId: doc.id, tagId: tag.id } });
    }
  }

  console.log("== 工时 ==");
  const timeDefs = [
    { taskId: taskPcb.id, userId: eng.id, date: -14, hours: 6, note: "Layout 布局" },
    { taskId: taskPcb.id, userId: eng.id, date: -13, hours: 7, note: "走线与 DRC" },
    { taskId: taskPcb.id, userId: eng.id, date: -12, hours: 5, note: "Gerber 输出" },
    { taskId: taskFw.id, userId: eng.id, date: -6, hours: 8, note: "状态机实现" },
    { taskId: taskFw.id, userId: eng.id, date: -5, hours: 6, note: "消抖逻辑" },
    { taskId: taskFw.id, userId: eng.id, date: -4, hours: 7, note: "联调" },
    { taskId: taskBom.id, userId: eng.id, date: -8, hours: 3, note: "下单" },
    { taskId: taskBom.id, userId: eng.id, date: -2, hours: 2, note: "跟催延迟料" },
    { taskId: taskReview.id, userId: pm.id, date: -2, hours: 3, note: "评审会议" },
    { taskId: taskGw1.id, userId: eng.id, date: -10, hours: 8, note: "协议栈调研" },
    { taskId: taskGw1.id, userId: eng.id, date: -9, hours: 6, note: "demo 搭建" },
  ];
  for (const te of timeDefs) {
    await prisma.timeEntry.create({ data: { taskId: te.taskId, userId: te.userId, date: daysFromNow(te.date), hours: te.hours, note: te.note } });
  }

  console.log("== 评论示例 ==");
  await prisma.comment.createMany({
    data: [
      { entityType: "TASK", entityId: taskAsm.id, userId: pm.id, content: "ESP32 模组供应商承诺下周到货，请关注。", createdAt: daysFromNow(-2) },
      { entityType: "ECR", entityId: ecr1.id, userId: eng.id, content: "挂墙孔建议放在下壳，避开电池仓。", createdAt: daysFromNow(-1) },
    ],
  });

  console.log("== 全文索引重建 ==");
  await reindexAll();

  console.log("✅ Seed 完成");
  console.log("   账号: admin@demo.com / pm@demo.com / eng@demo.com / guest@demo.com  密码: Demo@123456");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
