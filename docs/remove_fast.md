# API Key 页面支持移除 Fast/Priority 标记的改动指南

目标：在 API Key 列表中增加一个“默认 / 移除”快捷开关，用于控制 OpenAI Responses 请求体里的 `service_tier` 字段。

## 行为

- `默认`：不修改请求体。
- `移除`：转发前删除请求体中的 `service_tier` 字段。
- Fast/Priority 请求在 OpenAI Responses 请求体中表现为 `service_tier: "priority"`。
- 该功能使用独立 API Key 布尔字段 `removeOpenAIResponsesServiceTier`，不依赖 Payload 规则。

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

1. API Key 默认保存 `removeOpenAIResponsesServiceTier: false`。
2. API Key 列表能正确解析并展示该字段。
3. 点击列表中的“默认 / 移除”按钮会更新该字段。
4. 字段为 `true` 时，OpenAI Responses 转发前删除 `req.body.service_tier`。
5. 删除发生在记录 `_serviceTier` 前，避免后续计费仍读取到 `priority`。
