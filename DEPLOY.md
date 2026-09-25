# Deploy — Supabase + Cloudflare

```
painel.seudominio.com ──► Cloudflare Pages      (o painel: frontend/)
api.seudominio.com    ──► Cloudflare Tunnel ──► seu servidor (Docker: backend/)
                                                   │
                                                   └──► Supabase (Postgres)
```

- **Painel** (React): no Cloudflare Pages, de graça, com deploy automático a cada push.
- **API + fila** (Node, um processo só): num servidor Linux com Docker. Ela
  precisa de disco (a biblioteca de mídia, de onde a Meta baixa os vídeos), de
  ffmpeg e de rodar 24h (a fila de publicações) — nada disso cabe num Worker. O
  túnel da Cloudflare dá HTTPS e domínio sem abrir porta nenhuma no servidor.
- **Banco**: Supabase. As tabelas são criadas sozinhas na primeira subida.

Você vai precisar de: um domínio na Cloudflare, uma VPS (1 vCPU e 2 GB de RAM
bastam, Ubuntu 22.04/24.04), uma conta no Supabase, o app na Meta e este
repositório no GitHub.

> Nos exemplos: `painel.seudominio.com` é o painel e `api.seudominio.com` é a API.
> Troque pelo seu domínio em todos os lugares.

---

## 1. Supabase (banco)

1. Em [supabase.com](https://supabase.com) → **New project**. Região: **South America (São Paulo)**.
   Anote a senha do banco que você definir.
2. No projeto, clique em **Connect** (topo da página) → **Connection string** →
   em **Method** escolha **Session pooler**. Copie a URI:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```
   Troque `[YOUR-PASSWORD]` pela senha do passo 1. Se a senha tiver símbolos
   (`@ # / ? %`…), use a versão codificada — o Supabase mostra a URI com a senha
   já preenchida se você clicar no ícone de copiar com a senha visível; ou
   redefina a senha só com letras e números em **Database → Settings**.

   > Use o **Session pooler**, não a "Direct connection": a conexão direta é só
   > IPv6 e a maioria das VPS não sai por IPv6.

Não crie tabela nenhuma: a API faz isso sozinha ao subir.

## 2. Servidor (VPS)

Entre no servidor por SSH e rode:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# O código
git clone https://github.com/v1tormoura/insta-automation.git
cd insta-automation
git checkout claude/nifty-dijkstra-ebzsp9   # ou main, depois do merge
```

## 3. Cloudflare Tunnel (HTTPS da API)

1. No painel da Cloudflare → **Zero Trust** → **Networks** → **Tunnels** →
   **Create a tunnel** → **Cloudflared** → dê um nome (ex.: `insta-api`) → **Save tunnel**.
2. Na tela "Install and run a connector", escolha **Docker**. O comando mostrado
   termina em `--token eyJhIjoi...`. **Copie só o token** (o texto longo depois
   de `--token`). Não precisa rodar o comando — o `docker compose` faz isso.
3. **Next** → aba **Public Hostname** (ou "Route traffic"):
   - **Subdomain**: `api` · **Domain**: `seudominio.com`
   - **Service**: Type `HTTP` · URL `app:3000`
   - **Save**.

## 4. Configuração (`.env`)

No servidor, dentro de `insta-automation/`:

```bash
cp .env.example .env
openssl rand -hex 32   # rode duas vezes: uma para JWT_SECRET, outra para ENCRYPTION_KEY
nano .env
```

Preencha:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a URI do Supabase (passo 1) |
| `PUBLIC_URL` | `https://api.seudominio.com` |
| `FRONTEND_URL` | `https://painel.seudominio.com` |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | o login do painel |
| `JWT_SECRET` | um dos `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | o outro `openssl rand -hex 32` — **guarde**: trocar depois invalida os tokens das contas conectadas |
| `TUNNEL_TOKEN` | o token do passo 3 |

As opcionais (push, IA de legendas, ritmo de publicação) estão explicadas no
próprio `.env.example`.

## 5. Subir a API

```bash
docker compose up -d --build
docker compose logs -f app
```

No log deve aparecer:

```
🗄️  [DB] migração aplicada: 001_inicial.sql
🎬 [ffmpeg] /usr/bin/ffmpeg
🚀 API na porta 3000 — https://api.seudominio.com
[Fila] processando (até 5 trabalhos ao mesmo tempo)
```

(`Ctrl+C` sai do log; a API continua rodando.) Teste de fora:

```bash
curl https://api.seudominio.com/healthz     # → {"ok":true}
```

## 6. Cloudflare Pages (o painel)

1. Cloudflare → **Workers & Pages** → **Create** → aba **Pages** →
   **Import an existing Git repository** → autorize o GitHub → escolha
   `insta-automation`.
2. Configuração do build:
   - **Production branch**: `claude/nifty-dijkstra-ebzsp9` (ou `main`, depois do merge)
   - **Framework preset**: `React (Vite)`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory (advanced)**: `frontend`
   - **Environment variables**: `VITE_API_URL` = `https://api.seudominio.com`
3. **Save and Deploy**.
4. No projeto do Pages → **Custom domains** → **Set up a custom domain** →
   `painel.seudominio.com`.

> `VITE_API_URL` entra no build. Se mudar, faça **Retry deployment** no Pages.
>
> Vai usar também o endereço `*.pages.dev`? Coloque os dois no `FRONTEND_URL`
> do servidor, separados por vírgula, e rode `docker compose up -d`.

Abra `https://painel.seudominio.com` e entre com o login do `.env`.

## 7. App da Meta (conectar as contas)

O painel usa a **API do Instagram com login do Instagram** (a oficial).

1. Em [developers.facebook.com](https://developers.facebook.com/apps) → **Criar app** →
   caso de uso **Gerenciar mensagens e conteúdo no Instagram**.
2. No app → **Instagram** → **Configuração da API com login do Instagram**:
   - Em **Configurar o login da empresa do Instagram** → **URIs de redirecionamento do OAuth**:
     `https://painel.seudominio.com/oauth-callback`
     (é o endereço que o painel mostra em **API Meta** como "Redirect URI principal").
   - Anote o **ID do app do Instagram** e a **Chave secreta do app do Instagram**.
3. Permissões usadas: `instagram_business_basic`,
   `instagram_business_content_publish`, `instagram_business_manage_comments`,
   `instagram_business_manage_insights`.
4. No painel → **API Meta** → cadastre o app com o **App ID** e o **App Secret**
   (e o ID/chave do app do Instagram, se forem diferentes).
5. Com o app em **modo de desenvolvimento**, só contas adicionadas como
   **testadoras do Instagram** conseguem autorizar (Funções do app → Funções →
   Testadores do Instagram; a pessoa aceita o convite em Instagram → Configurações →
   Apps e sites). Para qualquer conta, o app precisa passar pela análise da Meta e
   ir para o modo **Ao vivo**.
6. As contas precisam ser **profissionais** (Empresa ou Criador de conteúdo).
   Conta pessoal aparece como "Conta pessoal" e não publica.

Conecte em **Contas → Conectar conta**.

## 8. Atualizar

- **Painel**: automático — todo push na branch de produção dispara um build no Pages.
- **API**: no servidor, `./deploy.sh` (baixa o código, reconstrói e reinicia).

## 9. Manutenção

```bash
docker compose ps                 # estado (app deve estar "healthy")
docker compose logs -f app        # log da API e da fila
docker compose restart app        # reiniciar
```

**Backup**: o banco está no Supabase (backups em **Database → Backups**, conforme
o plano). A biblioteca de mídia fica no volume Docker `insta-automation_uploads`:

```bash
docker run --rm -v insta-automation_uploads:/dados -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /dados .
```

## Limites que valem saber

- **100 MB por arquivo.** A Cloudflare recusa requisição acima de 100 MB (planos
  Free e Pro). O painel já envia vários arquivos em lotes abaixo disso; um vídeo
  sozinho acima de 95 MB é recusado com aviso — comprima antes de enviar.
- **A Meta baixa a mídia da sua API.** Por isso `PUBLIC_URL` precisa ser o
  endereço público `https://api...`. Se o servidor cair, a publicação em
  andamento falha e volta para a fila.

## Problemas comuns

| Sintoma | Causa e correção |
|---|---|
| Log: `Variáveis de ambiente obrigatórias não definidas: …` | Falta a variável citada no `.env`. Preencha e `docker compose up -d`. |
| Log: erro de conexão com o banco / `password authentication failed` | URI errada. Use a do **Session pooler** (porta 5432) e confira a senha (símbolos precisam estar codificados). |
| Painel: login não responde / erro de CORS no console | `FRONTEND_URL` não bate exatamente com o endereço do painel (sem `/` no fim). Ajuste e `docker compose up -d`. |
| Painel chama `localhost:3000` | `VITE_API_URL` não foi definido no Pages. Defina e faça **Retry deployment**. |
| Meta: "redirect_uri inválido" ao conectar | A URI cadastrada no app da Meta tem que ser idêntica a `https://painel.seudominio.com/oauth-callback`. |
| Publicação falha com erro de mídia / download | `PUBLIC_URL` errado ou túnel fora. Teste `curl -I https://api.seudominio.com/healthz`. |
| Log: `[ffmpeg] … NÃO ENCONTRADO` | Imagem antiga. `docker compose build --no-cache app && docker compose up -d`. |
| Upload: "Arquivo grande demais" | Arquivo acima de 95 MB (limite da Cloudflare). Comprima o vídeo. |

## Desenvolvimento local

Precisa de Node 22 e de um Postgres (local ou o próprio Supabase).

```bash
cp .env.example backend/.env    # DATABASE_URL, e PUBLIC_URL=http://localhost:3000, FRONTEND_URL=http://localhost:5173
cd backend && npm ci && npm run dev
cd frontend && npm ci && npm run dev   # em outro terminal → http://localhost:5173
```

Testes:

```bash
cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:5432/insta_test npm test   # apaga e recria o banco de teste
cd frontend && npm test
```

> Em local, a Meta não consegue baixar mídia de `localhost`: para publicar de
> verdade a partir da sua máquina, use um túnel (`cloudflared tunnel --url http://localhost:3000`)
> e ponha o endereço dele em `PUBLIC_URL`.
