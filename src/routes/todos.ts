import { Router, type Request } from 'express';
import { requireAuth, requireScope } from '../middleware/auth';
import { principalRateLimiter } from '../middleware/rate-limit';
import type { TodoListOptions } from '../models/todo';
import { TodoService } from '../services/todo.service';
import { todoSchemas, uuidParam, validationMiddleware } from '../validation/schemas';

export const todosRouter = Router();
todosRouter.use(requireAuth, principalRateLimiter);

const userId = (req: Request) => req.user!.id;

todosRouter.get('/', requireScope('read'), validationMiddleware(todoSchemas.list, 'query'), async (req, res, next) => {
  try {
    const options = (req as Request & { validatedQuery: TodoListOptions }).validatedQuery;
    const result = await TodoService.list(userId(req), options);
    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

todosRouter.get('/stats', requireScope('read'), async (req, res, next) => {
  try {
    res.json(await TodoService.stats(userId(req)));
  } catch (error) {
    next(error);
  }
});

todosRouter.get('/:id', requireScope('read'), validationMiddleware(uuidParam, 'params'), async (req, res, next) => {
  try {
    const { todo, cached } = await TodoService.get(userId(req), req.params.id);
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.json(todo);
  } catch (error) {
    next(error);
  }
});

todosRouter.post('/', requireScope('write'), validationMiddleware(todoSchemas.create), async (req, res, next) => {
  try {
    const todo = await TodoService.create(userId(req), req.body);
    res.status(201).location(`/api/todos/${todo.id}`).json(todo);
  } catch (error) {
    next(error);
  }
});

const update = [requireScope('write'), validationMiddleware(uuidParam, 'params'), validationMiddleware(todoSchemas.update)];

todosRouter.patch('/:id', ...update, async (req, res, next) => {
  try {
    res.json(await TodoService.update(userId(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

todosRouter.put('/:id', ...update, async (req, res, next) => {
  try {
    res.json(await TodoService.update(userId(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

todosRouter.delete('/:id', requireScope('write'), validationMiddleware(uuidParam, 'params'), async (req, res, next) => {
  try {
    await TodoService.remove(userId(req), req.params.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
