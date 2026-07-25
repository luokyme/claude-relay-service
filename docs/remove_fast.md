# API Key 页面支持移除 Fast/Priority 标记的改动指南

目标：在 API Key 列表中提供“不改变 / 强制增加 / 移除”三态开关，用于控制 OpenAI Responses 请求体里的 `service_tier` 字段。

## 行为

- `不改变`：不修改请求体。
- `强制增加`：将请求体的 `service_tier` 设置为 `"priority"`。
- `移除`：转发前删除请求体中的 `service_tier` 字段。
- Fast/Priority 请求在 OpenAI Responses 请求体中表现为 `service_tier: "priority"`。
- 该功能使用独立 API Key 枚举字段 `openAIResponsesServiceTierMode`，可选值为
  `unchanged`、`force_priority`、`remove`，不依赖 Payload 规则。
- 旧字段 `removeOpenAIResponsesServiceTier: true` 会兼容映射为 `remove`。

## 需要修改的文件

- `src/services/apiKeyService.js`
- `src/routes/admin/apiKeys.js`
- `src/middleware/auth.js`
- `src/routes/openaiRoutes.js`
- `src/models/redis.js`
- `web/admin-spa/src/views/ApiKeysView.vue`
- 相关测试：
  - `tests/apiKeyServiceOpenAIResponsesConfig.test.js`
  - `tests/openaiResponsesPayloadToggles.test.js`
  - `tests/redisApiKeyParse.test.js`

## 验证点

1. API Key 默认保存 `openAIResponsesServiceTierMode: "unchanged"`。
2. API Key 列表能正确解析并展示该字段。
3. 点击列表中的任一状态按钮会更新该字段。
4. `force_priority` 会在转发前设置 `req.body.service_tier = "priority"`。
5. `remove` 会在转发前删除 `req.body.service_tier`。
6. 三态处理发生在记录 `_serviceTier` 前，确保后续计费读取最终值。
