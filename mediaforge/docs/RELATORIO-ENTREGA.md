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
- FFprobe + teste de decodificação (miniatura) na importação; arquivos corrompidos ficam registrados como inválidos com o
  motivo, sem os bytes.
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
  quantidade (arquivos × perfis × partes); perfis salvos reutilizáveis entre sessões.
- **Validar plano** (lista exata das operações e erros antes de criar tarefas) e **pré-visualização real** (trecho curto
  renderizado pelo FFmpeg com as configurações atuais).

### Fila e execução
- Fila persistente (SQLite), concorrência ajustável em tempo real, limite de memória livre, prioridade reduzida dos
  processos, tempo limite por tarefa.
- Progresso real (`-progress` do FFmpeg) individual e geral; fases preparando/processando/validando/finalizando.
- Cancelamento de pendentes e em execução; retentativas automáticas limitadas; repetição manual; uma falha não afeta as
  demais; registro de início, término e duração.
- Recuperação após queda e encerramento ordenado sem perder tarefas.

### Metadados
- Inspeção de contêiner, fluxos, dados laterais, capítulos, fluxos extras (telemetria/GPS, capas, legendas), caixas MP4
  proprietárias, SEI do encoder; EXIF/XMP/IPTC/ICC/comentários/dados extras em imagens.
- Remoção seletiva por 9 categorias + preservação de orientação e perfil de cor.
- Verificação após o processamento: nova inspeção, comparação campo a campo, busca dos valores removidos nos bytes da
  saída, veredito honesto (comprovado / parcial / não comprovado / nada a remover / não solicitado).

### Validação, integridade e exportação
- Validação de cada saída: formato real, codecs, resolução, duração, fps, áudio, taxa de bits e decodificação completa.
- SHA-256 da entrada (importação e antes de processar), conferência da entrada depois, SHA-256 da saída, saídas
  idênticas; reconferência antes de download e de ZIP. O relatório separa integridade técnica de similaridade.
- Resultados com visualização, download individual, relatório (JSON) e exportação ZIP organizada (`videos/`,
  `imagens/`, `relatorios/`, `RELATORIO.txt`, `relatorio.json`, `SHA256SUMS.txt`) com valores sensíveis mascarados.

### Segurança
- Sessões isoladas (cookie httpOnly/SameSite, hash do token), chave de acesso opcional, verificação de origem,
  cabeçalhos de segurança, caminhos confinados à sessão, nomes saneados, argumentos de processo sem shell, textos do
  usuário fora do filtergraph, logs sem nomes de arquivo nem valores de metadados, limpeza automática configurável.

## Resultados dos testes

_Seção preenchida com a execução final (ver abaixo)._

## Limitações conhecidas

- **HEIC/AVIF**: o FFmpeg 6.1 não lê HEIC; esses arquivos são recusados com mensagem clara (builds mais novas podem ler).
- **Fluxos extras**: a saída contém um fluxo de vídeo e um de áudio. Legendas embutidas, faixas de áudio adicionais,
  capítulos (quando há corte/velocidade/concatenação) e fluxos de dados da origem não são transportados.
- **Metadados proprietários não reconhecidos**: se uma estrutura não é exposta pelo FFprobe nem pelos leitores do
  projeto, ela não entra na comparação; o relatório informa explicitamente esse limite e a busca de bytes cobre os
  valores conhecidos.
- **XMP/IPTC**: são removidos ou mantidos por inteiro (não há edição campo a campo desses pacotes). Em imagens
  recodificadas, XMP/IPTC preservados não são reinseridos (EXIF e ICC são).
- **WEBP recodificado**: metadados preservados não são reinseridos em WEBP gerado pelo FFmpeg (aviso no relatório).
- **MakerNote e miniatura EXIF**: descartados sempre que o EXIF é reescrito (offsets internos não são portáveis).
- **Cópia de fluxos com corte**: só quando o usuário escolhe "copiar" explicitamente; os cortes se alinham a quadros-chave
  (a validação tolera e avisa).
- **Visualização no navegador**: navegadores sem H.264 não reproduzem saídas MP4/H.264 na página (o download funciona);
  a prévia muda para WebM/VP9 automaticamente.
- **Memória/CPU**: não há limite rígido de memória por processo (não é portável entre Windows e Linux); o controle é feito
  por concorrência, threads, prioridade, tempo limite e memória livre mínima para iniciar tarefas.
- **Rede**: pensado para uso local (`127.0.0.1`). Para expor na rede, defina `ACCESS_KEY` e use HTTPS na frente.
