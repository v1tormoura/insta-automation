'use strict';

/**
 * "Publicações enviadas" e "Envio concluído": o texto sai do modelo editável,
 * com os números do pacote, e o interruptor desliga.
 */

const banco = require('./helpers/banco');
const { sql } = banco;
const avisos = require('../src/services/smartActivity/eventosDePublicacao');
const settings = require('../src/repos/settings');
const thresholds = require('../src/services/smartActivity/thresholds');

beforeEach(() => banco.limpar());
afterAll(() => sql.end());

const doDono = () => sql`select * from notificacoes where usuario_id = ${banco.DONO_ID} order by criada_em`;

test('envio: "2 conta(s), 120 reels enviados para publicar"', async () => {
  await avisos.notificarEnvio({ usuarioId: banco.DONO_ID, origem: 'Postar', nome: 'Lote', contas: 2, publicacoes: 120, postType: 'reel' });
  const [n] = await doDono();
  expect(n.eventType).toBe('envioIniciado');
  expect(n.titulo).toBe('Publicações enviadas 📦');
  expect(n.mensagem).toBe('2 conta(s), 120 reels enviados para publicar.');
});

test('texto editado vale, e o interruptor desliga', async () => {
  await settings.gravar(thresholds.chaveDo(banco.DONO_ID), {
    mensagens: { envioConcluido: { titulo: 'Fim de {{nome}}', mensagem: '{{publicadas}} ok, {{falhas}} erro' } },
    ativos: { envioIniciado: false },
  });
  await avisos.notificarEnvio({ usuarioId: banco.DONO_ID, contas: 1, publicacoes: 1 });
  await avisos.notificarEnvioConcluido({ usuarioId: banco.DONO_ID, nome: 'Lote', publicadas: 118, falhas: 2 });
  const lista = await doDono();
  expect(lista).toHaveLength(1);
  expect(lista[0]).toMatchObject({ eventType: 'envioConcluido', titulo: 'Fim de Lote', mensagem: '118 ok, 2 erro' });
});

test('singular quando é um só', () => {
  expect(avisos._tipoNoPlural('reel', 1)).toBe('reel');
  expect(avisos._tipoNoPlural('story', 3)).toBe('stories');
  expect(avisos._tipoNoPlural('post', 2)).toBe('fotos');
});
