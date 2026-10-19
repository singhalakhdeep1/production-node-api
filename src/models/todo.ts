import { query } from '../db/pool';

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface TodoRow {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface TodoListOptions {
  completed?: boolean;
  search?: string;
  limit: number;
  offset: number;
  sort: 'created_at' | 'updated_at' | 'title';
  order: 'asc' | 'desc';
}

const toTodo = (row: TodoRow): Todo => ({
  id: row.id,
  title: row.title,
  description: row.description,
  completed: row.completed,
  userId: row.user_id,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export const TodoModel = {
  async findByUserId(userId: string, options: TodoListOptions): Promise<{ items: Todo[]; total: number }> {
    const where = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (options.completed !== undefined) {
      params.push(options.completed);
      where.push(`completed = $${params.length}`);
    }
    if (options.search) {
      params.push(`%${options.search.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    const whereSql = where.join(' AND ');
    // sort/order are whitelisted by the Joi schema before reaching here.
    const sortColumn = ['created_at', 'updated_at', 'title'].includes(options.sort) ? options.sort : 'created_at';
    const order = options.order === 'asc' ? 'ASC' : 'DESC';
    const [items, total] = await Promise.all([
      query<TodoRow>(
        `SELECT * FROM todos WHERE ${whereSql} ORDER BY ${sortColumn} ${order}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, options.limit, options.offset],
      ),
      query<{ count: string }>(`SELECT count(*) FROM todos WHERE ${whereSql}`, params),
    ]);
    return { items: items.rows.map(toTodo), total: Number(total.rows[0].count) };
  },

  async findById(id: string, userId: string): Promise<Todo | null> {
    const { rows } = await query<TodoRow>('SELECT * FROM todos WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] ? toTodo(rows[0]) : null;
  },

  async create(input: { title: string; description?: string | null; completed?: boolean; userId: string }): Promise<Todo> {
    const { rows } = await query<TodoRow>(
      `INSERT INTO todos (title, description, completed, user_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.title, input.description ?? null, input.completed ?? false, input.userId],
    );
    return toTodo(rows[0]);
  },

  async update(id: string, userId: string, patch: { title?: string; description?: string | null; completed?: boolean }): Promise<Todo | null> {
    const { rows } = await query<TodoRow>(
      `UPDATE todos SET
         title = COALESCE($3, title),
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         completed = COALESCE($6, completed),
         updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, patch.title ?? null, patch.description !== undefined, patch.description ?? null, patch.completed ?? null],
    );
    return rows[0] ? toTodo(rows[0]) : null;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await query('DELETE FROM todos WHERE id = $1 AND user_id = $2', [id, userId]);
    return (rowCount ?? 0) > 0;
  },

  async stats(userId: string): Promise<{ total: number; completed: number; open: number }> {
    const { rows } = await query<{ total: string; completed: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE completed) AS completed FROM todos WHERE user_id = $1`,
      [userId],
    );
    const total = Number(rows[0].total);
    const completed = Number(rows[0].completed);
    return { total, completed, open: total - completed };
  },
};
