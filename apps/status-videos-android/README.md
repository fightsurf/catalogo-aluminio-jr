# Alumínio JR · Status Vídeos (Android)

Aplicativo Android nativo que recebe **Compartilhar > Vídeo** diretamente da galeria.
Aparece como **Alumínio JR · Status Vídeos**, sem ler a galeria inteira e sem permissão de armazenamento.

## Fluxo
1. Compartilhe um único vídeo da galeria para **Alumínio JR · Status Vídeos**, ou abra o app e toque em **Escolher outro vídeo**.
2. Entre com a mesma conta administrativa do site (se a sessão de 8h expirou).
3. Escolha **Vídeo promocional** (nenhum item exigido) ou **Kit feirinha** (busque os produtos, marque e informe quantidades).
4. Confira o vídeo e toque em **Gerar vídeo e publicar nas redes**.
5. O app faz upload para a API preexistente e consulta \`/api/status-videos/publicacoes/{requestId}\` até concluir, mostrando os cinco canais separadamente.

## Segurança e limites
- Endpoint fixo HTTPS: \`https://catalogo-aluminio-jr.onrender.com\`.
- Login administrativo via \`POST /auth/login\`, com a mesma autenticação do site.
- Nunca salva usuário nem senha. Somente o cookie de sessão fica cifrado com Android Keystore, e o aplicativo confere sua validade no servidor.
- Não utiliza chaves de WhatsApp/Instagram/Facebook/YouTube; todas permanecem no backend.
- Envia somente o vídeo explicitamente compartilhado, via streaming (sem carregar 250 MB em memória).
- Limites do serviço atual: arquivo até 250 MB e duração de 3 a 55 segundos.
- Reutiliza \`POST /api/status-videos/publicar\`, com campos \`video\`, \`request_id\`, \`tipo_video\` e \`itens\`.
- O envio pode continuar no servidor após o HTTP 202; enquanto o telefone está no app o status é consultado. Se a tela fechar ou o servidor reiniciar, o acompanhamento pode ser perdido; **não repetir publicação sem verificar o resultado**.
- Os canais podem apresentar resultados parciais, dependendo das credenciais e disponibilidade do backend.

## Construção

Abrir a pasta \`apps/status-videos-android\` no Android Studio com JDK 17 e Android SDK 35.
No terminal, com Gradle 8.10.2 instalado: \`gradle :app:assembleDebug\`.
O APK de testes fica em \`app/build/outputs/apk/debug/app-debug.apk\`.

O workflow \`.github/workflows/status-videos-android.yml\` tenta compilar automaticamente o APK de testes em pushes relevantes e disponibiliza o arquivo como artefato da execução no GitHub Actions.

**Status:** implementação inicial. Testes de compilação, instalação no aparelho, autenticação e publicação real devem ser verificados antes de uso em produção.
