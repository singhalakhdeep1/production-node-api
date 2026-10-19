import bcrypt from 'bcryptjs';
import { config } from '../config';
import { query } from '../db/pool';
import { HttpError } from '../http-error';

export type Role = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password: string;
  created_at: Date;
  updated_at: Date;
}

let cachedDummyHash: string | undefined;
const dummyHash = () => (cachedDummyHash ??= bcrypt.hashSync('timing-equaliser', config.auth.bcryptRounds));

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export const UserModel = {
  async create(input: { email: string; password: string; name: string }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    const hash = await bcrypt.hash(input.password, config.auth.bcryptRounds);
    const role: Role = config.auth.adminEmails.includes(email) ? 'admin' : 'user';
    try {
      const { rows } = await query<UserRow>(
        `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING *`,
        [email, hash, input.name.trim(), role],
      );
      return toUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'Email is already registered');
      throw error;
    }
  },

  /** Returns the user for valid credentials; a constant-time-ish compare runs even for unknown emails. */
  async authenticate(email: string, password: string): Promise<User> {
    const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const row = rows[0];
    const ok = await bcrypt.compare(password, row?.password ?? dummyHash());
    if (!row || !ok) throw new HttpError(401, 'Invalid email or password');
    return toUser(row);
  },

  async findById(id: string): Promise<User | null> {
    const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  },

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = ANY($1::uuid[])', [ids]);
    return rows.map(toUser);
  },

  async update(id: string, patch: { name?: string; email?: string }): Promise<User> {
    try {
      const { rows } = await query<UserRow>(
        `UPDATE users SET name = COALESCE($2, name), email = COALESCE($3, email), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, patch.name?.trim() ?? null, patch.email?.trim().toLowerCase() ?? null],
      );
      if (!rows[0]) throw new HttpError(404, 'User not found');
      return toUser(rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'Email is already registered');
      throw error;
    }
  },

  async count(): Promise<number> {
    const { rows } = await query<{ count: string }>('SELECT count(*) FROM users');
    return Number(rows[0].count);
  },
};
