jest.mock(
  '../config/config',
  () => ({
    system: {
      timezoneOffset: 8
    }
  }),
  { virtual: true }
)

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  debug: jest.fn()
}))

const redis = require('../src/models/redis')

describe('redis api key parsing', () => {
  test('parses openai responses toggle and rule fields for list data', () => {
    const parsed = redis._parseApiKeyData({
      enableOpenAIResponsesCodexAdaptation: 'false',
      enableOpenAIResponsesPayloadRules: 'true',
      removeOpenAIResponsesServiceTier: 'true',
      openaiResponsesPayloadRules: JSON.stringify([
        { path: 'model', valueType: 'string', value: 'gpt-5' }
      ])
    })

    expect(parsed.enableOpenAIResponsesCodexAdaptation).toBe(false)
    expect(parsed.enableOpenAIResponsesPayloadRules).toBe(true)
    expect(parsed.removeOpenAIResponsesServiceTier).toBe(true)
    expect(parsed.openAIResponsesServiceTierMode).toBe('remove')
    expect(parsed.openaiResponsesPayloadRules).toEqual([
      { path: 'model', valueType: 'string', value: 'gpt-5' }
    ])
  })

  test('uses safe defaults for missing openai responses fields', () => {
    const parsed = redis._parseApiKeyData({})

    expect(parsed.enableOpenAIResponsesCodexAdaptation).toBe(true)
    expect(parsed.enableOpenAIResponsesPayloadRules).toBe(false)
    expect(parsed.removeOpenAIResponsesServiceTier).toBe(false)
    expect(parsed.openAIResponsesServiceTierMode).toBe('unchanged')
    expect(parsed.openaiResponsesPayloadRules).toEqual([])
  })

  test('prefers the explicit three-state service tier mode', () => {
    const parsed = redis._parseApiKeyData({
      removeOpenAIResponsesServiceTier: 'true',
      openAIResponsesServiceTierMode: 'force_priority'
    })

    expect(parsed.openAIResponsesServiceTierMode).toBe('force_priority')
  })
})
