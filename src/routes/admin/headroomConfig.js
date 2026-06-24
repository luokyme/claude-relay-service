const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth')
const headroomConfigService = require('../../services/headroomConfigService')
const logger = require('../../utils/logger')

const router = express.Router()

router.get('/headroom-config', authenticateAdmin, async (req, res) => {
  try {
    const config = await headroomConfigService.getConfig()
    return res.json({ success: true, config })
  } catch (error) {
    logger.error('❌ Failed to get Headroom config:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get Headroom config',
      message: error.message
    })
  }
})

router.put('/headroom-config', authenticateAdmin, async (req, res) => {
  try {
    const config = await headroomConfigService.updateConfig(
      req.body || {},
      req.admin?.username || 'unknown'
    )
    return res.json({
      success: true,
      message: 'Headroom config updated successfully',
      config
    })
  } catch (error) {
    logger.error('❌ Failed to update Headroom config:', error)
    return res.status(400).json({
      success: false,
      error: 'Failed to update Headroom config',
      message: error.message
    })
  }
})

router.post('/headroom-config/test', authenticateAdmin, async (req, res) => {
  try {
    const current = await headroomConfigService.getConfig()
    const candidate = headroomConfigService.normalizeConfig(req.body || {}, current)
    const result = await headroomConfigService.testConnection(candidate)
    return res.status(result.success ? 200 : 503).json({
      success: result.success,
      result
    })
  } catch (error) {
    logger.error('❌ Failed to test Headroom config:', error)
    return res.status(400).json({
      success: false,
      error: 'Failed to test Headroom config',
      message: error.message
    })
  }
})

module.exports = router
