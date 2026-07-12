const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class ApiKeyService {
  constructor(db) {
    this.db = db;
  }

  generateKey() {
    const prefix = 'pk_';
    const randomBytes = crypto.randomBytes(32).toString('hex');
    return `${prefix}${randomBytes}`;
  }

  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async createApiKey(userId, name, scopes = ['read'], expiresInDays = 365) {
    const key = this.generateKey();
    const keyHash = this.hashKey(key);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const result = await this.db.query(
      `INSERT INTO api_keys (key_hash, name, scopes, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [keyHash, name, JSON.stringify(scopes), userId, expiresAt]
    );

    return {
      ...result.rows[0],
      key // Only return the actual key on creation
    };
  }

  async validateApiKey(key) {
    const keyHash = this.hashKey(key);
    
    const result = await this.db.query(
      `SELECT * FROM api_keys 
       WHERE key_hash = $1 
       AND is_active = true 
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const apiKey = result.rows[0];

    // Update last used timestamp
    await this.db.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [apiKey.id]
    );

    return apiKey;
  }

  async revokeApiKey(keyId, userId) {
    const result = await this.db.query(
      `UPDATE api_keys 
       SET is_active = false 
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [keyId, userId]
    );

    return result.rows[0];
  }

  async getUserApiKeys(userId) {
    const result = await this.db.query(
      `SELECT id, name, scopes, is_active, expires_at, last_used_at, created_at
       FROM api_keys 
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  async hasScope(apiKey, requiredScope) {
    const scopes = Array.isArray(apiKey.scopes) ? apiKey.scopes : JSON.parse(apiKey.scopes);
    return scopes.includes(requiredScope) || scopes.includes('*');
  }
}

module.exports = ApiKeyService;
