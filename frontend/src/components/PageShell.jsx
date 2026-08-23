import { motion } from 'framer-motion';

/**
 * PageShell — cabeçalho comum às páginas.
 *
 * Props (inalteradas — 33 páginas dependem desta assinatura):
 *  icon      — elemento React
 *  title     — string
 *  subtitle  — string
 *  accent    — 'cyan' | 'purple' | 'gold' | 'green' | 'pink' | 'orange'
 *  actions   — ReactNode, botões à direita
 *  children  — conteúdo abaixo do cabeçalho
 */

/* O `accent` do tema antigo era uma cor solta por página, escolhida no olho.
   Aqui cada valor passa a apontar para o módulo correspondente do sistema, o
   que faz a cor do cabeçalho bater com a do item aceso na barra lateral. As
   chaves antigas continuam válidas para não obrigar as 33 páginas a mudar. */
const MODULO = {
  cyan:   'contas',
  purple: 'publicar',
  pink:   'campanhas',
  gold:   'jobs',
  orange: 'jobs',
  green:  'metricas',
};

export default function PageShell({ icon, title, subtitle, accent = 'cyan', actions, children }) {
  const mod = MODULO[accent] || 'contas';

  return (
    /* Sem `height:100%` e sem contêiner de rolagem próprio. A versão anterior
       criava um segundo eixo de rolagem dentro da página, então a barra
       lateral ficava parada enquanto o conteúdo rolava por dentro — e no
       celular isso deixava a página com duas barras concorrentes. Agora quem
       rola é a janela, que é o comportamento que o usuário espera do gesto. */
    <div style={{ '--mf-mod': `var(--mf-mod-${mod})`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .3, ease: [.4, 0, .2, 1] }}
        className="mf-page-head"
        /* Continua fixo ao rolar, como antes — mas agora ancorado abaixo da
           barra superior, que também é sticky. Sem esse deslocamento os dois
           disputariam a mesma faixa e o título sumiria atrás dela. */
        style={{
          position: 'sticky', top: 'var(--mf-topbar)', zIndex: 20,
          background: 'color-mix(in oklch, var(--mf-bg) 88%, transparent)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--mf-border)',
        }}
      >
        {icon && (
          <span style={{
            width: 38, height: 38, borderRadius: 'var(--mf-r-md)', flexShrink: 0,
            display: 'grid', placeItems: 'center',
            color: 'var(--mf-mod)',
            background: 'color-mix(in oklch, var(--mf-mod) 12%, transparent)',
            border: '1px solid color-mix(in oklch, var(--mf-mod) 26%, transparent)',
          }}>{icon}</span>
        )}

        <div className="mf-page-head__txt">
          {/* `text-wrap: balance` reparte um título de duas linhas em partes
              parecidas, em vez de deixar uma palavra órfã na segunda. */}
          <h1 className="mf-page-head__t" style={{ textWrap: 'balance' }}>{title}</h1>
          {subtitle && <p className="mf-page-head__s" style={{ textWrap: 'pretty' }}>{subtitle}</p>}
        </div>

        {actions && <div className="mf-page-head__acts">{actions}</div>}
      </motion.header>

      <div className="ps-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-5)', minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
