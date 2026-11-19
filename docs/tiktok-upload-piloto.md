# TikTok — piloto de upload MP4 da Alumínio JR (19/11/2026)

## Escopo

O piloto **não faz publicação pública automática**. O TikTok só aceita publicação direta de apps aprovados para video.publish e impõe limitações a ferramentas de uso apenas interno. O piloto usa video.upload, que prepara o vídeo para finalização manual na caixa de entrada do TikTok.

Rota protegida: /marketing/tiktok.

1. Administrador acessa a tela.
2. Seleciona um MP4 de até **30 MB**.
3. Clica em **Testar apenas o upload**: arquivo recebido na memória, tamanho e hash SHA-256 informados, sem gravação e sem envio ao TikTok.
4. Se a aplicação de desenvolvedor estiver autorizada, clica em **Conectar com TikTok**.
5. Após autorizar o escopo video.upload, seleciona o vídeo e clica em **Enviar ao TikTok**.
6. O serviço inicia /v2/post/publish/inbox/video/init/, transfere o MP4 por PUT, recebe publish_id e responde **aguardando ação do usuário**.
7. O titular da conta abre a notificação no aplicativo TikTok e conclui a postagem. A tela permite consultar /v2/post/publish/status/fetch/.

## Configuração no Render

Criar uma aplicação no [TikTok for Developers](https://developers.tiktok.com/) com Login Kit e Content Posting API / Upload; solicitar as permissões user.info.basic e video.upload. As permissões dependem de aprovação pelo TikTok.

Cadastrar a URI de redirecionamento no TikTok, idêntica à variável de ambiente abaixo.

Variáveis adicionais do serviço já existente:
- TIKTOK_CLIENT_KEY: chave pública do aplicativo de desenvolvedor.
- TIKTOK_CLIENT_SECRET: segredo do aplicativo, configurado no Render; nunca no repositório.
- TIKTOK_REDIRECT_URI: por exemplo https://catalogo-aluminio-jr.onrender.com/marketing/tiktok/oauth/callback (usar exatamente a URL registrada).

A criptografia temporária do token usa a variável existente ADMIN_SESSION_SECRET. Tokens de acesso ficam em cookie HttpOnly/Secure (HTTPS) criptografado, válidos por até duas horas. Não existe persistência/refresh automático neste piloto: para nova sessão, reconectar a conta.

## Restrições e segurança

- A página e as APIs exigem login administrativo.
- Upload MP4 único de até 30 MB, conferido por assinatura ftyp.
- O vídeo não é salvo no banco, bucket ou disco: só permanece na memória durante o processamento.
- Upload e envio não são confundidos com publicação concluída.
- Falhas de transferência com resultado incerto **não são repetidas automaticamente** para evitar duplicação.
- Não publicar vídeos da empresa via Direct Post sem autorização explícita e adequada ao caso de uso.
- Se a API for indisponível ou não aprovada para esta finalidade, publicar manualmente pelo aplicativo ou TikTok Studio.

## Verificações antes de publicar em produção

- [ ] Conferir se as credenciais e escopos foram concedidos.
- [ ] Abrir a rota com e sem login: apenas o administrador acessa.
- [ ] Testar um MP4 pequeno com **Testar apenas o upload**.
- [ ] Conferir rejeição de arquivo não MP4 e de arquivo acima do limite.
- [ ] Conectar a conta TikTok com OAuth e validar que o token não aparece ao navegador.
- [ ] Enviar vídeo para caixa de entrada e receber publish_id.
- [ ] Abrir a notificação no TikTok e concluir publicação manual.
- [ ] Consultar status: nunca apresentar "publicado" antes de PUBLISH_COMPLETE.

Referências oficiais:
- https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video
- https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status
- https://developers.tiktok.com/docs/en/content-sharing-guidelines
- https://developers.tiktok.com/docs/en/login-kit-web
