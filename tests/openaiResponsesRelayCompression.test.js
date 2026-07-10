const EventEmitter = require('events')

jest.mock('axios', () => jest.fn())

jest.mock('../config/config', () => ({
  requestTimeout: 1000
}), {
  virtual: true
})

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn()
}))

jest.mock('../src/services/apiKeyService', () => ({
  recordUsage: jest.fn()
}))

jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  markAccountRateLimited: jest.fn(),
  isAccountRateLimited: jest.fn().mockResolvedValue(false),
  removeAccountRateLimit: jest.fn(),
  _deleteSessionMapping: jest.fn()
}))

jest.mock('../src/services/codexRequestCompressionService', () => ({
  compressRequestBody: jest.fn()
}))

jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null),
  getProxyDescription: jest.fn(() => 'none')
}))

jest.mock('../src/utils/headerFilter', () => ({
  filterForOpenAI: jest.fn((headers) => ({ ...headers }))
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn(() => null),
  sanitizeErrorForClient: jest.fn((error) => error)
}))

jest.mock('../src/utils/requestDetailHelper', () => ({
  createRequestDetailMeta: jest.fn(() => null),
  extractOpenAICacheReadTokens: jest.fn(() => 0)
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

const axios = require('axios')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const codexRequestCompressionService = require('../src/services/codexRequestCompressionService')
const service = require('../src/services/relay/openaiResponsesRelayService')

function createReq() {
  const req = new EventEmitter()
  req.method = 'POST'
  req.path = '/v1/responses'
  req.headers = { 'user-agent': 'codex_cli_rs/0.1.0' }
  req.body = { model: 'gpt-5-codex', input: [{ output: 'x'.repeat(2000) }], stream: false }
  return req
}

function createRes() {
  const res = new EventEmitter()
  res.statusCode = 200
  res.headersSent = false
  res.destroyed = false
  res.status = jest.fn((code) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((payload) => {
    res.payload = payload
    return res
  })
  return res
}

describe('OpenAI Responses relay Codex request compression', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'resp-1',
      name: 'Responses Account',
      apiKey: 'sk-test',
      baseApi: 'https://api.openai.com'
    })
    codexRequestCompressionService.compressRequestBody.mockImplementation(async (body) => {
      body.input[0].output = 'compressed-output'
      return { enabled: true, compressedFields: 1, removedChars: 1983 }
    })
    axios.mockResolvedValue({
      status: 200,
      data: { id: 'resp_1', model: 'gpt-5-codex' },
      headers: {}
    })
  })

  test('compresses request body before forwarding to upstream', async () => {
    const req = createReq()

    await service.handleRequest(
      req,
      createRes(),
      { id: 'resp-1', name: 'Responses Account' },
      { id: 'key-1' }
    )

    expect(codexRequestCompressionService.compressRequestBody).toHaveBeenCalledWith(req.body)
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/responses',
        data: expect.objectContaining({
          input: [{ output: 'compressed-output' }]
        })
      })
    )
  })
})
