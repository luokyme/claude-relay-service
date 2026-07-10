const redis = require('../models/redis')
const logger = require('../utils/logger')

const CONFIG_KEY = 'codex_request_compression_config'

const DEFAULT_CONFIG = {
  enabled: false,
  minStringChars: 24000,
  headChars: 4000,
  tailChars: 12000,
  maxDepth: 12,
  includeInstructions: false,
  updatedAt: null,
  updatedBy: null
}

const CONFIG_CACHE_TTL = 60000
const TOP_LEVEL_COMPRESSIBLE_FIELDS = new Set(['input', 'messages'])
const STRING_KEYS = new Set(['text', 'content', 'output', 'result', 'stdout', 'stderr'])

let configCache = null
let configCacheTime = 0

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  return value === true
}

function normalizeInteger(value, fallback, min, max, fieldName) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}`)
  }

  return parsed
}

function normalizeConfig(input = {}, current = DEFAULT_CONFIG) {
  const minStringChars = normalizeInteger(
    input.minStringChars,
    current.minStringChars || DEFAULT_CONFIG.minStringChars,
    1000,
    2000000,
    'minStringChars'
  )
  const headChars = normalizeInteger(
    input.headChars,
    current.headChars || DEFAULT_CONFIG.headChars,
    0,
    200000,
    'headChars'
  )
  const tailChars = normalizeInteger(
    input.tailChars,
    current.tailChars || DEFAULT_CONFIG.tailChars,
    100,
    200000,
    'tailChars'
  )

  if (headChars + tailChars >= minStringChars) {
    throw new Error('headChars + tailChars must be less than minStringChars')
  }

  return {
    enabled: normalizeBoolean(input.enabled, current.enabled === true),
    minStringChars,
    headChars,
    tailChars,
    maxDepth: normalizeInteger(
      input.maxDepth,
      current.maxDepth || DEFAULT_CONFIG.maxDepth,
      3,
      40,
      'maxDepth'
    ),
    includeInstructions: normalizeBoolean(
      input.includeInstructions,
      current.includeInstructions === true
    ),
    updatedAt: current.updatedAt || null,
    updatedBy: current.updatedBy || null
  }
}

function truncateString(value, cfg) {
  if (typeof value !== 'string' || value.length < cfg.minStringChars) {
    return { value, compressed: false, removedChars: 0 }
  }

  const head = cfg.headChars > 0 ? value.slice(0, cfg.headChars) : ''
  const tail = value.slice(value.length - cfg.tailChars)
  const removedChars = value.length - head.length - tail.length
  const marker = `\n\n[CRS compressed ${removedChars} chars from the middle of this field]\n\n`

  return {
    value: `${head}${marker}${tail}`,
    compressed: true,
    removedChars
  }
}

function shouldCompressString(path, withinCompressibleTopField, cfg) {
  if (!withinCompressibleTopField) {
    return false
  }

  const last = path[path.length - 1]
  if (STRING_KEYS.has(last)) {
    return true
  }

  if (path.length === 1 && TOP_LEVEL_COMPRESSIBLE_FIELDS.has(last)) {
    return true
  }

  if (last === 'instructions') {
    return cfg.includeInstructions === true
  }

  return false
}

function walk(node, cfg, state, path = [], depth = 0, withinCompressibleTopField = false) {
  if (depth > cfg.maxDepth || node === null || node === undefined) {
    return
  }

  if (typeof node !== 'object') {
    return
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const nextPath = path.concat(String(i))
      if (typeof node[i] === 'string') {
        if (shouldCompressString(nextPath, withinCompressibleTopField, cfg)) {
          const result = truncateString(node[i], cfg)
          if (result.compressed) {
            node[i] = result.value
            state.compressedFields += 1
            state.removedChars += result.removedChars
          }
        }
      } else {
        walk(node[i], cfg, state, nextPath, depth + 1, withinCompressibleTopField)
      }
    }
    return
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = path.concat(key)
    const nextWithinCompressibleTopField =
      withinCompressibleTopField || (path.length === 0 && TOP_LEVEL_COMPRESSIBLE_FIELDS.has(key))

    if (typeof value === 'string') {
      if (shouldCompressString(nextPath, nextWithinCompressibleTopField, cfg)) {
        const result = truncateString(value, cfg)
        if (result.compressed) {
          node[key] = result.value
          state.compressedFields += 1
          state.removedChars += result.removedChars
        }
      }
    } else {
      walk(value, cfg, state, nextPath, depth + 1, nextWithinCompressibleTopField)
    }
  }
}

class CodexRequestCompressionService {
  getDefaultConfig() {
    return { ...DEFAULT_CONFIG }
  }

  normalizeConfig(input = {}, current = DEFAULT_CONFIG) {
    return normalizeConfig(input, current)
  }

  async getConfig() {
    try {
      if (configCache && Date.now() - configCacheTime < CONFIG_CACHE_TTL) {
        return configCache
      }

      const client = redis.getClient()
      if (!client) {
        return this.getDefaultConfig()
      }

      const data = await client.get(CONFIG_KEY)
      configCache = data
        ? normalizeConfig(JSON.parse(data), DEFAULT_CONFIG)
        : this.getDefaultConfig()
      configCacheTime = Date.now()
      return configCache
    } catch (error) {
      logger.error('❌ Failed to get Codex request compression config:', error)
      return this.getDefaultConfig()
    }
  }

  async updateConfig(input = {}, updatedBy = 'unknown') {
    const client = redis.getClientSafe()
    const current = await this.getConfig()
    const updated = {
      ...normalizeConfig(input, current),
      updatedAt: new Date().toISOString(),
      updatedBy
    }

    await client.set(CONFIG_KEY, JSON.stringify(updated))
    configCache = updated
    configCacheTime = Date.now()

    logger.info(`✅ Codex request compression config updated by ${updatedBy}:`, {
      enabled: updated.enabled,
      minStringChars: updated.minStringChars,
      headChars: updated.headChars,
      tailChars: updated.tailChars
    })

    return updated
  }

  compressBody(body, config) {
    const cfg = normalizeConfig(config || DEFAULT_CONFIG, DEFAULT_CONFIG)
    const stats = {
      enabled: cfg.enabled === true,
      compressedFields: 0,
      removedChars: 0
    }

    if (!stats.enabled || !body || typeof body !== 'object' || Array.isArray(body)) {
      return stats
    }

    walk(body, cfg, stats)
    return stats
  }

  async compressRequestBody(body) {
    const cfg = await this.getConfig()
    return this.compressBody(body, cfg)
  }
}

module.exports = new CodexRequestCompressionService()
