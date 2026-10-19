import crypto from 'node:crypto';
import { config } from '../config';
import { query } from '../db/pool';

export const API_KEY_SCOPES = ['read', 'write', 'upload', 'admin', '*'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  userId: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  user_id: string;
  is_active: boolean;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

const toRecord = (row: ApiKeyRow): ApiKeyRecord => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.key_prefix,
  scopes: row.scopes,
  userId: row.user_id,
  isActive: row.is_active,
  expiresAt: row.expires_at?.toISOString() ?? null,
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
});

/** API keys are random `pk_<64 hex>` strings; only their SHA-256 is stored. */
export class ApiKeyService {
  generateKey(): string {
    return `pk_${crypto.randomBytes(32).toString('hex')}`;
  }

  hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async createApiKey(userId: string, name: string, scopes: string[] = ['read'], expiresInDays = config.auth.apiKeyDefaultTtlDays) {
    const key = this.generateKey();
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const { rows } = await query<ApiKeyRow>(
      `INSERT INTO api_keys (key_hash, key_prefix, name, scopes, user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [this.hashKey(key), key.slice(0, 10), name, JSON.stringify(scopes), userId, expiresAt],
    );
    // The plaintext key is only ever returned here.
    return { ...toRecord(rows[0]), key };
  }

  async validateApiKey(key: string): Promise<ApiKeyRecord | null> {
    if (!/^pk_[0-9a-f]{64}$/.test(key)) return null;
    const { rows } = await query<ApiKeyRow>(
      `UPDATE api_keys SET last_used_at = now()
       WHERE key_hash = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > now())
       RETURNING *`,
      [this.hashKey(key)],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async revokeApiKey(keyId: string, userId: string): Promise<ApiKeyRecord | null> {
    const { rows } = await query<ApiKeyRow>(
      `UPDATE api_keys SET is_active = false WHERE id = $1 AND user_id = $2 RETURNING *`,
      [keyId, userId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async getUserApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    const { rows } = await query<ApiKeyRow>(
      `SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toRecord);
  }

  hasScope(apiKey: Pick<ApiKeyRecord, 'scopes'>, requiredScope: string): boolean {
    return apiKey.scopes.includes(requiredScope) || apiKey.scopes.includes('*');
  }
}

export const apiKeyService = new ApiKeyService();
