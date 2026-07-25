'use strict'

const OPENAI_RESPONSES_SERVICE_TIER_MODES = Object.freeze({
  UNCHANGED: 'unchanged',
  FORCE_PRIORITY: 'force_priority',
  REMOVE: 'remove'
})

const VALID_MODES = new Set(Object.values(OPENAI_RESPONSES_SERVICE_TIER_MODES))

/**
 * Normalize the three-state service_tier setting while preserving compatibility
 * with API keys created before the enum field was introduced.
 */
function normalizeOpenAIResponsesServiceTierMode(mode, legacyRemoveValue = false) {
  if (VALID_MODES.has(mode)) {
    return mode
  }

  if (legacyRemoveValue === true || legacyRemoveValue === 'true') {
    return OPENAI_RESPONSES_SERVICE_TIER_MODES.REMOVE
  }

  return OPENAI_RESPONSES_SERVICE_TIER_MODES.UNCHANGED
}

module.exports = {
  OPENAI_RESPONSES_SERVICE_TIER_MODES,
  normalizeOpenAIResponsesServiceTierMode
}
