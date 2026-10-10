# MediaForge — arquitetura

## Visão geral

```
 Navegador (React)                    Servidor Node (Fastify)                         Processos externos
 ─────────────────                    ───────────────────────                         ──────────────────
 Importação (XHR c/ progresso) ──▶  /api/assets ─▶ ImportService ─▶ sniff (bytes) ─▶ ffprobe (JSON)
                                                     │            └─ thumbnail ─────▶ ffmpeg (1 quadro)
                                                     └─ inspectMetadata (EXIF/XMP/IPTC/ICC/caixas MP4/SEI)
 Validar plano / Processar ───────▶  /api/plan, /api/batches ─▶ BatchService ─▶ buildPlan (por arquivo × perfil × parte)
                                                                    └─ jobs no SQLite (status queued)
 Eventos em tempo real ◀── SSE ────  EventHub ◀── JobQueue (claim atômico, concorrência, memória)
                                                     └─ JobRunner ─▶ hash de entrada ─▶ ffmpeg (args em lista, cwd isolado)
                                                                    ├─ limpeza de imagem sem perdas (JS)
                                                                    ├─ validateOutput ─▶ ffprobe + decodificação completa
                                                                    ├─ inspeção da saída + comparação + busca de bytes
                                                                    └─ SHA-256, miniatura, relatório, move sem sobrescrever
 Resultados / ZIP / relatório ────▶  /api/jobs/:id/*, /api/exports ─▶ verificação (tamanho + SHA-256) ─▶ download
```

## Pacotes

| Pacote | Responsabilidade |
| --- | --- |
| `shared` | Esquema único das configurações (zod, com limites em todos os campos), perfis de exportação, perfis editoriais, presets de metadados, DTOs e rótulos em português. Interface e servidor validam com o mesmo esquema. |
| `server` | API, sessões, armazenamento, fila, motor de mídia, metadados, validação e exportação. |
| `web` | Interface React. Estado do servidor via React Query, atualizado por SSE; estado de trabalho (seleção, modo, configurações) persistido no navegador por sessão. |

## Dados e armazenamento

```
DATA_DIR/
├── mediaforge.db            # SQLite (WAL): sessions, assets, batches, jobs, profiles, history, app_settings, exports
└── sessions/<sessão>/
    ├── uploads/<id>.<ext>   # originais, nomeados pelo id (nunca pelo nome enviado)
    ├── thumbs/              # miniaturas de entradas e saídas
    ├── outputs/             # resultados validados (nome legível, único, sem sobrescrita)
    ├── previews/            # últimas prévias (máx. 8)
    └── tmp/                 # job-<id>/ (diretório de trabalho do FFmpeg), upload-*, preview-*
```

- Migrações versionadas por `PRAGMA user_version`.
- Toda consulta filtra por `session_id`; toda resolução de caminho passa por `resolveInside`.
- Perfis salvos são globais da instalação (sobrevivem à limpeza de sessões).

## Fila de tarefas

- Estados: `queued → running → completed | failed | canceled`.
- **Reivindicação atômica**: `UPDATE … WHERE status='queued'` dentro de transação; incrementa `attempts`.
- **Concorrência**: ajustável em tempo real (persistida); não inicia tarefas se a memória livre estiver abaixo de
  `MIN_FREE_MEMORY_MB`. Cada FFmpeg roda com prioridade reduzida (`PROCESS_NICE`) e `FFMPEG_THREADS`.
- **Cancelamento**: pendente → `canceled` imediato; em execução → `AbortController` mata o FFmpeg, remove o diretório
  temporário e descarta saídas parciais. Atualizações finais usam `UPDATE … WHERE status IN (…)` para não sobrescrever
  um cancelamento concorrente.
- **Retentativas**: falhas transitórias (FFmpeg com erro, tempo esgotado, erro inesperado) voltam à fila até
  `JOB_MAX_ATTEMPTS`; falhas determinísticas (configuração inválida, origem alterada, validação reprovada) não.
  "Repetir" na interface zera as tentativas.
- **Recuperação**: na inicialização, tarefas `running` (queda do processo) voltam para a fila ou viram `failed` se já
  esgotaram as tentativas. Encerramento ordenado (`SIGINT/SIGTERM`) devolve as tarefas em execução à fila sem gastar
  tentativa.
- Uma falha nunca interrompe as demais tarefas do lote.

## Planejador (FFmpeg)

`buildPlan(asset, settings, ctx)` é puro (sem efeitos) e é usado tanto no "Validar plano" quanto na execução:

1. Valida as configurações com o esquema e aplica `effectiveSettings` (cada modo só usa as próprias seções — nada de
   ajustes "escondidos").
2. Decide estratégia: **cópia de fluxos** (contêiner aceita o codec e não há filtros nem corte), **recodificação**,
   **limpeza de imagem sem perdas** ou **recodificação de imagem**.
3. Monta o grafo: orientação → corte de área → proporção/resolução (recortar com âncora, barras, fundo desfocado,
   esticar) → cor → velocidade → fps → (concatenação de abertura/cenas/encerramento normalizados) → textos → elementos
   gráficos → legendas → transições; áudio: volume → atempo → (silêncio para segmentos sem áudio) → trilha
   substituta/mixagem → fades.
4. Metadados: `-map_metadata -1 -map_chapters -1` e regravação explícita só do que foi preservado por escolha;
   `-fflags/-flags +bitexact` quando "software" é removido; `filter_units` para remover SEI (H.264/HEVC) sem recodificar.
5. Calcula o **resultado esperado** (contêiner, codecs, dimensões, duração, fps, áudio, taxa de bits) usado na validação.
6. Registra cada operação aplicada e cada item **não aplicado** com o motivo.

Segurança do grafo: o texto do usuário nunca entra no filtergraph — vai para `text-N.txt` lido com
`textfile=…:expansion=none`; fontes e legendas são copiadas para o diretório da tarefa com nomes fixos; números são
formatados e cores validadas por regex.

## Metadados

**Inspeção** (`media/metadata/inspect.ts`):

- Vídeo/áudio: tags do contêiner e dos fluxos (FFprobe), dados laterais (matriz de rotação), capítulos, fluxos extras
  (dados, telemetria `gpmd/camm`, `mebx`, capas, legendas), caixas MP4/MOV que o FFprobe não expõe (`uuid`/XMP, átomos
  proprietários de `udta`, caixas desconhecidas) e assinaturas de encoder no bitstream (SEI do x264/x265).
- Imagem: EXIF (IFD0, EXIF, GPS, Interop, miniatura IFD1, MakerNote), XMP, Photoshop/IPTC, ICC, comentários JPEG,
  segmentos APPn, dados após o EOI (JPEG) / IEND (PNG), chunks de texto/tIME/eXIf (PNG), chunks EXIF/XMP/ICCP (WEBP).
- Cada campo recebe categoria (GPS, datas, dispositivo, descrições, software, personalizados, contêiner, fluxos, SEI,
  técnico) e marca de sensibilidade.

**Limpeza**: vídeo pelo mapeamento de metadados do FFmpeg; imagem por reescrita dos blocos (EXIF reconstruído campo a
campo, preservando bytes e tipos dos campos mantidos; orientação mantida num EXIF mínimo quando pedido).

**Verificação**: a saída é inspecionada de novo e comparada campo a campo (removido, substituído por valor técnico,
preservado, não comprovado, gerado pelo formato); além disso, os valores textuais removidos são **procurados nos bytes**
do arquivo de saída. O veredito só é "comprovado" se nada sobrou.

## Validação do resultado

Para cada saída: arquivo não vazio, leitura pelo FFprobe, formato real (assinatura), codecs, resolução exata, duração
(tolerância maior quando o corte foi feito em cópia), fps, presença/ausência de áudio, taxa de bits (quando alvo) e
**decodificação completa** do arquivo (`VALIDATION_DECODE=full`). Validação reprovada marca a tarefa como falha e
descarta a saída.

## Integridade

SHA-256 da entrada na importação, novamente antes de processar (detecta alteração), conferência da entrada depois
(tamanho/data ou novo hash), SHA-256 da saída, detecção de saídas idênticas na sessão, e reconferência antes de cada
download e de cada exportação ZIP. O relatório separa explicitamente **integridade técnica** de **similaridade de
conteúdo**.

## API (resumo)

| Método | Rota | Função |
| --- | --- | --- |
| GET/POST/DELETE | `/api/session` | Sessão atual / login com chave / encerrar e apagar |
| GET | `/api/system` | FFmpeg, capacidades, limites, fila |
| PUT | `/api/system/concurrency` | Tarefas simultâneas |
| GET/POST | `/api/assets` | Listar / importar (multipart) |
| GET/DELETE | `/api/assets/:id` | Detalhe com metadados / remover |
| GET | `/api/assets/:id/thumbnail`, `/file` | Miniatura / original (Range) |
| POST | `/api/plan` | Validação e plano (sem efeitos) |
| POST/GET | `/api/batches` | Criar lote / listar |
| POST | `/api/batches/:id/cancel`, `/retry` | Cancelar / repetir falhas |
| GET | `/api/jobs`, `/api/jobs/:id` | Tarefas / detalhe com relatório |
| POST | `/api/jobs/:id/cancel`, `/retry`; `/api/jobs/cancel-pending`, `/clear-finished` | Controle |
| GET | `/api/jobs/:id/output`, `/download`, `/report`, `/thumbnail` | Resultado (Range), download verificado, relatório |
| POST/GET | `/api/exports`, `/api/exports/:id` | Preparar (verifica) / baixar ZIP |
| POST/GET | `/api/preview`, `/api/previews/:name` | Prévia real |
| GET/POST/PUT/DELETE | `/api/profiles` | Perfis salvos |
| GET | `/api/presets`, `/api/history`, `/api/events` (SSE) | Predefinições, histórico, tempo real |
