jest.mock('../src/models/redis', () => ({
  getClient: jest.fn(),
  getClientSafe: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}))

const service = require('../src/services/codexRequestCompressionService')

describe('codexRequestCompressionService', () => {
  test('does not mutate body when disabled', () => {
    const body = {
      model: 'gpt-5-codex',
      input: [{ role: 'user', content: 'x'.repeat(2000) }]
    }

    const stats = service.compressBody(body, {
      enabled: false,
      minStringChars: 1000,
      headChars: 100,
      tailChars: 100,
      maxDepth: 12,
      includeInstructions: false
    })

    expect(stats).toEqual({ enabled: false, compressedFields: 0, removedChars: 0 })
    expect(body.input[0].content).toBe('x'.repeat(2000))
  })

  test('compresses long content fields inside responses input', () => {
    const longOutput = `start-${'x'.repeat(2000)}-end`
    const body = {
      model: 'gpt-5-codex',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: longOutput
        }
      ]
    }

    const stats = service.compressBody(body, {
      enabled: true,
      minStringChars: 1000,
      headChars: 100,
      tailChars: 100,
      maxDepth: 12,
      includeInstructions: false
    })

    expect(stats.compressedFields).toBe(1)
    expect(stats.removedChars).toBe(longOutput.length - 200)
    expect(body.input[0].output).toContain('[CRS compressed')
    expect(body.input[0].output.startsWith('start-')).toBe(true)
    expect(body.input[0].output.endsWith('-end')).toBe(true)
  })

  test('does not compress instructions unless explicitly enabled', () => {
    const instructions = 'i'.repeat(2000)
    const body = {
      instructions,
      input: 'hello'
    }

    service.compressBody(body, {
      enabled: true,
      minStringChars: 1000,
      headChars: 100,
      tailChars: 100,
      maxDepth: 12,
      includeInstructions: false
    })

    expect(body.instructions).toBe(instructions)
  })
})
