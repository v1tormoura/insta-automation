export default function Privacidade() {
  return (
    <div data-mf style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--mf-text)', fontFamily:'var(--font)', padding:'48px 16px' }}>
      <div style={{ maxWidth:720, margin:'0 auto' }}>

        <div style={{ marginBottom:40 }}>
          <a href="/" style={{ color:'var(--indigo)', fontSize: 'var(--mf-t-sm)', textDecoration:'none' }}>← Voltar</a>
          <h1 style={{ fontSize: 'var(--mf-t-display)', fontWeight:700, margin:'16px 0 4px' }}>Política de Privacidade</h1>
          <p style={{ color:'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>Última atualização: julho de 2026</p>
        </div>

        <div style={{ background:'color-mix(in oklch, var(--mf-primary-500) 7%, transparent)', border:'1px solid color-mix(in oklch, var(--mf-primary-500) 20%, transparent)', borderRadius: 'var(--mf-r-md)', padding:'16px 16px', marginBottom:32 }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', color:'var(--mf-text-2)', lineHeight:1.6 }}>
            <strong style={{ color:'var(--mf-text)' }}>Controlador dos dados:</strong> 67.761.040 VITOR MARCELO MOURA DA SILVA<br />
            <strong style={{ color:'var(--mf-text)' }}>CNPJ:</strong> 67.761.040/0001-27<br />
            <strong style={{ color:'var(--mf-text)' }}>Contato:</strong> contato@instaflow.pro
          </div>
        </div>

        {[
          { title:'1. Dados Coletados', text:'O MouraFlow coleta os seguintes dados para prestação do serviço: (a) dados de acesso à plataforma (usuário e senha criptografada); (b) tokens de acesso OAuth das contas do Instagram conectadas pelo usuário; (c) métricas públicas das contas gerenciadas (seguidores, publicações, engajamento); (d) mídia enviada pelo usuário para agendamento (imagens e vídeos).' },
          { title:'2. Uso dos Dados', text:'Os dados coletados são utilizados exclusivamente para: operação da plataforma de automação; autenticação e gerenciamento das contas do Instagram; agendamento e publicação de conteúdo conforme configurado pelo usuário; monitoramento de saúde e métricas das contas.' },
          { title:'3. Compartilhamento de Dados', text:'Não compartilhamos dados pessoais com terceiros, exceto com a Meta Platforms, Inc. para autenticação OAuth e publicação de conteúdo via Graph API, conforme necessário para a prestação do serviço.' },
          { title:'4. Armazenamento e Segurança', text:'Os dados são armazenados em servidor dedicado localizado na União Europeia (Alemanha). Adotamos medidas técnicas de segurança, incluindo criptografia de senhas e tokens de acesso via HTTPS.' },
          { title:'5. Retenção de Dados', text:'Os dados são mantidos enquanto o usuário possuir conta ativa na plataforma. Após o encerramento da conta, os dados são excluídos em até 30 dias.' },
          { title:'6. Direitos do Titular (LGPD)', text:'Em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018), o usuário tem direito a: acesso aos seus dados; correção de dados incompletos ou desatualizados; exclusão dos dados; revogação do consentimento. Para exercer esses direitos, entre em contato pelo e-mail contato@instaflow.pro.' },
          { title:'7. Cookies', text:'A plataforma utiliza cookies de sessão estritamente necessários para autenticação. Não utilizamos cookies de rastreamento ou publicidade.' },
          { title:'8. Contato', text:'Para dúvidas sobre esta Política de Privacidade ou exercício de direitos, entre em contato: contato@instaflow.pro' },
        ].map(({ title, text }) => (
          <div key={title} style={{ marginBottom:28 }}>
            <h2 style={{ fontSize: 'var(--mf-t-h2)', fontWeight:700, color:'var(--mf-text)', marginBottom:8 }}>{title}</h2>
            <p style={{ fontSize: 'var(--mf-t-body)', color:'var(--mf-text-2)', lineHeight:1.7, margin:0 }}>{text}</p>
          </div>
        ))}

        <div style={{ borderTop:'1px solid var(--mf-border)', paddingTop:24, marginTop:8, fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)', lineHeight:1.7 }}>
          <strong style={{ color:'var(--mf-text-2)' }}>67.761.040 VITOR MARCELO MOURA DA SILVA</strong><br />
          CNPJ: 67.761.040/0001-27 · contato@instaflow.pro
        </div>
      </div>
    </div>
  );
}
