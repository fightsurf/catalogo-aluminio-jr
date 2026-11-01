# Republicador YouTube: Node local -> Render

O Render solicita download ao Node da fábrica pela ponte HTTPS já usada pelo Firebird. Em seguida transfere o MP4 (streaming) e mantém o processamento atual via FFmpeg, Cloudflare R2 e publicadores existentes.

**Pré-requisitos:** aplicar o patch local de 01/11/2026, reiniciar o Node local (porta 3007) e manter o Cloudflare Tunnel funcionando. O ambiente Render reutiliza LEGADO_BRIDGE_URL (raiz HTTPS, sem caminho) e LEGADO_BRIDGE_API_KEY (mesmo valor de API_KEY no .env local). Não divulgar segredos ou inserir chaves no GitHub.

**Teste sem publicação:** acessar /marketing/republicador-youtube, clicar em Verificar integrações e conferir node_local.acessivel e node_local.canal_configurado. Depois selecionar um vídeo próprio e clicar em **Testar download**. O teste baixa no Windows, transfere para Render, prepara mídia e usa R2 temporário, sem enviar para redes. Somente após esse teste usar Publicar nas 3 redes, com confirmação.

**Proteções:** HTTPS obrigatório, sem redirecionamentos; token x-api-key só no cabeçalho; limite de 250 MB; vídeo próprio validado pelo worker; MP4 validado após transferência; tempo limite; falhas registradas sem publicação. A integração não modifica as rotas do Firebird.

Testes automáticos sem conexão real nem publicações: node --test tests/republicador-youtube-local.test.js
