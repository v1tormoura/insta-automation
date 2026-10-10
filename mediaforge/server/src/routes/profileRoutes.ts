import { processingSettingsSchema } from '@mediaforge/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newId } from '../security/filenames';
import { HttpError } from '../security/session';
import { profileToDTO } from '../services/dto';
import { idParam, notFound, session, type Deps } from './deps';

const profileBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe um nome')
    .max(60)
    .refine((v) => !/[\u0000-\u001F]/.test(v), 'Nome inválido'),
  settings: processingSettingsSchema,
});

/**
 * Perfis salvos são globais da instalação (sobrevivem à limpeza de sessões),
 * para reutilização em lotes futuros. Referências a arquivos auxiliares
 * (logotipo, trilha…) são validadas no momento do uso.
 */
export async function profileRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.get('/api/profiles', async (req, reply) => {
    await session(deps, req, reply);
    return ctx.repos.profiles().map(profileToDTO);
  });

  app.post('/api/profiles', async (req, reply) => {
    const s = await session(deps, req, reply);
    const body = profileBody.parse(req.body);
    if (ctx.repos.profileByName(body.name)) throw new HttpError(409, 'profile-exists', `Já existe um perfil chamado "${body.name}".`);
    const now = Date.now();
    const row = { id: newId(), name: body.name, mode: body.settings.mode, settings_json: JSON.stringify(body.settings), created_at: now, updated_at: now };
    ctx.repos.upsertProfile(row);
    ctx.history.add(s.id, 'profile', 'success', `Perfil salvo: ${body.name}`);
    reply.code(201);
    return profileToDTO(row);
  });

  app.put('/api/profiles/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const id = idParam(req);
    const existing = ctx.repos.profile(id);
    if (!existing) notFound('Perfil');
    const body = profileBody.parse(req.body);
    const clash = ctx.repos.profileByName(body.name);
    if (clash && clash.id !== id) throw new HttpError(409, 'profile-exists', `Já existe um perfil chamado "${body.name}".`);
    const row = { ...existing, name: body.name, mode: body.settings.mode, settings_json: JSON.stringify(body.settings), updated_at: Date.now() };
    ctx.repos.upsertProfile(row);
    ctx.history.add(s.id, 'profile', 'info', `Perfil atualizado: ${body.name}`);
    return profileToDTO(row);
  });

  app.delete('/api/profiles/:id', async (req, reply) => {
    const s = await session(deps, req, reply);
    const id = idParam(req);
    const existing = ctx.repos.profile(id);
    if (!existing) notFound('Perfil');
    ctx.repos.deleteProfile(id);
    ctx.history.add(s.id, 'profile', 'info', `Perfil excluído: ${existing.name}`);
    return { ok: true };
  });
}
