export default function Termos() {
  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: '48px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        <div style={{ marginBottom: 40 }}>
          <a href="/" style={{ color: '#6366f1', fontSize: 13, textDecoration: 'none' }}>← Voltar</a>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '16px 0 4px' }}>Termos de Uso</h1>
          <p style={{ color: '#64748b', fontSize: 13 }}>Última atualização: julho de 2026</p>
        </div>

        <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 32 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
            <strong style={{ color: '#e2e8f0' }}>Operado por:</strong> 67.761.040 VITOR MARCELO MOURA DA SILVA<br />
            <strong style={{ color: '#e2e8f0' }}>CNPJ:</strong> 67.761.040/0001-27<br />
            <strong style={{ color: '#e2e8f0' }}>Contato:</strong> contato@instaflow.pro
          </div>
        </div>

        {[
          {
            title: '1. Aceitação dos Termos',
            text: 'Ao acessar e utilizar o MouraFlow (instaflow.pro), você concorda com estes Termos de Uso. Caso não concorde, não utilize o serviço.',
          },
          {
            title: '2. Descrição do Serviço',
            text: 'O MouraFlow é uma plataforma de automação e gerenciamento de contas do Instagram, desenvolvida e operada por 67.761.040 VITOR MARCELO MOURA DA SILVA (CNPJ 67.761.040/0001-27). O serviço permite o gerenciamento, agendamento de publicações e monitoramento de métricas de contas do Instagram Business e Creator.',
          },
          {
            title: '3. Uso Adequado',
            text: 'O usuário se compromete a utilizar o serviço em conformidade com os Termos de Uso do Instagram e da Meta Platforms, Inc. É proibido utilizar o MouraFlow para praticar spam, assédio, disseminação de conteúdo ilegal ou qualquer atividade que viole as políticas da Meta.',
          },
          {
            title: '4. Conta e Credenciais',
            text: 'O usuário é responsável pela segurança de suas credenciais de acesso ao MouraFlow. As contas do Instagram conectadas à plataforma permanecem de propriedade do usuário. O MouraFlow não armazena senhas do Instagram.',
          },
          {
            title: '5. Limitação de Responsabilidade',
            text: 'O MouraFlow não se responsabiliza por banimentos, restrições ou penalidades aplicadas pelo Instagram às contas do usuário. O uso de ferramentas de automação é de responsabilidade exclusiva do usuário.',
          },
          {
            title: '6. Privacidade',
            text: 'O tratamento de dados pessoais é descrito em nossa Política de Privacidade, disponível em /privacidade.',
          },
          {
            title: '7. Modificações',
            text: 'Reservamo-nos o direito de modificar estes Termos a qualquer momento. Alterações serão comunicadas por e-mail ou notificação na plataforma.',
          },
          {
            title: '8. Contato',
            text: 'Dúvidas sobre estes Termos podem ser enviadas para contato@instaflow.pro.',
          },
        ].map(({ title, text }) => (
          <div key={title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>{title}</h2>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.7, margin: 0 }}>{text}</p>
          </div>
        ))}

        <div style={{ borderTop: '1px solid rgba(51,65,85,.5)', paddingTop: 24, marginTop: 8, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
          <strong style={{ color: '#64748b' }}>67.761.040 VITOR MARCELO MOURA DA SILVA</strong><br />
          CNPJ: 67.761.040/0001-27 · contato@instaflow.pro
        </div>
      </div>
    </div>
  );
}
