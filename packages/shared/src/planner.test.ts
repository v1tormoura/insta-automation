import { describe, expect, it } from 'vitest';
import { planSchedule, scheduleEndsAt } from './planner.js';

const start = new Date('2026-10-01T12:00:00.000Z');
const at = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();

describe('planSchedule', () => {
  it('um conteúdo em várias contas é espaçado pelo stagger', () => {
    const slots = planSchedule({
      startAt: start,
      itemCount: 1,
      accountIds: ['a', 'b', 'c'],
      intervalMinutes: 30,
      accountStaggerMinutes: 5,
    });
    expect(slots.map((s) => [s.accountId, s.runAt.toISOString()])).toEqual([
      ['a', at(0)],
      ['b', at(5)],
      ['c', at(10)],
    ]);
  });

  it('vários conteúdos seguem a ordem, separados pelo intervalo em cada conta', () => {
    const slots = planSchedule({
      startAt: start,
      itemCount: 3,
      accountIds: ['a', 'b'],
      intervalMinutes: 60,
      accountStaggerMinutes: 0,
    });
    const forA = slots.filter((s) => s.accountId === 'a');
    expect(forA.map((s) => [s.itemIndex, s.runAt.toISOString()])).toEqual([
      [0, at(0)],
      [1, at(60)],
      [2, at(120)],
    ]);
    expect(slots).toHaveLength(6);
  });

  it('ordena cronologicamente e calcula o fim', () => {
    const input = { startAt: start, itemCount: 2, accountIds: ['a', 'b'], intervalMinutes: 10, accountStaggerMinutes: 3 };
    const slots = planSchedule(input);
    const times = slots.map((s) => s.runAt.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(scheduleEndsAt(input).toISOString()).toBe(at(13));
  });

  it('valores negativos viram zero', () => {
    const slots = planSchedule({ startAt: start, itemCount: 2, accountIds: ['a'], intervalMinutes: -5, accountStaggerMinutes: -1 });
    expect(slots.every((s) => s.runAt.getTime() === start.getTime())).toBe(true);
  });
});
