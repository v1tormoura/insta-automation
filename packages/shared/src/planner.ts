/**
 * Planejamento de horários de uma fila de publicação.
 *
 * Modelo: cada conta publica os conteúdos na ordem, separados por
 * `intervalMinutes`. Para o MESMO conteúdo, as contas são deslocadas entre si
 * por `accountStaggerMinutes` — assim 10 contas não publicam o mesmo vídeo no
 * mesmo segundo.
 *
 *   runAt(item i, conta j) = startAt + i·interval + j·stagger
 *
 * É uma função pura: o backend usa para criar os jobs e o editor usa a mesma
 * função para mostrar a linha do tempo antes de confirmar.
 */

export interface ScheduleInput {
  startAt: Date;
  itemCount: number;
  accountIds: readonly string[];
  intervalMinutes: number;
  accountStaggerMinutes: number;
}

export interface PlannedSlot {
  itemIndex: number;
  accountId: string;
  runAt: Date;
}

const MINUTE = 60_000;

export function planSchedule(input: ScheduleInput): PlannedSlot[] {
  const { startAt, itemCount, accountIds } = input;
  const interval = Math.max(0, input.intervalMinutes) * MINUTE;
  const stagger = Math.max(0, input.accountStaggerMinutes) * MINUTE;
  const base = startAt.getTime();

  const slots: PlannedSlot[] = [];
  for (let i = 0; i < itemCount; i++) {
    accountIds.forEach((accountId, j) => {
      slots.push({ itemIndex: i, accountId, runAt: new Date(base + i * interval + j * stagger) });
    });
  }
  return slots.sort(
    (a, b) => a.runAt.getTime() - b.runAt.getTime() || a.itemIndex - b.itemIndex,
  );
}

export function scheduleEndsAt(input: ScheduleInput): Date {
  const slots = planSchedule(input);
  return slots.length ? slots[slots.length - 1]!.runAt : input.startAt;
}
