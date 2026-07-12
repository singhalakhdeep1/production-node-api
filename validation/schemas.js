const Joi = require('joi');

const userSchemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required(),
    name: Joi.string().min(2).max(100).required()
  }),
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  update: Joi.object({
    name: Joi.string().min(2).max(100),
    email: Joi.string().email()
  })
};

const todoSchemas = {
  create: Joi.object({
    title: Joi.string().min(1).max(200).required(),
    description: Joi.string().max(1000),
    completed: Joi.boolean().default(false)
  }),
  update: Joi.object({
    title: Joi.string().min(1).max(200),
    description: Joi.string().max(1000),
    completed: Joi.boolean()
  })
};

const apiKeySchemas = {
  create: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    scopes: Joi.array().items(Joi.string()).default(['read'])
  })
};

const validationMiddleware = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        error: 'Validation failed',
        errors
      });
    }
    
    next();
  };
};

module.exports = {
  userSchemas,
  todoSchemas,
  apiKeySchemas,
  validationMiddleware
};
