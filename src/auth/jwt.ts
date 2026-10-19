import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import type { Role, User } from '../models/user';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export function generateToken(user: Pick<User, 'id' | 'email' | 'role'>): string {
  return jwt.sign({ email: user.email, role: user.role }, config.auth.jwtSecret, {
    subject: user.id,
    expiresIn: config.auth.jwtExpiresIn as SignOptions['expiresIn'],
    issuer: config.serviceName,
  });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token.replace(/^Bearer\s+/i, ''), config.auth.jwtSecret, { issuer: config.serviceName });
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Malformed token');
  return { sub: decoded.sub, email: decoded.email as string, role: decoded.role as Role };
}
