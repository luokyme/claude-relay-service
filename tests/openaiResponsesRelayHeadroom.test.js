const EventEmitter = require('events')

jest.mock('axios', () => jest.fn())

jest.mock('../config/config', () => ({
  requestTimeout: 1000
}))

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

jest.mock('../src/services/headroomConfigService', () => ({
  shouldUseHeadroom: jest.fn()
}))

const axios = require('axios')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const headroomConfigService = require('../src/services/headroomConfigService')
const service = require('../src/services/relay/openaiResponsesRelayService')

function createReq() {
  const req = new EventEmitter()
  req.method = 'POST'
  req.path = '/v1/responses'
  req.headers = { 'user-agent': 'codex_cli_rs/0.1.0' }
  req.body = { model: 'gpt-5-codex', input: 'hello', stream: false }
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

describe('OpenAI Responses relay Headroom routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'resp-1',
      name: 'Responses Account',
      apiKey: 'sk-test',
      baseApi: 'https://api.openai.com'
    })
    headroomConfigService.shouldUseHeadroom.mockResolvedValue({
      useHeadroom: true,
      reason: 'enabled',
      mode: 'enabled',
      config: {
        proxyBaseUrl: 'http://127.0.0.1:8787',
        fallbackOnError: true
      }
    })
    axios.mockResolvedValue({
      status: 200,
      data: { id: 'resp_1', model: 'gpt-5-codex' },
      headers: {}
    })
  })

  test('routes responses requests through Headroom when enabled', async () => {
    await service.handleRequest(
      createReq(),
      createRes(),
      { id: 'resp-1', name: 'Responses Account' },
      { id: 'key-1', openaiResponsesHeadroomMode: 'enabled' }
    )

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://127.0.0.1:8787/v1/responses'
      })
    )
  })

  test('normalizes bare responses route to /v1/responses for Headroom', async () => {
    const req = createReq()
    req.path = '/responses'

    await service.handleRequest(
      req,
      createRes(),
      { id: 'resp-1', name: 'Responses Account' },
      { id: 'key-1', openaiResponsesHeadroomMode: 'enabled' }
    )

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://127.0.0.1:8787/v1/responses'
      })
    )
  })

  test('falls back to original upstream when Headroom connection fails', async () => {
    const error = new Error('connect refused')
    error.code = 'ECONNREFUSED'
    axios.mockRejectedValueOnce(error).mockResolvedValueOnce({
      status: 200,
      data: { id: 'resp_2', model: 'gpt-5-codex' },
      headers: {}
    })

    await service.handleRequest(
      createReq(),
      createRes(),
      { id: 'resp-1', name: 'Responses Account' },
      { id: 'key-1', openaiResponsesHeadroomMode: 'enabled' }
    )

    expect(axios).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: 'http://127.0.0.1:8787/v1/responses' })
    )
    expect(axios).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: 'https://api.openai.com/v1/responses' })
    )
  })
})
