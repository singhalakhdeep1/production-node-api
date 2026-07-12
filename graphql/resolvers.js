const Todo = require('../models/Todo');
const User = require('../models/User');
const { generateToken } = require('../utils/auth');

const resolvers = {
  Query: {
    me: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      return user;
    },
    todos: async (_, __, { user }) => {
      if (!user) throw new Error('Not authenticated');
      return await Todo.findByUserId(user.id);
    },
    todo: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      return await Todo.findById(id);
    }
  },
  Mutation: {
    createTodo: async (_, { title, description }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const todo = await Todo.create({
        title,
        description,
        userId: user.id,
        completed: false
      });
      return todo;
    },
    updateTodo: async (_, { id, title, description, completed }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      const todo = await Todo.update(id, { title, description, completed });
      return todo;
    },
    deleteTodo: async (_, { id }, { user }) => {
      if (!user) throw new Error('Not authenticated');
      await Todo.delete(id);
      return true;
    },
    register: async (_, { email, password, name }) => {
      const user = await User.create({ email, password, name });
      const token = generateToken(user);
      return { token, user };
    },
    login: async (_, { email, password }) => {
      const user = await User.authenticate(email, password);
      const token = generateToken(user);
      return { token, user };
    }
  },
  Subscription: {
    todoUpdated: {
      subscribe: (_, __, { pubsub }) => pubsub.asyncIterator(['TODO_UPDATED'])
    }
  },
  Todo: {
    user: async (todo) => {
      return await User.findById(todo.userId);
    }
  }
};

module.exports = resolvers;
