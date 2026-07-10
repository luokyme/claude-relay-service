const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth')
const codexRequestCompressionService = require('../../services/codexRequestCompressionService')
const logger = require('../../utils/logger')

const router = express.Router()

router.get('/codex-request-compression-config', authenticateAdmin, async (req, res) => {
  try {
    const config = await codexRequestCompressionService.getConfig()
    return res.json({
      success: true,
      config
    })
  } catch (error) {
    logger.error('❌ Failed to get Codex request compression config:', error)
    return res.status(500).json({
      error: 'Failed to get Codex request compression config',
      message: error.message
    })
  }
})

router.put('/codex-request-compression-config', authenticateAdmin, async (req, res) => {
  try {
    const config = await codexRequestCompressionService.updateConfig(
      req.body || {},
      req.admin?.username || 'unknown'
    )
    return res.json({
      success: true,
      message: 'Codex request compression config updated successfully',
      config
    })
  } catch (error) {
    logger.error('❌ Failed to update Codex request compression config:', error)
    return res.status(400).json({
      error: 'Failed to update Codex request compression config',
      message: error.message
    })
  }
})

module.exports = router
