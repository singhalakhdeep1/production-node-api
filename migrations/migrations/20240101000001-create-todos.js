exports.up = function(db) {
  return db.createTable('todos', {
    id: { type: 'uuid', primaryKey: true, defaultValue: new String('uuid_generate_v4()') },
    title: { type: 'string', notNull: true },
    description: { type: 'text' },
    completed: { type: 'boolean', notNull: true, defaultValue: false },
    user_id: { 
      type: 'uuid', 
      notNull: true,
      foreignKey: {
        name: 'todos_user_id_foreign',
        table: 'users',
        rules: {
          onDelete: 'CASCADE'
        }
      }
    },
    created_at: { type: 'timestamp', notNull: true, defaultValue: new String('NOW()') },
    updated_at: { type: 'timestamp', notNull: true, defaultValue: new String('NOW()') }
  });
};

exports.down = function(db) {
  return db.dropTable('todos');
};
