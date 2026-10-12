# MediaForge — relatório de entrega

## Resumo

Aplicação independente (pasta `mediaforge/`), sem alterações no SaaS principal do repositório. Servidor Node 22 +
TypeScript (Fastify, SQLite nativo), interface React + TypeScript + Tailwind, processamento com FFmpeg/FFprobe reais.

Como executar: veja o [README](../README.md) (`npm install`, `npm run build`, `npm start` → <http://127.0.0.1:5310>).

## Auditoria inicial do ambiente

| Item | Encontrado | Decisão |
| --- | --- | --- |
| Repositório | SaaS de automação (backend Express/BullMQ, frontend React/Vite, serviço Python) | Projeto novo e isolado em `mediaforge/`, com workspace npm próprio |
| Node.js | 22.22 | Usar `node:sqlite` (sem dependência nativa para compilar no Windows) |
| FFmpeg/FFprobe | 6.1.1 com x264, x265, VPX, SVT-AV1, Opus, LAME, WebP, libass, drawtext, `filter_units` | Capacidades detectadas em tempo de execução; interface desabilita o que faltar |
| Redis | instalado aqui, mas não nativo no Windows | Fila persistente sobre SQLite (ver decisões técnicas no README) |
| Navegador de testes | Chromium do Playwright 1.56.1 | E2E com Playwright; descoberto que esse Chromium não tem H.264 → prévia em WebM/VP9 quando necessário |

## Funcionalidades implementadas

### Importação e inspeção
- Envio múltiplo por clique ou arrastar-e-soltar, com progresso por arquivo.
- Tipo detectado pelos bytes (não pela extensão); executáveis, ZIP, PDF e scripts recusados; extensão divergente aceita
  pelo conteúdo com aviso.
- FFprobe + teste de decodificação na importação (imagens são decodificadas por inteiro; vídeos geram miniatura);
  arquivos corrompidos ficam registrados como inválidos com o motivo, sem os bytes.
- Limites de tamanho, duração, resolução e quantidade; SHA-256 calculado em streaming; detecção de arquivos idênticos.
- Lista com miniatura, nome, tamanho, formato, duração, resolução, codecs, estado, GPS/campos sensíveis e duplicatas.
- Detalhe com fluxos e todos os metadados por categoria (valores sensíveis ocultos até revelar).

### Modos de processamento
- **Rápido**: inspeção, limpeza de metadados, conversão de formato, codec e qualidade, validação. Cópia de fluxos sem
  recodificar quando possível; limpeza de JPEG/PNG/WEBP sem perdas.
- **Personalizado**: formato, proporção (original, 9:16, 4:5, 1:1, 16:9), resolução (predefinida ou personalizada, com
  preservação de proporção), reenquadramento por âncora, barras, fundo desfocado, corte de área (arrastável na
  visualização), trecho início/fim, divisão em partes, brilho, contraste, saturação, velocidade (áudio sem mudar o tom),
  volume, remoção de áudio, codecs de vídeo/áudio, fps, taxa de bits ou nível de qualidade, velocidade de codificação.
- **Editorial**: tudo do personalizado + abertura/encerramento (cartela de texto ou arquivo), combinação de cenas,
  textos próprios com posição/tamanho/cor/faixa/tempo, legendas SRT, elementos gráficos (logotipo) com posição/escala/
  opacidade/tempo, trilha de áudio (substituir ou mixar, repetição), transições de entrada/saída, perfis editoriais
  predefinidos.
- **Lote**: perfil comum ou configuração individual por arquivo; vários perfis de exportação por arquivo; contador de
  quantidade (arquivos × perfis × partes, calculado como o servidor: perfil salvo usa as próprias configurações);
  perfis salvos reutilizáveis entre sessões. Um perfil embutido que muda proporção/resolução/fps, marcado no modo
  Rápido, é processado no modo Personalizado — e o plano avisa.
- **Cortes exatos**: início/fim e divisão em partes alinhados à grade de quadros (primeiro quadro em/depois do instante;
  partes vizinhas sem quadro repetido nem perdido); mudança de velocidade escolhe os quadros com taxa constante
  (2× = um sim, um não desde o primeiro; 0,5× = cada quadro duas vezes).
- **Validar plano** (lista exata das operações e erros antes de criar tarefas) e **pré-visualização real** (trecho curto
  renderizado pelo FFmpeg com as configurações atuais).

### Fila e execução
- Fila persistente (SQLite), concorrência ajustável em tempo real, limite de memória livre, prioridade reduzida dos
  processos, tempo limite por tarefa.
- Progresso real (`-progress` do FFmpeg) individual e geral; fases preparando/processando/validando/finalizando.
- Cancelamento de pendentes e em execução; retentativas automáticas limitadas; repetição manual; uma falha não afeta as
  demais; registro de início, término e duração.
- Recuperação após queda e encerramento ordenado sem perder tarefas (SIGINT, SIGTERM, SIGHUP e, no Windows, SIGBREAK).
- Bloqueio exclusivo do diretório de dados; a porta é aberta antes de recuperar a fila, então uma segunda instância
  não interfere na primeira.
- Cancelamento respeitado até o último instante (uma tarefa cancelada na finalização não termina "concluída").

### Metadados
- Inspeção de contêiner, fluxos, dados laterais, capítulos, fluxos extras (telemetria/GPS, capas, legendas), caixas MP4
  proprietárias, SEI do encoder; EXIF/XMP/IPTC/ICC/comentários/dados extras em imagens.
- Remoção seletiva por 9 categorias + preservação de orientação e perfil de cor.
- Verificação após o processamento: nova inspeção, comparação campo a campo (pelo valor completo, não pelo texto
  encurtado da tela), busca dos valores removidos nos bytes da saída, veredito honesto (comprovado / parcial / não
  comprovado / nada a remover / não solicitado).
- Campos mantidos por escolha são regravados com o valor completo; capítulos mantidos conservam os títulos; caixas de
  `udta` que o FFmpeg não regrava (ex.: `loci`) são reinseridas byte a byte (com correção dos deslocamentos quando o
  índice fica no início); textos/data/XMP de PNG são reinseridos em PNG recodificado. O que não puder ser regravado
  aparece como aviso no relatório — nunca some em silêncio.
- Assinatura do codificador gravada dentro dos quadros de áudio AAC (`Lavc…`, típica de arquivos já processados pelo
  FFmpeg) é detectada; com o áudio copiado ela permanece e o veredito fica "parcial", com aviso explicando que só sai
  recodificando o áudio.
- Vídeo com matriz de rotação e "Orientação da mídia" desmarcada: na cópia, a matriz é removida (`-display_rotation`,
  FFmpeg 6+) com aviso; na recodificação, a rotação é gravada nos pixels.

### Validação, integridade e exportação
- Validação de cada saída: formato real, codecs, resolução, duração, fps, áudio, taxa de bits e decodificação completa.
- SHA-256 da entrada (importação e antes de processar), conferência da entrada depois, SHA-256 da saída, saídas
  idênticas; reconferência antes de download e de ZIP. O relatório separa integridade técnica de similaridade.
- Resultados com visualização, download individual, relatório (JSON) e exportação ZIP organizada (`videos/`,
  `imagens/`, `relatorios/`, `RELATORIO.txt`, `relatorio.json`, `SHA256SUMS.txt`) com valores sensíveis mascarados.
- O ZIP confere o SHA-256 de todas as saídas antes de enviar o primeiro byte e recalcula durante o envio: se um arquivo
  mudar no meio, o download é interrompido (nunca um ZIP "válido" com conteúdo não verificado). Cada arquivo só é
  aberto na sua vez e tudo é fechado se o download for cancelado.
- Na interface, o download individual é conferido antes; uma falha (arquivo ausente ou alterado) aparece como aviso.

### Segurança
- Sessões isoladas (cookie httpOnly/SameSite, hash do token), chave de acesso opcional (mínimo 16 caracteres, bloqueio
  de 15 min após 10 tentativas erradas), verificação de origem (`Origin`/`Sec-Fetch-Site`), lista de hosts permitidos
  contra DNS rebinding, cabeçalhos de segurança, caminhos confinados à sessão, nomes saneados (controles de direção de
  texto, nomes reservados do Windows, limite em unidades UTF-16 e bytes UTF-8), argumentos de processo sem shell,
  textos do usuário fora do filtergraph, logs sem nomes de arquivo nem valores de metadados, limpeza automática.
- Lote limitado antes de montar os planos (arquivos × perfis × partes não pode virar milhões de planos).
- Movimentação de saídas sem sobrescrever e tolerante a sistemas sem links (FAT/exFAT) e a arquivos presos por
  antivírus no Windows.

## Resultados dos testes

Execução final em 12/10/2026, Linux (Node 22.22, FFmpeg 6.1.1, Chromium do Playwright 1.56.1). Todas as mídias de
teste são geradas pelo FFmpeg na hora; as verificações conferem bytes, SHA-256, quadros decodificados, PSNR,
`ffprobe` e o sistema de arquivos — nunca apenas a existência de um arquivo.

| Suíte | Arquivos | Testes | Resultado |
| --- | --- | --- | --- |
| Servidor — unidade (`server/tests/unit`) | 6 | 294 | 294 aprovados |
| Servidor — integração com FFmpeg real (`server/tests/integration`) | 12 | 219 | 219 aprovados |
| Interface — unidade (`web`, Vitest) | 1 | 12 | 12 aprovados |
| Ponta a ponta no navegador (`web/e2e`, Playwright) | 1 | 8 | 8 aprovados |
| Typecheck (`tsc` de servidor + testes, interface) | — | — | sem erros |
| Build de produção (`npm run build`) + teste de fumaça | — | — | ok (`/api/health`, interface servida, `Host` estranho → 403, encerramento com aba aberta em ~1,3 s) |

O que as suítes de integração cobrem, entre outros pontos:
- **Importação**: tipo real pelos bytes, arquivos truncados/corrompidos recusados, nomes maliciosos, limites.
- **Metadados de vídeo e imagem**: remoção por categoria comprovada nos bytes, campos mantidos regravados com o valor
  completo, capítulos, caixas `udta` (inclusive com índice no início), XMP em `udta` com GPS não reinserido, PNG
  recodificado sem chunks dependentes do IDAT antigo, assinatura `Lavc` no áudio copiado relatada.
- **Conversão e tempo**: cortes, partes e velocidade conferidos quadro a quadro contra a fonte (sem quadro repetido
  nem perdido), sincronia em fonte VFR com lacuna, taxa fracionária exata.
- **Fila e recuperação**: concorrência, cancelamento (inclusive na finalização), isolamento de falhas, retentativas,
  reinício com o mesmo diretório, bloqueio contra segunda instância.
- **Integridade e exportação**: SHA-256 do relatório = bytes baixados, adulteração detectada no download e no ZIP,
  `SHA256SUMS.txt` conferido entrada a entrada, descritores fechados após downloads abortados.
- **Segurança e sessões**: `Host`/`Origin`/`Sec-Fetch-Site`, chave de acesso e limite de tentativas (com e sem proxy),
  isolamento entre sessões, limite de lote contando planos com erro.
- **Perfis e limpeza**: perfis salvos e embutidos (promoção do modo Rápido), expiração de sessões, eventos em tempo
  real ao remover tarefas.

## Limitações conhecidas

- **HEIC/AVIF**: o FFmpeg 6.1 não lê HEIC; esses arquivos são recusados com mensagem clara (builds mais novas podem ler).
- **Fluxos extras**: a saída contém um fluxo de vídeo e um de áudio. Legendas embutidas, faixas de áudio adicionais,
  capítulos (quando há corte/velocidade/concatenação) e fluxos de dados da origem não são transportados.
- **Metadados proprietários não reconhecidos**: se uma estrutura não é exposta pelo FFprobe nem pelos leitores do
  projeto, ela não entra na comparação; o relatório informa explicitamente esse limite e a busca de bytes cobre os
  valores conhecidos.
- **XMP/IPTC**: são removidos ou mantidos por inteiro (não há edição campo a campo desses pacotes). Em imagens
  recodificadas, XMP/IPTC preservados só são reinseridos de PNG para PNG; nos demais casos o relatório avisa a perda
  (EXIF e ICC são sempre reinseridos).
- **Assinatura `Lavc` no áudio copiado**: não há como removê-la sem recodificar o áudio; o relatório marca a remoção de
  "Software" como não comprovada e explica como resolver.
- **Valores de metadados muito longos**: campos mantidos por escolha com mais de 8 000 caracteres (ou que estourariam o
  limite de linha de comando do Windows) não são regravados; aparecem em "não aplicado" no relatório.
- **WEBP recodificado**: metadados preservados não são reinseridos em WEBP gerado pelo FFmpeg (aviso no relatório).
- **MakerNote e miniatura EXIF**: descartados sempre que o EXIF é reescrito (offsets internos não são portáveis).
- **Cópia de fluxos com corte**: só quando o usuário escolhe "copiar" explicitamente; os cortes se alinham a quadros-chave
  (a validação tolera e avisa).
- **Visualização no navegador**: navegadores sem H.264 não reproduzem saídas MP4/H.264 na página (o download funciona);
  a prévia muda para WebM/VP9 automaticamente.
- **Memória/CPU**: não há limite rígido de memória por processo (não é portável entre Windows e Linux); o controle é feito
  por concorrência, threads, prioridade, tempo limite e memória livre mínima para iniciar tarefas.
- **Rede**: pensado para uso local (`127.0.0.1`). Para expor na rede, defina `ACCESS_KEY` e use HTTPS na frente; com
  proxy reverso, defina `TRUST_PROXY` para o limite de tentativas valer por cliente. Clientes atrás de um mesmo NAT
  dividem esse limite (quem já tem sessão não é afetado).
- **Fontes VFR**: cortes e divisão em fontes de cadência variável não são alinhados a uma grade de quadros (não há grade
  única); o corte cai no primeiro quadro a partir do instante e o início pode repetir um quadro por uma fração de
  segundo para manter a sincronia com o áudio.
- **Vídeo que começa depois do contêiner** (ex.: MKV/MPEG-TS com o vídeo deslocado em relação ao áudio): na divisão em
  partes, a fronteira da 1ª parte é contada a partir do 1º quadro de vídeo e pode repetir alguns quadros na parte
  seguinte.
- **Caixas proprietárias opacas em `udta`** (ex.: `smta`, `SDLN`, `MUID`): como podem conter qualquer dado, só são
  reinseridas quando nenhuma categoria sensível foi marcada para remoção; caso contrário, o relatório avisa.
