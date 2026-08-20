# PLM 企业研发智能体运行手册索引

版本：1.0
日期：2026-08-13
状态：本地工程基线；生产签署前仍有阻断项

- [部署与验收](./DEPLOYMENT.md)
- [回滚与恢复](./ROLLBACK_AND_RECOVERY.md)
- [事故响应](./INCIDENT_RESPONSE.md)
- [模型切换](./MODEL_SWITCH.md)
- [保留与删除](./DATA_RETENTION_AND_DELETION.md)
- [生产验收矩阵](./PRODUCTION_ACCEPTANCE.md)
- [DeepSeek V4 Flash 真实模型验收](../agent-acceptance/PHASE_8_DEEPSEEK_V4_FLASH_LIVE_EVAL.md)

共同原则：WorkBuddy Pro 是唯一业务事实源；Worker 不直连业务数据库；模型仅能调用服务端注册的只读 Tool 或 proposal Tool；正式发布必须同时通过自动门禁、真实环境演练和项目负责人验收。
