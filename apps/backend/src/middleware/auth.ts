import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

async function attachAuthUser(req: Request): Promise<boolean> {
  const token = getBearerToken(req);

  if (!token) {
    return false;
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return false;
  }

  req.authUser = data.user;
  req.userId = data.user.id;
  return true;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const isAuthenticated = await attachAuthUser(req);

    if (!isAuthenticated) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    await attachAuthUser(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser || !req.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export function requireSameUser(paramName = 'userId') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.params[paramName] !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}
