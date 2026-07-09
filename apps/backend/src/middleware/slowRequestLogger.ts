import { NextFunction, Request, Response } from 'express';

const DEFAULT_SLOW_REQUEST_MS = 500;

function getSlowRequestThresholdMs() {
  const configuredThreshold = Number(process.env.SLOW_REQUEST_MS);
  return Number.isFinite(configuredThreshold) && configuredThreshold > 0
    ? configuredThreshold
    : DEFAULT_SLOW_REQUEST_MS;
}

export function slowRequestLogger(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production') {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const thresholdMs = getSlowRequestThresholdMs();

    if (durationMs >= thresholdMs) {
      console.warn(
        `[slow-api] ${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(durationMs)}ms`
      );
    }
  });

  next();
}
