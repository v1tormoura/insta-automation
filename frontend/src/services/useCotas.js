import { useEffect, useState } from 'react';
import api from './api';

/**
 * A cota da API do Instagram por conta — 50 publicações em 24h.
 *
 * Desde que o teto diário saiu, a cota do Meta é a parede real, e a pessoa
 * decidia às cegas quantas mídias mandar para qual conta. Este hook traz o
 * uso de cada conta (`/accounts/cota`, que o backend guarda em cache de 60s)
 * e re-lê no mesmo ritmo; o Postar e a tela de Contas leem daqui.
 *
 * Devolve um mapa `accountId → { usage, limite, restante, cheia, libera }`.
 * Conta sem token da API não aparece no mapa — não tem cota da Graph.
 */
export function useCotas({ intervaloMs = 60_000 } = {}) {
  const [cotas, setCotas] = useState({});
  const [limite, setLimite] = useState(50);

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const r = await api.get('/accounts/cota');
        if (!vivo) return;
        const mapa = {};
        for (const c of r.data?.contas || []) if (c.disponivel) mapa[String(c.accountId)] = c;
        setCotas(mapa);
        if (r.data?.limite) setLimite(r.data.limite);
      } catch { /* sem cota, a tela só não mostra o chip */ }
    };
    ler();
    const t = setInterval(ler, intervaloMs);
    return () => { vivo = false; clearInterval(t); };
  }, [intervaloMs]);

  return { cotas, limite };
}

/** Hora curta ("14:20") de um ISO, ou ''. */
export function horaCurta(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

/**
 * Quantos dias um envio leva, limitado pela cota.
 *
 * Cada conta selecionada recebe TODAS as mídias; o gargalo é a conta com
 * menos cota restante hoje. Hoje cabem `restante`; o resto sai a 50 por dia.
 */
export function diasPelaCota({ midias, restanteMinimo, limite = 50 }) {
  if (!midias || midias <= 0) return 0;
  if (restanteMinimo == null) return null;
  if (midias <= restanteMinimo) return 1;
  return 1 + Math.ceil((midias - restanteMinimo) / limite);
}
