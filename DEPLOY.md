# Deploy — VPS + Supabase

```
https://instaflow.pro        ──► VPS: Caddy (HTTPS automático) ──► painel (React)
https://instaflow.pro/api/*  ──► VPS: Caddy ──► API + fila (Node)
                                                      │
                                                      └──► Supabase (Postgres)
```

Tudo roda na VPS com Docker: a API (que também processa a fila de
publicações com ffmpeg) e o Caddy, que serve o painel e emite o certificado
HTTPS sozinho. O banco é o Supabase; as tabelas são criadas na primeira subida.

Você precisa de: uma VPS Ubuntu com Docker, um domínio com registro **A**
apontando para o IP dela, uma conta no Supabase e o app na Meta.

---

## 1. Supabase

1. [supabase.com](https://supabase.com) → **New project** (região São Paulo). Anote a senha do banco.
2. No projeto → **Connect** → aba **Direct** → **Method: Session pooler** → copie a URI
   (termina em `pooler.supabase.com:5432/postgres`) e troque `[YOUR-PASSWORD]` pela senha.
   Use senha só com letras e números para evitar problema com símbolos na URI.

## 2. DNS

No painel do domínio (ex.: Hostinger → Domínios → DNS), confira que existem:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | IP da VPS |
| CNAME | `www` | o domínio (ou A com o mesmo IP) |

## 3. Primeira instalação na VPS

```bash
ssh ubuntu@IP_DA_VPS
sudo -i
curl -fsSL https://get.docker.com | sh          # se o Docker ainda não estiver instalado

cd /root
git clone https://github.com/v1tormoura/insta-automation.git insta-nova
cd insta-nova
git checkout claude/nifty-dijkstra-ebzsp9       # ou main, depois do merge
cp .env.example .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
nano .env
```

No `.env`, preencha `DATABASE_URL`, `DOMAIN` e `AUTH_PASSWORD` (e `AUTH_USERNAME`,
se quiser outro login). Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

> **Guarde o `.env`.** Se a `ENCRYPTION_KEY` for perdida ou trocada, as contas
> conectadas precisam ser reconectadas.

## 4. Subir

As portas **80 e 443** precisam estar livres (nada de outro nginx/site nelas).

```bash
docker compose up -d --build
docker compose logs -f app
```

No log (`Ctrl+C` sai; continua rodando):

```
🗄️  [DB] migração aplicada: 001_inicial.sql
🎬 [ffmpeg] /usr/bin/ffmpeg
🚀 API na porta 3000 — https://instaflow.pro/api
```

Abra `https://instaflow.pro` e entre com o login do `.env`. O certificado HTTPS
sai no primeiro acesso (pode levar alguns segundos).

## 5. App da Meta

1. [developers.facebook.com](https://developers.facebook.com/apps) → seu app → **Instagram** →
   **Configuração da API com login do Instagram** → **URIs de redirecionamento do OAuth**:
   `https://instaflow.pro/oauth-callback` (o painel mostra esse endereço em **API Meta**).
2. No painel → **API Meta** → cadastre o App ID e o App Secret.
3. **Contas → Conectar conta**.

Com o app em modo de desenvolvimento, só contas testadoras autorizam. As contas
precisam ser profissionais (Empresa ou Criador).

## Usuários

- **Admin**: entra com `AUTH_USERNAME` (padrão `admin`) e `AUTH_PASSWORD` do `.env`.
  A senha trocada em **Minha Conta** também vale; a do `.env` continua como recuperação.
- **Outras pessoas**: em `https://DOMAIN/cadastro` (ou "Criar conta" no login)
  pedem acesso com nome, e-mail e senha. O pedido fica **pendente** e você recebe
  um aviso; aprove em **Sistema → Usuários**.
- Cada usuário tem as próprias contas, envios, campanhas, biblioteca, legendas e
  métricas — ninguém vê o que é do outro. O app da Meta é um só (o do admin) e
  todos conectam por ele.
- **Bloquear** corta o acesso na hora e pausa os envios e campanhas da pessoa.
  **Apagar** remove o usuário e tudo que é dele (pede o e-mail para confirmar).
- Com o app da Meta em modo de desenvolvimento, o usuário pede em **Contas →
  Convites** para a conta dele virar testadora; você vê o pedido e convida no
  painel da Meta.

## Atualizar

```bash
cd /root/insta-nova && ./deploy.sh
```

## Manutenção

```bash
docker compose ps                  # app deve estar "healthy"
docker compose logs -f app         # log da API e da fila
docker compose logs -f web         # log do HTTPS/Caddy
docker compose restart app
```

Push no celular (opcional): gere as chaves e cole no `.env` como `VAPID_PUBLIC_KEY`
e `VAPID_PRIVATE_KEY`, depois `docker compose up -d`:

```bash
docker compose run --rm app npx web-push generate-vapid-keys
```

**Backup**: o banco está no Supabase. A biblioteca de mídia fica no volume
`insta-nova_uploads`:

```bash
docker run --rm -v insta-nova_uploads:/dados -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /dados .
```

## Problemas comuns

| Sintoma | Causa e correção |
|---|---|
| `Variáveis de ambiente obrigatórias não definidas` | Falta a variável citada no `.env`. |
| `password authentication failed` / erro de conexão | URI do Supabase errada: use a do **Session pooler** e confira a senha. |
| `bind: address already in use` na porta 80/443 | Outro serviço usa a porta. `docker ps` mostra qual; pare-o. |
| Navegador: erro de certificado | O DNS ainda não aponta para a VPS, ou a porta 80 está bloqueada no firewall. |
| Meta: "redirect_uri inválido" | A URI no app da Meta tem que ser `https://DOMAIN/oauth-callback`, idêntica. |
| Log: `[ffmpeg] … NÃO ENCONTRADO` | `docker compose build --no-cache app && docker compose up -d`. |

## Desenvolvimento local

Node 22 e um Postgres (local ou o Supabase).

```bash
cp .env.example backend/.env    # DATABASE_URL, PUBLIC_URL=http://localhost:3000, FRONTEND_URL=http://localhost:5173
cd backend && npm ci && npm run dev
cd frontend && npm ci && npm run dev   # outro terminal → http://localhost:5173
```

Testes:

```bash
cd backend && TEST_DATABASE_URL=postgres://postgres@localhost:5432/insta_test npm test   # apaga e recria o banco de teste
cd frontend && npm test
```
