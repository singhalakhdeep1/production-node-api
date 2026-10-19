import { query } from '../db/pool';

export interface Upload {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  userId: string;
  todoId: string | null;
  url: string;
  createdAt: string;
}

interface UploadRow {
  id: string;
  filename: string;
  original_name: string;
  mimetype: string;
  size: string;
  user_id: string;
  todo_id: string | null;
  created_at: Date;
}

const toUpload = (row: UploadRow): Upload => ({
  id: row.id,
  filename: row.filename,
  originalName: row.original_name,
  mimetype: row.mimetype,
  size: Number(row.size),
  userId: row.user_id,
  todoId: row.todo_id,
  url: `/uploads/${row.filename}`,
  createdAt: row.created_at.toISOString(),
});

export const UploadModel = {
  async create(input: { filename: string; originalName: string; mimetype: string; size: number; userId: string; todoId?: string | null }): Promise<Upload> {
    const { rows } = await query<UploadRow>(
      `INSERT INTO uploads (filename, original_name, mimetype, size, user_id, todo_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.filename, input.originalName, input.mimetype, input.size, input.userId, input.todoId ?? null],
    );
    return toUpload(rows[0]);
  },

  async listByUser(userId: string, todoId?: string): Promise<Upload[]> {
    const { rows } = todoId
      ? await query<UploadRow>('SELECT * FROM uploads WHERE user_id = $1 AND todo_id = $2 ORDER BY created_at DESC', [userId, todoId])
      : await query<UploadRow>('SELECT * FROM uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [userId]);
    return rows.map(toUpload);
  },

  async findByFilename(filename: string): Promise<Upload | null> {
    const { rows } = await query<UploadRow>('SELECT * FROM uploads WHERE filename = $1', [filename]);
    return rows[0] ? toUpload(rows[0]) : null;
  },

  async delete(filename: string, userId: string): Promise<boolean> {
    const { rowCount } = await query('DELETE FROM uploads WHERE filename = $1 AND user_id = $2', [filename, userId]);
    return (rowCount ?? 0) > 0;
  },
};
