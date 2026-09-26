import type { Schema } from 'mongoose';

/**
 * Rede de segurança do multi-tenant.
 *
 * Todo model com dados de cliente usa este plugin. Qualquer consulta ou
 * atualização sem `userId` no filtro lança erro — em vez de, silenciosamente,
 * ler ou alterar dados de todos os clientes. Rotinas de sistema (workers,
 * varreduras) que precisam atravessar tenants dizem isso explicitamente com
 * `.setOptions({ crossTenant: true })`.
 */
const GUARDED_OPS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;

export class TenantScopeError extends Error {
  constructor(model: string, op: string) {
    super(`Consulta sem userId em ${model}.${op} — use o escopo do tenant ou crossTenant explícito.`);
    this.name = 'TenantScopeError';
  }
}

export function tenantGuard(schema: Schema): void {
  for (const op of GUARDED_OPS) {
    schema.pre(op, function () {
      const options = this.getOptions() as { crossTenant?: boolean };
      if (options.crossTenant) return;
      const filter = this.getFilter() as Record<string, unknown>;
      if (filter.userId === undefined || filter.userId === null) {
        throw new TenantScopeError(this.model.modelName, op);
      }
    });
  }
  schema.pre('aggregate', function () {
    const options = this.options as { crossTenant?: boolean };
    if (options.crossTenant) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || first.$match.userId === undefined) {
      throw new TenantScopeError('aggregate', 'pipeline');
    }
  });
}
