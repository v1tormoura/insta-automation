'use strict';

/**
 * Redis-based per-account rate limiter for Meta Graph API calls.
 * Tracks request counts per minute and per hour using atomic INCR + EXPIRE.
 */

const redis = require('../queue/connection');

const LIMITS = {
  minute: { max: 30,  ttl: 60   },
  hour:   { max: 200, ttl: 3600 },
};

async function checkRateLimit(accountId) {
  const prefix    = `rl:${accountId}`;
  const minuteKey = `${prefix}:min`;
  const hourKey   = `${prefix}:hr`;

  const [[, minuteCount], [, hourCount]] = await redis
    .pipeline()
    .incr(minuteKey)
    .incr(hourKey)
    .exec();

  const ttlPipe = redis.pipeline();
  if (minuteCount === 1) ttlPipe.expire(minuteKey, LIMITS.minute.ttl);
  if (hourCount   === 1) ttlPipe.expire(hourKey,   LIMITS.hour.ttl);
  if (minuteCount === 1 || hourCount === 1) await ttlPipe.exec();

  if (minuteCount > LIMITS.minute.max)
    return { limited: true, reason: `Limite de ${LIMITS.minute.max} req/min atingido para esta conta`, retryAfter: 60 };
  if (hourCount > LIMITS.hour.max)
    return { limited: true, reason: `Limite de ${LIMITS.hour.max} req/hora atingido para esta conta`, retryAfter: 3600 };

  return { limited: false };
}

async function resetRateLimit(accountId) {
  const prefix = `rl:${accountId}`;
  await redis.del(`${prefix}:min`, `${prefix}:hr`);
}

module.exports = { checkRateLimit, resetRateLimit };
