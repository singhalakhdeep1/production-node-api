exports.up = function(db) {
  return db.createTable('api_keys', {
    id: { type: 'uuid', primaryKey: true, defaultValue: new String('uuid_generate_v4()') },
    key_hash: { type: 'string', notNull: true, unique: true },
    name: { type: 'string', notNull: true },
    scopes: { type: 'json', notNull: true },
    user_id: { 
      type: 'uuid', 
      notNull: true,
      foreignKey: {
        name: 'api_keys_user_id_foreign',
        table: 'users',
        rules: {
          onDelete: 'CASCADE'
        }
      }
    },
    is_active: { type: 'boolean', notNull: true, defaultValue: true },
    expires_at: { type: 'timestamp' },
    last_used_at: { type: 'timestamp' },
    created_at: { type: 'timestamp', notNull: true, defaultValue: new String('NOW()') }
  });
};

exports.down = function(db) {
  return db.dropTable('api_keys');
};
