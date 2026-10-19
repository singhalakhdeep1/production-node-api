import type { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { API_KEY_SCOPES } from '../auth/api-key';
import { HttpError } from '../http-error';

const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/\d/, 'digit')
  .pattern(/[^A-Za-z\d]/, 'symbol')
  .messages({ 'string.pattern.name': 'Password must contain at least one {#name} character' });

export const userSchemas = {
  register: Joi.object({
    email: Joi.string().email().max(255).required(),
    password: password.required(),
    name: Joi.string().trim().min(2).max(100).required(),
  }),
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().max(128).required(),
  }),
  update: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    email: Joi.string().email().max(255),
  }).min(1),
};

export const todoSchemas = {
  create: Joi.object({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().allow('', null).max(1000),
    completed: Joi.boolean().default(false),
  }),
  update: Joi.object({
    title: Joi.string().trim().min(1).max(200),
    description: Joi.string().allow('', null).max(1000),
    completed: Joi.boolean(),
  }).min(1),
  list: Joi.object({
    completed: Joi.boolean(),
    search: Joi.string().trim().max(100).allow(''),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    sort: Joi.string().valid('created_at', 'updated_at', 'title').default('created_at'),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const apiKeySchemas = {
  create: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    scopes: Joi.array().items(Joi.string().valid(...API_KEY_SCOPES)).min(1).unique().default(['read']),
    expiresInDays: Joi.number().integer().min(1).max(3650),
  }),
};

export const uuidParam = Joi.object({ id: Joi.string().guid({ version: ['uuidv4', 'uuidv5', 'uuidv7'] }).required() });

type Source = 'body' | 'query' | 'params';

/** Validates and normalises `req[source]` (defaults applied, unknown keys stripped). */
export function validationMiddleware(schema: Joi.ObjectSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true, convert: true });
    if (error) {
      return next(new HttpError(400, 'Validation failed', error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))));
    }
    if (source === 'query') {
      // req.query is a getter in Express 5-compatible setups; keep the parsed copy separately.
      (req as Request & { validatedQuery?: unknown }).validatedQuery = value;
    } else {
      req[source] = value;
    }
    next();
  };
}

export function validateWith<T>(schema: Joi.Schema<T>, input: unknown): T {
  const { error, value } = schema.validate(input, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) throw new HttpError(400, 'Validation failed', error.details.map((d) => ({ field: d.path.join('.'), message: d.message })));
  return value;
}
