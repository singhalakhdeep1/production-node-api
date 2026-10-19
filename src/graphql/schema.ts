export const typeDefs = /* GraphQL */ `
  type User {
    id: ID!
    email: String!
    name: String!
    role: String!
    createdAt: String!
  }

  type Todo {
    id: ID!
    title: String!
    description: String
    completed: Boolean!
    userId: ID!
    user: User
    createdAt: String!
    updatedAt: String!
  }

  type TodoPage {
    items: [Todo!]!
    total: Int!
    limit: Int!
    offset: Int!
    cached: Boolean!
  }

  type TodoStats {
    total: Int!
    completed: Int!
    open: Int!
  }

  type TodoEvent {
    type: String!
    todo: Todo!
    at: String!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type Query {
    me: User
    todos(completed: Boolean, search: String, limit: Int = 20, offset: Int = 0): TodoPage!
    todo(id: ID!): Todo
    todoStats: TodoStats!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    createTodo(title: String!, description: String, completed: Boolean): Todo!
    updateTodo(id: ID!, title: String, description: String, completed: Boolean): Todo!
    deleteTodo(id: ID!): Boolean!
  }

  type Subscription {
    "Fires for every create/update/delete on the subscriber's own todos."
    todoUpdated: TodoEvent!
  }
`;
