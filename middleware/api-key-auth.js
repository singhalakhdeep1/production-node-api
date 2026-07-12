const ApiKeyService = require('../auth/api-key');

const apiKeyService = new ApiKeyService(require('../db'));

async function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required'
    });
  }

  const keyData = await apiKeyService.validateApiKey(apiKey);

  if (!keyData) {
    return res.status(401).json({
      error: 'Invalid or expired API key'
    });
  }

  req.apiKey = keyData;
  req.user = { id: keyData.user_id };
  
  next();
}

function requireScope(scope) {
  return async (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({
        error: 'API key required'
      });
    }

    const hasScope = await apiKeyService.hasScope(req.apiKey, scope);

    if (!hasScope) {
      return res.status(403).json({
        error: `Insufficient permissions. Required scope: ${scope}`
      });
    }

    next();
  };
}

module.exports = { apiKeyAuth, requireScope };
