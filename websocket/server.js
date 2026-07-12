const WebSocket = require('ws');
const { authenticateToken } = require('../middleware/auth');
const { pubsub } = require('../graphql/server');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.clients = new Map();
    this.setupConnection();
  }

  setupConnection() {
    this.wss.on('connection', async (ws, req) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      try {
        const user = await authenticateToken(token);
        ws.user = user;
        this.clients.set(user.id, ws);
        
        ws.send(JSON.stringify({
          type: 'connected',
          message: 'WebSocket connected successfully',
          userId: user.id
        }));

        ws.on('message', (data) => {
          this.handleMessage(ws, data);
        });

        ws.on('close', () => {
          this.clients.delete(user.id);
          console.log(`User ${user.id} disconnected`);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
        });

      } catch (error) {
        ws.close(1008, 'Authentication failed');
      }
    });
  }

  handleMessage(ws, data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        
        case 'broadcast':
          this.broadcast(message.data, ws.user.id);
          break;
        
        case 'direct':
          this.sendToUser(message.userId, message.data);
          break;
        
        default:
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  }

  broadcast(data, excludeUserId = null) {
    const message = JSON.stringify({
      type: 'broadcast',
      data,
      timestamp: new Date().toISOString()
    });

    for (const [userId, client] of this.clients) {
      if (userId !== excludeUserId && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  sendToUser(userId, data) {
    const client = this.clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'direct',
        data,
        timestamp: new Date().toISOString()
      }));
    }
  }

  notifyTodoUpdate(todo) {
    this.broadcast({ type: 'todo_updated', todo });
    pubsub.publish('TODO_UPDATED', { todoUpdated: todo });
  }

  getConnectedUsers() {
    return Array.from(this.clients.keys());
  }

  getUserCount() {
    return this.clients.size;
  }
}

module.exports = WebSocketServer;
