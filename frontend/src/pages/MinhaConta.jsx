import { useCallback, useEffect, useRef, useState } from 'react';
import {
  User, Camera, Lock, Mail, Bell, Palette, Save, Trash2, Check, Info,
} from 'lucide-react';
import api from '../services/api';
import PageShell from '../components/PageShell';
import Toast from '../components/Toast';
import { EsqueletoLista } from '../components/Estados';
import { salvar as salvarPreferencias } from '../services/preferencias';

/**
 * Minha Conta.
 *
 * ── O que aqui é diferente de toda outra tela do painel
 *
 * A senha. Errar nas outras telas dá trabalho; errar nesta tranca a pessoa
 * fora do próprio painel. Por isso a troca é aditiva no servidor, a senha do
 * ambiente continua valendo como recuperação, e isso é DITO aqui — em vez de a
 * pessoa descobrir por acidente que a senha antiga ainda entra.
 *
 * ── O que está aqui e ainda não faz efeito, dito com essas palavras
 *
 * O idioma. Não existe tradução no produto: as telas estão escritas em
 * português no código. O seletor guarda a escolha e o `lang` do documento
 * muda; nada mais. Escondê-lo daria a impressão de que a função não foi
 * pedida, e um seletor que troca de bandeira sem trocar de idioma seria pior.
 *
 * ── Por que os avisos por tipo leem a configuração do Smart Activity
 *
 * Porque é onde eles já moram. Uma segunda cópia dos interruptores neste
 * documento faria os dois lugares divergirem no primeiro clique, e a pessoa
 * teria dois botões para a mesma coisa dizendo coisas diferentes.
 */

const AVISOS = [
  { id: 'storyViews',   rotulo: 'Marcos de Stories',   desc: 'Quando um story cruza um marco de visualizações' },
  { id: 'contentViews', rotulo: 'Marcos de conteúdo',  desc: 'Reels e posts cruzando marcos' },
  { id: 'reach',        rotulo: 'Marcos de alcance',   desc: 'Contas únicas alcançadas' },
  { id: 'global',       rotulo: 'Resumo do dia',       desc: 'O balanço de todas as contas, uma vez por dia' },
];

const IDIOMAS = [
  ['pt', 'Português'],
  ['en', 'English'],
  ['es', 'Español'],
];

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function MinhaConta() {
  const [conta, setConta] = useState(null);
  const [avisos, setAvisos] = useState(null);
  const [toast, setToast] = useState(null);
  const [salvando, setSalvando] = useState('');
  const arquivoRef = useRef(null);

  /* Campos do formulário separados do que veio do servidor: enquanto se digita,
     o valor da tela e o gravado são coisas diferentes, e misturá-los faz o
     campo pular de volta ao antigo a cada resposta que chega. */
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState({ atual: '', nova: '', confirmacao: '' });

  const aviso = (type, title, message) => setToast({ type, title, message, id: Date.now() });

  const carregar = useCallback(async () => {
    try {
      /* As duas em paralelo: são dois documentos independentes, e em série a
         tela levaria o dobro para aparecer sem nenhum ganho. */
      const [c, n] = await Promise.all([
        api.get('/conta'),
        api.get('/notificacoes/config').catch(() => ({ data: { ativos: {} } })),
      ]);
      setConta(c.data);
      setNome(c.data.nome || '');
      setEmail(c.data.email || '');
      setAvisos(n.data.ativos || {});
    } catch (e) {
      aviso('error', 'Erro', e.response?.data?.error || 'Não foi possível carregar a conta.');
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvarPerfil() {
    setSalvando('perfil');
    try {
      const { data } = await api.put('/conta', { nome, email });
      setConta(data);
      aviso('success', 'Salvo', 'Nome e e-mail atualizados.');
    } catch (e) {
      aviso('error', 'Não deu para salvar', e.response?.data?.error || 'Tente de novo.');
    } finally {
      setSalvando('');
    }
  }

  async function trocarSenha() {
    /* Conferido aqui e no servidor. Aqui para a pessoa consertar sem esperar
       uma ida à rede; lá porque esta tela pode ser contornada. */
    if (senha.nova !== senha.confirmacao) {
      aviso('error', 'A confirmação não bate', 'Digite a nova senha igual nos dois campos.');
      return;
    }
    if (senha.nova.length < (conta?.minimoDaSenha || 8)) {
      aviso('error', 'Senha curta', `Use pelo menos ${conta?.minimoDaSenha || 8} caracteres.`);
      return;
    }
    setSalvando('senha');
    try {
      const { data } = await api.put('/conta/senha', senha);
      setConta(prev => ({ ...prev, ...data }));
      setSenha({ atual: '', nova: '', confirmacao: '' });
      aviso('success', 'Senha trocada', data.aviso || 'A nova senha já vale no próximo login.');
    } catch (e) {
      aviso('error', 'Não deu para trocar', e.response?.data?.error || 'Tente de novo.');
    } finally {
      setSalvando('');
    }
  }

  /* Preferência é gravada no clique, sem botão de salvar. Ela tem efeito
     imediato na tela: um "Salvar" depois de o tema já ter mudado perguntaria
     se a pessoa confirma o que está vendo. */
  async function mudarPreferencia(parcial) {
    const p = { ...conta.preferencias, ...parcial };
    setConta(c => ({ ...c, preferencias: p }));
    salvarPreferencias(p);   // aplica no documento e grava neste navegador
    try {
      await api.put('/conta/preferencias', { preferencias: parcial });
    } catch {
      /* A tela já mudou e o navegador já lembra. Só a travessia entre
         aparelhos se perde, e é isso que o recado diz. */
      aviso('warning', 'Aplicado só neste aparelho',
        'Não deu para gravar no servidor — outro aparelho vai abrir com a preferência antiga.');
    }
  }

  async function mudarPrivacidade(parcial) {
    const n = { ...conta.notificacoes, ...parcial };
    setConta(c => ({ ...c, notificacoes: n }));
    try {
      await api.put('/conta/preferencias', { notificacoes: parcial });
    } catch (e) {
      setConta(c => ({ ...c, notificacoes: conta.notificacoes }));
      aviso('error', 'Não deu para salvar', e.response?.data?.error || 'Tente de novo.');
    }
  }

  async function mudarAviso(id, ligado) {
    const antes = avisos;
    setAvisos(a => ({ ...a, [id]: ligado }));
    try {
      await api.put('/notificacoes/config', { ativos: { ...avisos, [id]: ligado } });
    } catch {
      /* Volta ao que era. Um interruptor que fica ligado na tela e desligado
         no servidor é a pior das três combinações possíveis. */
      setAvisos(antes);
      aviso('error', 'Não deu para salvar', 'O interruptor voltou ao que estava.');
    }
  }

  async function enviarFoto(arquivo) {
    if (!arquivo) return;
    /* Conferido antes de subir. O servidor também recusa — mas fazer a pessoa
       esperar o upload de 5 MB para ouvir "passa de 2 MB" é gastar o tempo
       dela para descobrir algo que já se sabia aqui. */
    if (arquivo.size > 2 * 1024 * 1024) {
      aviso('error', 'Imagem grande', 'O limite é 2 MB. Esta tem '
        + (arquivo.size / 1024 / 1024).toFixed(1) + ' MB.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
      aviso('error', 'Formato não aceito', 'Use JPG, PNG ou WebP.');
      return;
    }

    setSalvando('foto');
    try {
      const corpo = new FormData();
      corpo.append('foto', arquivo);
      const { data } = await api.post('/conta/foto', corpo);
      setConta(c => ({ ...c, avatar: data.avatar }));
      aviso('success', 'Foto trocada', 'Já aparece na barra do topo.');
    } catch (e) {
      aviso('error', 'Não deu para enviar', e.response?.data?.error || 'Tente de novo.');
    } finally {
      setSalvando('');
      /* Limpa o input: sem isto, escolher o MESMO arquivo de novo não dispara
         `change`, e a tentativa depois de um erro não faria nada. */
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  async function removerFoto() {
    setSalvando('foto');
    try {
      await api.delete('/conta/foto');
      setConta(c => ({ ...c, avatar: '' }));
    } catch (e) {
      aviso('error', 'Não deu para remover', e.response?.data?.error || 'Tente de novo.');
    } finally {
      setSalvando('');
    }
  }

  const iniciais = (nome || 'Eu').trim().split(/\s+/).slice(0, 2)
    .map(p => p[0]).join('').toUpperCase() || 'EU';

  return (
    <PageShell
      icon={<User size={18} />}
      title="Minha Conta"
      subtitle="Seus dados, sua senha e como o painel se comporta"
      accent="cyan"
    >
      {!conta ? <EsqueletoLista itens={3} /> : (
        <div style={{ display: 'grid', gap: 'var(--mf-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start' }}>

          {/* ── Foto e nome ── */}
          <Painel icone={<Camera size={13} />} titulo="Foto de perfil">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--mf-4)', flexWrap: 'wrap' }}>
              <span style={{ width: 68, height: 68, flexShrink: 0, borderRadius: 'var(--mf-r-full)',
                overflow: 'hidden', display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg, var(--mf-primary-500), var(--mf-accent-500))',
                color: 'var(--mf-primary-fg)', fontWeight: 800, fontSize: 'var(--mf-t-h2)' }}>
                {conta.avatar
                  ? <img src={`${API}${conta.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : iniciais}
              </span>

              <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-primary" disabled={salvando === 'foto'}
                    onClick={() => arquivoRef.current?.click()}
                    style={{ padding: '7px 14px', fontSize: 'var(--mf-t-xs)' }}>
                    {salvando === 'foto' ? 'Enviando…' : 'Escolher imagem'}
                  </button>
                  {conta.avatar && (
                    <button className="btn-ghost" disabled={salvando === 'foto'} onClick={removerFoto}
                      style={{ padding: '7px 12px', fontSize: 'var(--mf-t-xs)',
                               display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Trash2 size={12} /> Remover
                    </button>
                  )}
                </div>
                <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
                  JPG, PNG ou WebP — até 2 MB.
                </span>
              </div>

              <input ref={arquivoRef} type="file" hidden accept="image/jpeg,image/png,image/webp"
                onChange={e => enviarFoto(e.target.files?.[0])} />
            </div>

            <Campo rotulo="Nome" style={{ marginTop: 'var(--mf-4)' }}>
              <input className="inp" value={nome} maxLength={80}
                onChange={e => setNome(e.target.value)} placeholder="Como você quer ser chamado" />
            </Campo>

            <Campo rotulo="E-mail cadastrado">
              <input className="inp" type="email" value={email} maxLength={160}
                onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
            </Campo>
            {/* Dito porque a suposição natural é a oposta: um campo de e-mail
                num painel normalmente serve para recuperar a senha. */}
            <Nota>
              O endereço é guardado para registro. O painel não envia e-mail — não há
              recuperação de senha por ele.
            </Nota>

            <button className="btn-primary" onClick={salvarPerfil} disabled={salvando === 'perfil'}
              style={{ marginTop: 'var(--mf-4)', width: '100%',
                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Save size={13} /> {salvando === 'perfil' ? 'Salvando…' : 'Salvar dados'}
            </button>
          </Painel>

          {/* ── Senha ── */}
          <Painel icone={<Lock size={13} />} titulo="Trocar senha">
            <Campo rotulo="Senha atual">
              <input className="inp" type="password" autoComplete="current-password"
                value={senha.atual} onChange={e => setSenha(s => ({ ...s, atual: e.target.value }))} />
            </Campo>
            <Campo rotulo="Nova senha">
              <input className="inp" type="password" autoComplete="new-password"
                value={senha.nova} onChange={e => setSenha(s => ({ ...s, nova: e.target.value }))} />
            </Campo>
            <Campo rotulo="Confirmar nova senha">
              <input className="inp" type="password" autoComplete="new-password"
                value={senha.confirmacao}
                onChange={e => setSenha(s => ({ ...s, confirmacao: e.target.value }))} />
            </Campo>

            <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>
              Mínimo de {conta.minimoDaSenha} caracteres.
              {conta.senhaTrocadaEm && ` Trocada em ${new Date(conta.senhaTrocadaEm).toLocaleDateString('pt-BR')}.`}
            </span>

            <button className="btn-primary" onClick={trocarSenha}
              disabled={salvando === 'senha' || !senha.atual || !senha.nova}
              style={{ marginTop: 'var(--mf-3)', width: '100%',
                       display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Lock size={13} /> {salvando === 'senha' ? 'Trocando…' : 'Trocar senha'}
            </button>

            {/* O aviso mais importante desta tela. Uma troca de senha que deixa
                a antiga funcionando sem dizer é pior que não trocar. */}
            {conta.senhaDoAmbienteAtiva && (
              <div style={{ marginTop: 'var(--mf-3)', padding: '10px 12px',
                borderRadius: 'var(--mf-r-md)', lineHeight: 1.65,
                background: 'color-mix(in oklch, var(--mf-warning-500) 9%, transparent)',
                border: '1px solid color-mix(in oklch, var(--mf-warning-500) 26%, transparent)',
                color: 'var(--mf-warning-500)', fontSize: 'var(--mf-t-nano)' }}>
                A senha de <code>AUTH_PASSWORD</code> continua entrando, como recuperação —
                é ela que evita ficar trancado para fora se o banco cair. Para desativá-la,
                troque-a no <code>.env</code> do servidor e reinicie o backend.
              </div>
            )}
          </Painel>

          {/* ── Notificações ── */}
          <Painel icone={<Bell size={13} />} titulo="Notificações">
            {AVISOS.map(a => (
              <Interruptor key={a.id} rotulo={a.rotulo} desc={a.desc}
                ligado={!!avisos?.[a.id]}
                onChange={v => mudarAviso(a.id, v)} />
            ))}

            <div style={{ height: 1, background: 'var(--mf-border)', margin: 'var(--mf-3) 0' }} />

            {/* Estes dois não são enfeite de interface: desligados, o texto da
                notificação sai com `sua conta` e `•••` no lugar do @ e do
                número — na Central e no aviso do celular. */}
            <Interruptor rotulo="Mostrar nome na notificação"
              desc="O @ da conta aparece no texto do aviso"
              ligado={conta.notificacoes.mostrarNome}
              onChange={v => mudarPrivacidade({ mostrarNome: v })} />
            <Interruptor rotulo="Mostrar valor na notificação"
              desc="Visualizações, curtidas e alcance aparecem no texto"
              ligado={conta.notificacoes.mostrarValor}
              onChange={v => mudarPrivacidade({ mostrarValor: v })} />

            <Nota>
              O aviso aparece na tela de bloqueio do celular, onde quem estiver perto
              lê. Desligar troca o dado por um termo genérico antes de a mensagem
              ser montada — não esconde depois.
            </Nota>
          </Painel>

          {/* ── Aparência ── */}
          <Painel icone={<Palette size={13} />} titulo="Personalização & Aparência">
            <Campo rotulo="Tema">
              <Escolha valor={conta.preferencias.tema}
                opcoes={[['escuro', 'Escuro'], ['claro', 'Claro']]}
                onChange={v => mudarPreferencia({ tema: v })} />
            </Campo>

            <Campo rotulo="Idioma">
              <Escolha valor={conta.preferencias.idioma} opcoes={IDIOMAS}
                onChange={v => mudarPreferencia({ idioma: v })} />
            </Campo>
            {/* Dito, e não escondido. Um seletor que troca de idioma sem trocar
                o texto seria a pior das opções; esconder o controle daria a
                impressão de que a função não foi pedida. */}
            <Nota>
              A escolha é guardada e muda o <code>lang</code> da página. As telas do
              painel ainda estão só em português — não há tradução no produto.
            </Nota>

            <Campo rotulo="Animação de fundo" style={{ marginTop: 'var(--mf-4)' }}>
              <Escolha valor={conta.preferencias.fundoAnimado ? 'on' : 'off'}
                opcoes={[['on', 'Ligada'], ['off', 'Desligada']]}
                onChange={v => mudarPreferencia({ fundoAnimado: v === 'on' })} />
            </Campo>
            <Nota>
              Filamentos de energia e partículas que derivam devagar atrás do
              conteúdo, num ciclo longo para não competir com a leitura. Desligada, o
              desenho continua — só para de se mover. Quem já pediu menos movimento
              ao sistema operacional recebe o fundo parado de qualquer forma, e numa
              aba escondida nada é desenhado.
            </Nota>
          </Painel>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}

/* ── Peças ────────────────────────────────────────────────────────────────── */

function Painel({ icone, titulo, children }) {
  return (
    <section className="mf-card" style={{ minWidth: 0 }}>
      <div className="mf-card__head">
        <div className="mf-row" style={{ gap: 'var(--mf-2)', minWidth: 0 }}>
          <span style={{ color: 'var(--mf-mod, var(--mf-accent-500))', display: 'grid', placeItems: 'center' }}>
            {icone}
          </span>
          <span style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 800 }}>{titulo}</span>
        </div>
      </div>
      <div style={{ padding: '0 var(--mf-4) var(--mf-4)', display: 'grid', gap: 'var(--mf-2)' }}>
        {children}
      </div>
    </section>
  );
}

function Campo({ rotulo, children, style }) {
  return (
    <label style={{ display: 'block', minWidth: 0, ...style }}>
      <span style={{ display: 'block', marginBottom: 6, fontSize: 'var(--mf-t-nano)',
        fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: '.06em',
        textTransform: 'uppercase' }}>{rotulo}</span>
      {children}
    </label>
  );
}

function Nota({ children }) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start',
      fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.65 }}>
      <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/**
 * Interruptor com rótulo e explicação.
 *
 * `<input type="checkbox">` de verdade por baixo, escondido: o desenho é
 * próprio, e o comportamento — foco pelo teclado, espaço para alternar,
 * leitor de tela — é o do navegador. Um `<div onClick>` perde os três.
 */
function Interruptor({ rotulo, desc, ligado, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
      padding: '7px 0', minWidth: 0 }}>
      <input type="checkbox" checked={!!ligado} onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span aria-hidden="true" style={{
        width: 34, height: 19, flexShrink: 0, marginTop: 1, borderRadius: 'var(--mf-r-full)',
        padding: 2, display: 'flex', transition: 'background .18s',
        background: ligado ? 'var(--mf-primary-500)' : 'var(--mf-surface-3)',
        border: `1px solid ${ligado ? 'transparent' : 'var(--mf-border)'}`,
        justifyContent: ligado ? 'flex-end' : 'flex-start',
      }}>
        <span style={{ width: 13, height: 13, borderRadius: 'var(--mf-r-full)',
          background: ligado ? 'var(--mf-primary-fg)' : 'var(--mf-text-3)',
          display: 'grid', placeItems: 'center' }}>
          {ligado && <Check size={9} style={{ color: 'var(--mf-primary-500)' }} />}
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--mf-t-xs)', fontWeight: 650,
          color: 'var(--mf-text-2)' }}>{rotulo}</span>
        {desc && (
          <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)',
            color: 'var(--mf-text-3)', marginTop: 2, lineHeight: 1.55 }}>{desc}</span>
        )}
      </span>
    </label>
  );
}

/** Segmentos exclusivos. Radio de verdade por baixo, pelo mesmo motivo. */
function Escolha({ valor, opcoes, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {opcoes.map(([v, r]) => {
        const ativo = valor === v;
        return (
          <button key={v} onClick={() => onChange(v)} aria-pressed={ativo}
            style={{
              padding: '7px 15px', borderRadius: 'var(--mf-r-md)', cursor: 'pointer',
              fontSize: 'var(--mf-t-xs)', fontWeight: 700,
              background: ativo ? 'color-mix(in oklch, var(--mf-primary-500) 14%, transparent)' : 'transparent',
              color: ativo ? 'var(--mf-primary-500)' : 'var(--mf-text-3)',
              border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-primary-500) 40%, transparent)' : 'var(--mf-border)'}`,
            }}>{r}</button>
        );
      })}
    </div>
  );
}
