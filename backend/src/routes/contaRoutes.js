'use strict';

/**
 * Minha Conta — nome, foto, senha, e-mail, preferências.
 *
 * ── O que estas rotas mexem que é delicado
 *
 * A senha. Errar aqui tranca a pessoa fora do próprio painel, então a troca é
 * ADITIVA: grava um hash novo e a senha do ambiente continua valendo como
 * recuperação (ver o comentário no modelo Usuario). Nada nesta rota apaga o
 * caminho de entrada anterior.
 *
 * ── Por que o e-mail é só um campo
 *
 * O produto não envia e-mail — não há mailer, nem fila de envio, nem
 * verificação de endereço. Guardar o endereço é útil (é onde a pessoa anota
 * qual conta usa), e prometer recuperação de senha por ele seria inventar uma
 * função que não existe. A tela diz isso.
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Usuario = require('../models/Usuario');
const senhas = require('../services/senhaDoPainel');

const CHAVE = 'principal';

/* 2 MB, como diz a tela. O limite do multer é o que vale: a validação no
   navegador pode ser contornada, e um arquivo de 40 MB chegando até o disco
   é um problema de disco, não de interface. */
const LIMITE_BYTES = 2 * 1024 * 1024;

/* Só estes três. `image/*` aceitaria SVG, que é um documento com script
   dentro — servido de `/uploads` no mesmo domínio, executa como se fosse
   nosso. Lista fechada, não padrão aberto. */
const TIPOS = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (TIPOS[file.mimetype]) return cb(null, true);
    const erro = new Error('Use JPG, PNG ou WebP.');
    erro.code = 'TIPO_INVALIDO';
    cb(erro);
  },
});

const PASTA = path.resolve(__dirname, '../../uploads/perfil');

/**
 * O documento único, criado na primeira leitura.
 *
 * `+senhaHash` porque `publico()` precisa saber se EXISTE um hash — sem isto,
 * o campo vem de fora pelo `select: false` do schema e `temSenhaPropria` sai
 * `false` para sempre, inclusive depois de a senha ter sido trocada com
 * sucesso. Encontrado exercitando a rota, não lendo o código: o login com a
 * senha nova funcionava e a tela continuava dizendo que não havia senha
 * própria.
 *
 * O hash fica em memória aqui e não sai daqui: `publico()` é a única coisa que
 * vai para a resposta, e ele lista campo por campo.
 */
async function carregar() {
  const doc = await Usuario.findOneAndUpdate(
    { chave: CHAVE },
    { $setOnInsert: { chave: CHAVE } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).select('+senhaHash').lean();
  return doc;
}

/** O que pode sair na resposta. O hash nunca — nem quando é pedido de propósito. */
function publico(u) {
  return {
    nome:  u?.nome || '',
    email: u?.email || '',
    avatar: u?.avatar || '',
    temSenhaPropria: !!u?.senhaHash,
    senhaTrocadaEm: u?.senhaTrocadaEm || null,
    preferencias: {
      tema:   u?.preferencias?.tema   || 'escuro',
      idioma: u?.preferencias?.idioma || 'pt',
      fundoAnimado: u?.preferencias?.fundoAnimado !== false,
    },
    notificacoes: {
      mostrarNome:  u?.notificacoes?.mostrarNome  !== false,
      mostrarValor: u?.notificacoes?.mostrarValor !== false,
    },
    /* A tela mostra o requisito ANTES de a pessoa digitar. Vindo do serviço,
       mudar o mínimo num lugar muda os dois. */
    minimoDaSenha: senhas.MINIMO,
    /* Dito na tela porque é surpreendente: trocar a senha aqui não desliga a
       do ambiente. Esconder isso seria deixar a pessoa achar que a antiga
       parou de funcionar. */
    senhaDoAmbienteAtiva: true,
  };
}

router.get('/', async (_req, res) => {
  try {
    res.json(publico(await carregar()));
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'CONTA_ERRO' });
  }
});

/** Nome e e-mail. */
router.put('/', async (req, res) => {
  try {
    const alteracoes = {};

    if (typeof req.body?.nome === 'string') {
      alteracoes.nome = req.body.nome.trim().slice(0, 80);
    }

    if (typeof req.body?.email === 'string') {
      const email = req.body.email.trim().toLowerCase().slice(0, 160);
      /* Vazio é permitido: o campo é opcional, e obrigar um e-mail para poder
         salvar o NOME seria cobrar por uma coisa para entregar outra. */
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return res.status(400).json({ error: 'E-mail inválido.', code: 'EMAIL_INVALIDO' });
      }
      alteracoes.email = email;
    }

    if (!Object.keys(alteracoes).length) {
      return res.status(400).json({ error: 'Nada para alterar.', code: 'SEM_ALTERACAO' });
    }

    await Usuario.updateOne({ chave: CHAVE }, { $set: alteracoes }, { upsert: true });
    res.json(publico(await carregar()));
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'CONTA_ERRO' });
  }
});

/**
 * Troca a senha.
 *
 * Pede a ATUAL mesmo já estando autenticado. O token dura 30 dias: um aparelho
 * esquecido aberto num computador emprestado poderia trocar a senha e tomar a
 * conta sem nunca ter sabido a senha. Pedir a atual custa três segundos e
 * fecha isso.
 */
router.put('/senha', async (req, res) => {
  try {
    const { atual, nova, confirmacao } = req.body || {};

    if (typeof nova !== 'string' || typeof atual !== 'string') {
      return res.status(400).json({ error: 'Informe a senha atual e a nova.', code: 'FALTA_CAMPO' });
    }
    /* Confirmação conferida no servidor também. O campo existe para pegar erro
       de digitação, e um erro de digitação que passa aqui vira uma senha que
       ninguém conhece — sem forma de descobrir qual foi. */
    if (typeof confirmacao === 'string' && confirmacao !== nova) {
      return res.status(400).json({ error: 'A confirmação não bate com a nova senha.', code: 'CONFIRMACAO_DIFERE' });
    }
    if (nova === atual) {
      return res.status(400).json({ error: 'A nova senha é igual à atual.', code: 'SENHA_IGUAL' });
    }

    /* `+senhaHash` porque o campo é `select: false` no schema. */
    const doc = await Usuario.findOne({ chave: CHAVE }).select('+senhaHash');
    const guardado = doc?.senhaHash || '';

    /* Confere contra o hash quando existe; contra o ambiente quando é a
       primeira troca. Sem o segundo caso, ninguém conseguiria trocar a senha
       nunca: não haveria "atual" que a rota aceitasse. */
    const conferiu = guardado
      ? senhas.conferir(atual, guardado)
      : atual === (process.env.AUTH_PASSWORD || 'admin123');

    if (!conferiu) {
      return res.status(401).json({ error: 'A senha atual está incorreta.', code: 'SENHA_ATUAL_ERRADA' });
    }

    let hash;
    try {
      hash = senhas.gerar(nova);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'SENHA_INVALIDA' });
    }

    await Usuario.updateOne(
      { chave: CHAVE },
      { $set: { senhaHash: hash, senhaTrocadaEm: new Date() } },
      { upsert: true },
    );

    console.log('🔑 [Conta] Senha do painel trocada.');
    res.json({
      ok: true,
      /* Repetido na resposta e não só na tela: quem usa a API direto também
         precisa saber que a senha do ambiente continua entrando. */
      aviso: 'A senha de AUTH_PASSWORD continua valendo como recuperação. '
           + 'Troque-a no servidor se quiser desativá-la.',
      ...publico(await carregar()),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'SENHA_ERRO' });
  }
});

/** Preferências e privacidade dos avisos. Campo por campo, nunca o objeto inteiro. */
router.put('/preferencias', async (req, res) => {
  try {
    const p = req.body?.preferencias || {};
    const n = req.body?.notificacoes || {};
    const set = {};

    if (['escuro', 'claro'].includes(p.tema)) set['preferencias.tema'] = p.tema;
    if (['pt', 'en', 'es'].includes(p.idioma)) set['preferencias.idioma'] = p.idioma;
    if (typeof p.fundoAnimado === 'boolean') set['preferencias.fundoAnimado'] = p.fundoAnimado;
    if (typeof n.mostrarNome === 'boolean') set['notificacoes.mostrarNome'] = n.mostrarNome;
    if (typeof n.mostrarValor === 'boolean') set['notificacoes.mostrarValor'] = n.mostrarValor;

    if (!Object.keys(set).length) {
      return res.status(400).json({ error: 'Nada para alterar.', code: 'SEM_ALTERACAO' });
    }

    await Usuario.updateOne({ chave: CHAVE }, { $set: set }, { upsert: true });
    res.json(publico(await carregar()));
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'PREFERENCIA_ERRO' });
  }
});

/**
 * Foto de perfil.
 *
 * A extensão do arquivo segue o tipo enviado, em vez de tudo virar `.jpg`.
 * Gravar um PNG com nome `.jpg` funciona no navegador por adivinhação de
 * conteúdo — até o dia em que algo confia na extensão.
 *
 * O nome é fixo e a versão vai na URL. Sem `?v=`, trocar a foto reescreve o
 * mesmo caminho, o React vê o mesmo `src` e não repinta: a pessoa troca a
 * foto, o servidor grava certo, e a tela segue mostrando a antiga. Já
 * aconteceu com o avatar das contas — ver avatarLocal.js.
 */
router.post('/foto', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Nenhum arquivo recebido.', code: 'SEM_ARQUIVO' });
    }

    const ext = TIPOS[req.file.mimetype];
    if (!ext) {
      return res.status(400).json({ error: 'Use JPG, PNG ou WebP.', code: 'TIPO_INVALIDO' });
    }

    fs.mkdirSync(PASTA, { recursive: true });

    /* Apaga as outras extensões do mesmo nome. Sem isto, trocar um PNG por um
       JPG deixa os dois no disco para sempre — e é o tipo de lixo que só
       aparece quando o disco enche. */
    for (const outra of Object.values(TIPOS)) {
      if (outra === ext) continue;
      try { fs.unlinkSync(path.join(PASTA, `usuario${outra}`)); } catch { /* não existia */ }
    }

    fs.writeFileSync(path.join(PASTA, `usuario${ext}`), req.file.buffer);
    const caminho = `/uploads/perfil/usuario${ext}?v=${Date.now()}`;

    await Usuario.updateOne({ chave: CHAVE }, { $set: { avatar: caminho } }, { upsert: true });
    res.json({ ok: true, avatar: caminho });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'FOTO_ERRO' });
  }
});

/** Remove a foto. O arquivo sai do disco junto — guardar o que não é mais exibido é acúmulo. */
router.delete('/foto', async (_req, res) => {
  try {
    for (const ext of Object.values(TIPOS)) {
      try { fs.unlinkSync(path.join(PASTA, `usuario${ext}`)); } catch { /* não existia */ }
    }
    await Usuario.updateOne({ chave: CHAVE }, { $set: { avatar: '' } }, { upsert: true });
    res.json({ ok: true, avatar: '' });
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'FOTO_ERRO' });
  }
});

/**
 * Erros do multer chegam aqui, não no handler global.
 *
 * Sem isto, um arquivo de 5 MB devolve o texto cru "File too large" com status
 * 500 — sem código, sem menção ao limite, e a tela mostra "erro inesperado"
 * para um erro que ela sabia explicar.
 */
router.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: `A imagem passa de ${LIMITE_BYTES / 1024 / 1024} MB.`,
      code: 'ARQUIVO_GRANDE',
    });
  }
  if (err?.code === 'TIPO_INVALIDO') {
    return res.status(400).json({ error: err.message, code: 'TIPO_INVALIDO' });
  }
  res.status(500).json({ error: err?.message || 'Erro inesperado.', code: 'CONTA_ERRO' });
});

module.exports = router;
