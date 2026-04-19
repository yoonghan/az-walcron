import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { dbRepo } from './db';
import { renderHtml } from './html';
import * as dotenv from 'dotenv';

dotenv.config();

// Create structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

const app = new Hono();

app.use('*', cors());

// Observability Middleware: Injection of request_id and structured logging
app.use('*', async (c, next) => {
  const reqIdHeader = c.req.header('x-request-id');
  const requestId = reqIdHeader || uuidv4();
  c.set('requestId', requestId);

  const start = Date.now();
  await next();
  const ms = Date.now() - start;

  logger.info({
    event: 'request',
    method: c.req.method,
    url: c.req.url,
    status: c.res.status,
    responseTimeMs: ms,
    request_id: requestId,
  });
});

app.get('/', (c) => {
  return c.html(renderHtml());
});

app.get('/healthz', (c) => {
  return c.text('ready');
});

app.get('/objectives', async (c) => {
  try {
    const objectives = await dbRepo.listObjectives();
    return c.json(objectives);
  } catch (err: any) {
    logger.error({ err: err.message, request_id: c.get('requestId') }, 'Failed to list objectives');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.get('/todos', async (c) => {
  try {
    const todos = await dbRepo.listTodos();
    return c.json(todos);
  } catch (err: any) {
    logger.error({ err: err.message, request_id: c.get('requestId') }, 'Failed to list todos');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.post('/todos', async (c) => {
  try {
    const body = await c.req.json();
    const newTodo = {
      id: uuidv4(),
      objective: body.objective,
      title: body.title,
      completed: false,
    };
    const created = await dbRepo.createTodo(newTodo);
    return c.json(created, 201);
  } catch (err: any) {
    logger.error({ err: err.message, request_id: c.get('requestId') }, 'Failed to create todo');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.put('/todos/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const updated = await dbRepo.updateTodo(id, body.objective, body.title, body.completed);
    
    if (!updated) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json(updated);
  } catch (err: any) {
    logger.error({ err: err.message, request_id: c.get('requestId') }, 'Failed to update todo');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.delete('/todos/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const objective = c.req.query('objective');
    
    if (!objective) {
      return c.json({ error: 'Missing objective query parameter' }, 400);
    }

    const deleted = await dbRepo.deleteTodo(id, objective);
    if (!deleted) {
      return c.json({ error: 'Not found' }, 404);
    }
    return new Response(null, { status: 204 });
  } catch (err: any) {
    logger.error({ err: err.message, request_id: c.get('requestId') }, 'Failed to delete todo');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

logger.info({ event: 'startup', message: `Server is starting on port ${port}` });

serve({
  fetch: app.fetch,
  port
});
