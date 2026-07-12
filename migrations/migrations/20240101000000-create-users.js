exports.up = function(db) {
  return db.createTable('users', {
    id: { type: 'uuid', primaryKey: true, defaultValue: new String('uuid_generate_v4()') },
    email: { type: 'string', notNull: true, unique: true },
    password: { type: 'string', notNull: true },
    name: { type: 'string', notNull: true },
    created_at: { type: 'timestamp', notNull: true, defaultValue: new String('NOW()') },
    updated_at: { type: 'timestamp', notNull: true, defaultValue: new String('NOW()') }
  });
};

exports.down = function(db) {
  return db.dropTable('users');
};
