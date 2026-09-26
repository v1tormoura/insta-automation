# Configurando o app da Meta

O Nexora usa a **Instagram API with Instagram Login** (Business Login for Instagram). Não é preciso Página do Facebook vinculada.

> A interface do painel da Meta muda com frequência. Os nomes abaixo refletem a documentação oficial vigente; se algum item tiver mudado de lugar, procure pelo equivalente em **Instagram → API setup with Instagram login**.

## 1. Criar o app

1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps) e crie um app do tipo **Business**.
2. Adicione o produto **Instagram** e escolha **API setup with Instagram login**.
3. Copie o **Instagram app ID** e o **Instagram app secret** para o `.env`:

   ```env
   INSTAGRAM_APP_ID=...
   INSTAGRAM_APP_SECRET=...
   ```

   São diferentes do App ID/Secret do app do Facebook — use os da seção do Instagram.

## 2. Business login settings

Em **Set up Instagram business login → Business login settings**:

| Campo | Valor |
|---|---|
| OAuth redirect URIs | `https://SEU_DOMINIO/api/oauth/instagram/callback` (igual a `INSTAGRAM_REDIRECT_URI`, ou `API_PUBLIC_URL` + esse caminho) |
| Deauthorize callback URL | `https://SEU_DOMINIO/api/oauth/instagram/deauthorize` |
| Data deletion request URL | `https://SEU_DOMINIO/api/oauth/instagram/data-deletion` |

A URL de redirect precisa ser **exatamente** igual (protocolo, domínio, caminho, sem barra no final). Tem que ser HTTPS.

- **Deauthorize**: quando alguém remove o app no Instagram, a Meta chama esta URL com um `signed_request`; o Nexora valida a assinatura com o app secret, apaga o token e marca a conta como desconectada.
- **Data deletion**: remove token, métricas e snapshots da conta e responde com o código de confirmação exigido pela Meta.

## 3. Permissões

O Nexora pede apenas:

| Permissão | Uso | Obrigatória |
|---|---|---|
| `instagram_business_basic` | perfil, seguidores, lista de mídias | sim |
| `instagram_business_content_publish` | criar containers e publicar | sim |
| `instagram_business_manage_insights` | métricas da conta e das mídias | não — sem ela a tela de métricas explica o que falta |

Se a pessoa desmarcar uma permissão obrigatória na autorização, a conexão é recusada com mensagem clara.

## 4. Modo de desenvolvimento e App Review

- Em **modo de desenvolvimento**, só contas com papel no app (Administrador, Desenvolvedor, Testador do Instagram) conseguem autorizar. Adicione as contas de teste em **App roles** e aceite o convite no Instagram (Configurações → Apps e sites → Convites de teste).
- Para clientes reais, envie as três permissões para **App Review** com **Advanced Access**, descrevendo o uso (publicação agendada e métricas) e um vídeo do fluxo de conexão e publicação. Complete a verificação do negócio (Business Verification) quando solicitada.
- Publique a política de privacidade e os termos no domínio do app — a Meta exige as URLs no painel.

## 5. Requisitos das contas

- Conta **profissional** do Instagram (Empresa ou Criador de conteúdo). Contas pessoais não aparecem para autorização.
- Não é preciso vincular Página do Facebook no fluxo "Instagram login".

## 6. Conferindo

1. `GET /api/health/ready` deve responder `"metaConfigured": true`.
2. Em **Contas do Instagram**, clique em **Conectar Instagram**: o navegador vai para `www.instagram.com/oauth/authorize`, e volta para `/accounts?connected=<usuario>`.
3. Publique uma foto de teste. Se o job ficar com "O Instagram não conseguiu baixar a mídia pela URL pública" (subcódigo 2207052), a Meta não está alcançando `API_PUBLIC_URL` — verifique HTTPS, firewall e o proxy `/public` do nginx.

## Referências oficiais

- Instagram Platform — Instagram API with Instagram Login (Business Login for Instagram)
- Instagram Platform — Content Publishing
- Instagram Platform — Insights
- Graph API — Rate Limiting e Handling Errors
