# MediaForge

Plataforma local para **processar vídeos e imagens em lote**, **inspecionar e limpar metadados** (com verificação comprovada),
**converter formatos** e criar **versões editoriais** (cortes, reenquadramento, textos, legendas, logotipos, trilhas e
combinação de cenas) usando **FFmpeg** e **FFprobe** de verdade — sem simulações.

Projeto **independente**: vive inteiro nesta pasta (`mediaforge/`), tem dependências, banco e dados próprios e não
altera nem depende do SaaS principal do repositório.

---

## Sumário

1. [Requisitos](#requisitos)
2. [Instalação do FFmpeg](#instalação-do-ffmpeg)
3. [Instalação e execução](#instalação-e-execução)
4. [Como usar](#como-usar)
5. [Configuração (.env)](#configuração-env)
6. [Testes](#testes)
7. [Estrutura do projeto](#estrutura-do-projeto)
8. [Segurança e privacidade](#segurança-e-privacidade)
9. [Decisões técnicas](#decisões-técnicas)
10. [Limitações conhecidas](#limitações-conhecidas)

Documentos complementares: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/RELATORIO-ENTREGA.md`](docs/RELATORIO-ENTREGA.md).

---

## Requisitos

| Item | Versão | Observação |
| --- | --- | --- |
| Node.js | **22.13 ou superior** (22 LTS recomendado) | usa o SQLite nativo do Node (`node:sqlite`) — nada para compilar |
| FFmpeg + FFprobe | **6.1 ou superior**, build "full" | precisa de libx264 e AAC; opcionais: libx265, libvpx (VP9), libopus, SVT‑AV1, libwebp, libass, drawtext |
| Sistema | Windows 10/11 ou Linux (macOS também funciona) | |
| Navegador | Chrome, Edge, Firefox ou Safari atuais | |

Não é preciso Redis, Docker, banco externo nem compilador C++.

## Instalação do FFmpeg

### Windows

Opção A — **winget** (mais simples):

```powershell
winget install --id Gyan.FFmpeg -e
```

Feche e abra o terminal e confira:

```powershell
ffmpeg -version
ffprobe -version
```

Opção B — **manual**: baixe a build *full* em <https://www.gyan.dev/ffmpeg/builds/> (ex.: `ffmpeg-release-full.7z`),
extraia para `C:\ffmpeg` e então **ou** adicione `C:\ffmpeg\bin` ao PATH (Configurações → Sistema → Sobre →
Configurações avançadas → Variáveis de ambiente), **ou** informe os caminhos no `.env`:

```ini
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update && sudo apt install -y ffmpeg
```

Fedora: `sudo dnf install ffmpeg` (RPM Fusion). Arch: `sudo pacman -S ffmpeg`.

### Conferindo tudo

Depois de instalar as dependências do projeto (próxima seção), rode o diagnóstico:

```bash
npm run doctor
```

Ele confere Node, FFmpeg/FFprobe, encoders/filtros disponíveis e permissão de escrita no diretório de dados. Recursos
cujo encoder não existe na sua build (ex.: AV1) ficam desabilitados na interface automaticamente.

## Instalação e execução

Dentro da pasta `mediaforge/`:

```bash
npm install          # instala dependências (servidor, interface e pacote compartilhado)
npm run build        # compila a interface e o servidor
npm start            # inicia em http://127.0.0.1:5310
```

No Windows também dá para usar `iniciar-mediaforge.bat` (instala, compila na primeira vez e abre o navegador).
No Linux/macOS: `./iniciar-mediaforge.sh`.

**Modo desenvolvimento** (recarrega ao editar):

```bash
npm run dev          # servidor em :5310 + interface Vite em http://127.0.0.1:5311
```

Encerrar com `Ctrl+C` é seguro: tarefas em execução voltam para a fila e são retomadas na próxima inicialização.

## Como usar

1. **Importe** vídeos e imagens arrastando para a área de importação (ou clicando). Cada arquivo é validado pelo
   conteúdo real (não pela extensão), passa pelo FFprobe, tem o SHA‑256 calculado e a decodificação testada.
   Arquivos inválidos/corrompidos aparecem marcados com o motivo. Áudios e legendas `.srt` viram **recursos** do modo
   editorial.
2. Clique em **ⓘ** num arquivo para ver informações técnicas, fluxos e todos os **metadados encontrados**, agrupados por
   categoria (valores sensíveis ficam ocultos até você revelar).
3. **Selecione** os arquivos a processar e escolha o **modo**:
   - **Rápido** — limpeza de metadados, conversão de formato, codec e qualidade. Copia os fluxos sem recodificar
     sempre que possível; imagens JPEG/PNG/WEBP são limpas **sem perdas** (os dados da imagem não são tocados).
   - **Personalizado** — proporção (original, 9:16, 4:5, 1:1, 16:9), resolução, reenquadramento por âncora, corte de
     área, trecho (início/fim), divisão em partes, brilho/contraste/saturação, velocidade, volume/remoção de áudio,
     codecs, fps, taxa de bits ou nível de qualidade.
   - **Editorial** — tudo do personalizado + abertura e encerramento (cartela de texto ou arquivo), combinação de cenas,
     textos próprios, legendas SRT, elementos gráficos (logotipo), trilha de áudio (substituir ou mixar), transições e
     perfis editoriais predefinidos.
4. Em lote, escolha **Perfil comum** (mesmas configurações para todos) ou **Individual por arquivo** (clique num arquivo
   para editar a configuração dele).
5. Marque **perfis de exportação** (ex.: Vertical 9:16 + Feed 4:5) para gerar várias saídas por arquivo. O contador de
   **quantidade** mostra arquivos × perfis × partes. Salve suas configurações como **perfil** para lotes futuros.
6. Use **Pré‑visualizar** (renderiza um trecho curto com as configurações atuais) e **Validar plano** (lista exatamente
   o que será aplicado a cada arquivo, ou os erros). Nada é aplicado sem estar listado.
7. **Processar**: acompanhe o progresso individual e geral, ajuste o número de tarefas simultâneas, cancele, repita
   as que falharam.
8. Em **Resultados**: visualize, baixe, abra o **relatório** (transformações, metadados removidos/preservados/não
   comprovados, validação técnica, integridade SHA‑256, comando executado) e exporte **ZIP** (selecionados ou tudo,
   com pastas `videos/`, `imagens/`, `relatorios/`, `RELATORIO.txt`, `relatorio.json` e `SHA256SUMS.txt`).

## Configuração (.env)

Copie `.env.example` para `.env` (na pasta `mediaforge/`) e ajuste. Principais opções:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `5310` | Endereço do servidor. Mantenha `127.0.0.1` para uso local. |
| `ACCESS_KEY` | vazio | Exige chave para iniciar sessão (use se expor na rede). |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binários do FFmpeg. |
| `DATA_DIR` | `./data` | Banco SQLite, uploads, saídas e temporários. |
| `MAX_UPLOAD_MB`, `MAX_DURATION_SEC`, `MAX_RESOLUTION` | 4096 / 10800 / 8192 | Limites por arquivo. |
| `DEFAULT_CONCURRENCY` / `MAX_CONCURRENCY` | 2 / até 8 | Tarefas simultâneas (ajustável na interface). |
| `FFMPEG_THREADS`, `PROCESS_NICE` | 0 / 10 | Threads e prioridade de cada processo FFmpeg. |
| `JOB_TIMEOUT_SEC`, `JOB_MAX_ATTEMPTS` | 14400 / 2 | Tempo limite e tentativas automáticas. |
| `MIN_FREE_MEMORY_MB` | 256 | Não inicia tarefas com pouca memória livre. |
| `VALIDATION_DECODE` | `full` | Decodificação de verificação: `full`, `quick` ou `off`. |
| `SESSION_TTL_HOURS` | 72 | Sessões inativas (e seus arquivos) são apagadas depois disso. |

## Testes

```bash
npm test                         # unidade + integração (servidor com FFmpeg real) + unidade da interface
npm run test:e2e                 # ponta a ponta no navegador (Playwright)
```

Para os testes E2E, instale o navegador do Playwright uma vez: `npx playwright install chromium`.
As mídias de teste são geradas na hora pelo FFmpeg instalado (com GPS, aparelho, datas, XMP etc. injetados de
propósito) — nenhum arquivo binário de teste fica no repositório.

## Estrutura do projeto

```
mediaforge/
├── shared/            # esquemas (zod) das configurações, perfis, tipos e rótulos — usados pelo servidor e pela interface
├── server/            # Node + Fastify + SQLite nativo
│   ├── src/
│   │   ├── media/     # FFmpeg/FFprobe: detecção, probe, planejador, filtros, validação, hash, miniaturas
│   │   │   └── metadata/  # inspeção e limpeza: EXIF/TIFF, JPEG, PNG, WEBP, XMP, IPTC, ICC, caixas MP4, comparação
│   │   ├── queue/     # fila persistente (SQLite) e executor de tarefas
│   │   ├── services/  # importação, lotes, exportação ZIP, prévia, limpeza, eventos SSE, armazenamento
│   │   ├── routes/    # API HTTP
│   │   ├── security/  # sessões, caminhos isolados, nomes de arquivo
│   │   └── db/        # banco e migrações
│   ├── assets/fonts/  # fonte DejaVu (licença inclusa) para textos e legendas
│   └── tests/         # unidade e integração
├── web/               # React + TypeScript + Tailwind (Vite); e2e/ com Playwright
└── docs/              # arquitetura e relatório de entrega
```

## Segurança e privacidade

- **Nada sai da sua máquina**: nenhuma mídia é enviada a serviços externos; fontes e bibliotecas são locais.
- **Sessões isoladas**: cada navegador recebe uma sessão (cookie `httpOnly`, `SameSite=Strict`; o banco guarda só o
  hash do token). Arquivos, tarefas e downloads só são acessíveis pela sessão dona.
- **Caminhos seguros**: arquivos são gravados com identificadores gerados pelo servidor (nunca com o nome enviado);
  toda resolução de caminho é verificada para não sair do diretório da sessão. Nomes exibidos são saneados.
- **Conteúdo real**: o tipo é detectado pelos bytes; executáveis, ZIP, PDF e scripts são recusados; tudo passa pelo
  FFprobe e por um teste de decodificação.
- **Processos seguros**: FFmpeg é chamado com argumentos em lista (sem shell). Textos do usuário vão para arquivos
  (`textfile=`, `expansion=none`), nunca para dentro do grafo de filtros; números e cores são validados.
- **Limites** de tamanho, duração, resolução, tarefas, concorrência, tempo por tarefa e memória livre.
- **Logs sem dados pessoais**: os logs registram identificadores, não nomes de arquivo nem valores de metadados.
  Relatórios exportados no ZIP mascaram valores sensíveis da origem.
- Cabeçalhos de segurança (CSP, `X-Frame-Options`, `nosniff`) e recusa de requisições de outras origens.

## Decisões técnicas

- **SQLite nativo em vez de BullMQ + Redis**: a ferramenta roda numa única máquina e precisa instalar fácil no
  Windows, onde o Redis não é nativo. A fila sobre SQLite oferece o que o projeto exige — persistência, concorrência
  configurável, retentativas limitadas, cancelamento e recuperação após queda — sem serviço extra. A fila está isolada
  em `server/src/queue/`, então um backend BullMQ pode ser adicionado se um dia houver vários servidores.
- **Leitor/escritor próprio de EXIF/JPEG/PNG/WEBP**: permite remover campos seletivamente **sem recodificar** a imagem
  (preservando tipos e bytes dos campos mantidos), o que bibliotecas só de leitura não fazem.
- **Fastify + SSE**: progresso em tempo real sem WebSocket; reconexão automática do navegador.
- Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Limitações conhecidas

Veja a lista completa e atualizada em [`docs/RELATORIO-ENTREGA.md`](docs/RELATORIO-ENTREGA.md#limitações-conhecidas).
Resumo:

- HEIC/AVIF como entrada depende da build do FFmpeg (a 6.1 não lê HEIC); são recusados com mensagem clara.
- A saída inclui um fluxo de vídeo e um de áudio; legendas embutidas, faixas extras de áudio e fluxos de dados da
  origem não são transportados (isso também remove telemetria/GPS embutida em fluxos de dados).
- Estruturas proprietárias que nem o FFprobe nem os leitores do projeto reconhecem podem não ser detectadas; nesses
  casos o relatório diz que a remoção **não pode ser comprovada** em vez de afirmar sucesso.
- Navegadores sem H.264 (ex.: Chromium sem codecs proprietários) não reproduzem MP4 H.264 na visualização; a prévia
  usa WebM/VP9 automaticamente nesses casos, e o download funciona normalmente.
