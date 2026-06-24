const axios = require('axios')
const redis = require('../models/redis')
const logger = require('../utils/logger')

const CONFIG_KEY = 'headroom_config'

const DEFAULT_CONFIG = {
  enabled: false,
  proxyBaseUrl: 'http://127.0.0.1:8787',
  healthCheckEnabled: true,
  healthCheckTtlMs: 30000,
  requestTimeoutMs: 10000,
  fallbackOnError: true,
  updatedAt: null,
  updatedBy: null
}

const CONFIG_CACHE_TTL = 60000
let configCache = null
let configCacheTime = 0

let healthCache = null
let healthCacheTime = 0

function normalizeProxyBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return DEFAULT_CONFIG.proxyBaseUrl
  }

  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('proxyBaseUrl must use http or https')
  }

  return raw.replace(/\/+$/, '')
}

function normalizeNumber(value, fallback, min, max, fieldName) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

function normalizeMode(value) {
  if (value === undefined || value === null || value === '') {
    return 'inherit'
  }
  if (['inherit', 'enabled', 'disabled'].includes(value)) {
    return value
  }
  return 'inherit'
}

class HeadroomConfigService {
  getDefaultConfig() {
    return { ...DEFAULT_CONFIG }
  }

  normalizeOverrideMode(value) {
    return normalizeMode(value)
  }

  normalizeConfig(input = {}, current = DEFAULT_CONFIG) {
    return {
      enabled:
        input.enabled === undefined ? current.enabled === true : input.enabled === true,
      proxyBaseUrl:
        input.proxyBaseUrl === undefined
          ? current.proxyBaseUrl || DEFAULT_CONFIG.proxyBaseUrl
          : normalizeProxyBaseUrl(input.proxyBaseUrl),
      healthCheckEnabled:
        input.healthCheckEnabled === undefined
          ? current.healthCheckEnabled !== false
          : input.healthCheckEnabled === true,
      healthCheckTtlMs: normalizeNumber(
        input.healthCheckTtlMs,
        current.healthCheckTtlMs || DEFAULT_CONFIG.healthCheckTtlMs,
        5000,
        300000,
        'healthCheckTtlMs'
      ),
      requestTimeoutMs: normalizeNumber(
        input.requestTimeoutMs,
        current.requestTimeoutMs || DEFAULT_CONFIG.requestTimeoutMs,
        1000,
        60000,
        'requestTimeoutMs'
      ),
      fallbackOnError:
        input.fallbackOnError === undefined
          ? current.fallbackOnError !== false
          : input.fallbackOnError === true,
      updatedAt: current.updatedAt || null,
      updatedBy: current.updatedBy || null
    }
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
      if (data) {
        configCache = this.normalizeConfig(JSON.parse(data), DEFAULT_CONFIG)
      } else {
        configCache = this.getDefaultConfig()
      }
      configCacheTime = Date.now()
      return configCache
    } catch (error) {
      logger.error('❌ Failed to get Headroom config:', error)
      return this.getDefaultConfig()
    }
  }

  async updateConfig(input = {}, updatedBy = 'unknown') {
    const client = redis.getClientSafe()
    const current = await this.getConfig()
    const updated = {
      ...this.normalizeConfig(input, current),
      updatedAt: new Date().toISOString(),
      updatedBy
    }

    await client.set(CONFIG_KEY, JSON.stringify(updated))
    configCache = updated
    configCacheTime = Date.now()
    healthCache = null
    healthCacheTime = 0

    logger.info(`✅ Headroom config updated by ${updatedBy}:`, {
      enabled: updated.enabled,
      proxyBaseUrl: updated.proxyBaseUrl,
      fallbackOnError: updated.fallbackOnError
    })

    return updated
  }

  async testConnection(configOverride = null) {
    const cfg = configOverride || (await this.getConfig())
    const proxyBaseUrl = normalizeProxyBaseUrl(cfg.proxyBaseUrl)
    const timeout = cfg.requestTimeoutMs || DEFAULT_CONFIG.requestTimeoutMs
    const url = `${proxyBaseUrl}/readyz`

    const startedAt = Date.now()
    try {
      const response = await axios.get(url, {
        timeout,
        validateStatus: () => true
      })
      const latencyMs = Date.now() - startedAt
      const healthy = response.status >= 200 && response.status < 300
      return {
        success: healthy,
        status: response.status,
        latencyMs,
        data: response.data,
        message: healthy ? 'Headroom proxy is ready' : `Headroom readyz returned ${response.status}`
      }
    } catch (error) {
      return {
        success: false,
        status: null,
        latencyMs: Date.now() - startedAt,
        error: error.message,
        message: `Headroom proxy check failed: ${error.message}`
      }
    }
  }

  async isHealthy(cfg) {
    if (!cfg.healthCheckEnabled) {
      return true
    }

    const ttl = cfg.healthCheckTtlMs || DEFAULT_CONFIG.healthCheckTtlMs
    if (healthCache && Date.now() - healthCacheTime < ttl) {
      return healthCache.success === true
    }

    healthCache = await this.testConnection(cfg)
    healthCacheTime = Date.now()
    return healthCache.success === true
  }

  async shouldUseHeadroom(apiKeyData = {}) {
    const cfg = await this.getConfig()
    const mode = normalizeMode(apiKeyData.openaiResponsesHeadroomMode)

    if (mode === 'disabled') {
      return { useHeadroom: false, config: cfg, mode, reason: 'api_key_disabled' }
    }

    const enabled = mode === 'enabled' || cfg.enabled === true
    if (!enabled) {
      return { useHeadroom: false, config: cfg, mode, reason: 'global_disabled' }
    }

    const healthy = await this.isHealthy(cfg)
    return {
      useHeadroom: healthy,
      config: cfg,
      mode,
      reason: healthy ? 'enabled' : 'health_check_failed'
    }
  }
}

module.exports = new HeadroomConfigService()
