import type { Redis } from 'ioredis';

/**
 * Travas distribuídas no Redis que garantem o isolamento entre contas e o
 * limite de paralelismo por cliente, independentemente de quantos workers
 * estejam rodando.
 */

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0`;

export const accountLockKey = (accountId: string) => `lock:account:${accountId}`;
export const tenantSlotsKey = (userId: string) => `slots:user:${userId}`;

/**
 * Lock exclusivo por conta. Re-entrante para o mesmo dono (o mesmo PublishJob
 * volta de um "delayed" e continua com a vaga).
 */
export async function acquireAccountLock(r: Redis, accountId: string, owner: string, ttlMs: number): Promise<boolean> {
  const key = accountLockKey(accountId);
  const ok = await r.set(key, owner, 'PX', ttlMs, 'NX');
  if (ok === 'OK') return true;
  return (await r.eval(EXTEND_SCRIPT, 1, key, owner, String(ttlMs))) === 1;
}

export async function releaseAccountLock(r: Redis, accountId: string, owner: string): Promise<void> {
  await r.eval(RELEASE_SCRIPT, 1, accountLockKey(accountId), owner);
}

export async function accountLockOwner(r: Redis, accountId: string): Promise<string | null> {
  return r.get(accountLockKey(accountId));
}

const SLOT_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local staleBefore = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
redis.call("zremrangebyscore", key, "-inf", staleBefore)
if redis.call("zscore", key, member) then
  redis.call("zadd", key, now, member)
  return 1
end
if redis.call("zcard", key) < limit then
  redis.call("zadd", key, now, member)
  redis.call("pexpire", key, ARGV[5])
  return 1
end
return 0`;

/**
 * Semáforo por cliente (plano → publicações simultâneas). Membros que não
 * renovam em `staleMs` são descartados, então um worker que morreu não segura
 * a vaga para sempre.
 */
export async function acquireTenantSlot(
  r: Redis,
  userId: string,
  member: string,
  limit: number,
  staleMs: number,
): Promise<boolean> {
  const now = Date.now();
  const res = await r.eval(SLOT_SCRIPT, 1, tenantSlotsKey(userId), member, String(now), String(now - staleMs), String(limit), String(staleMs * 2));
  return res === 1;
}

export async function releaseTenantSlot(r: Redis, userId: string, member: string): Promise<void> {
  await r.zrem(tenantSlotsKey(userId), member);
}
