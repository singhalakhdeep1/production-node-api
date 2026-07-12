const { gql } = require('graphql-tag');

const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
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

  type Query {
    me: User
    todos: [Todo]
    todo(id: ID!): Todo
  }

  type Mutation {
    createTodo(title: String!, description: String): Todo
    updateTodo(id: ID!, title: String, description: String, completed: Boolean): Todo
    deleteTodo(id: ID!): Boolean
    register(email: String!, password: String!, name: String!): AuthPayload
    login(email: String!, password: String!): AuthPayload
  }

  type Subscription {
    todoUpdated: Todo
  }

  type AuthPayload {
    token: String
    user: User
  }
`;

module.exports = typeDefs;
