# AVN Água — miniaplicativo Zepp OS para Amazfit Balance

Esta pasta contém o **aplicativo do relógio**, não uma página para navegador nem um app Android.

## Protótipo 0.1.0

- Tela redonda 480 × 480, botão **+1.000 mL** e total do dia.
- Salva o total de cada dia em **armazenamento local persistente do relógio**, via `LocalStorage`. Funciona sem celular, Wi-Fi ou Bluetooth.
- Na virada do dia, o contador inicia em zero, sem apagar os dias anteriores.
- **Não envia dados ao AVN/Render ainda**. Não acessa ou altera o PostgreSQL nem qualquer pedido/cliente.

## Como instalar no seu Balance

1. Instale a [Zeus CLI](https://docs.zepp.com/docs/guides/tools/cli/overview/) e o [simulador Zepp OS](https://docs.zepp.com/docs/guides/quick-start/simulator-dev/) em um computador.
2. Crie um projeto na plataforma de desenvolvedores Zepp. Em `app.json`, **substitua o appId ilustrativo `1000000` pelo appId da sua conta**.
3. No terminal, dentro de `apps/avn-agua-balance`, rode `zeus dev` para testar no simulador Amazfit Balance.
4. No celular, abra Zepp → Perfil → Configurações → Sobre. Toque 7 vezes no ícone Zepp para habilitar o **Modo Desenvolvedor**.
5. No computador, execute `zeus preview` na pasta do aplicativo e escaneie o QR Code pelo recurso **Scan** do modo desenvolvedor no Zepp. O app será instalado no relógio para teste.

**Observação:** os fontes passaram por testes locais, mas a compilação Zeus e a instalação num Balance real ainda precisam ser feitas. O QR Code de instalação depende dessa compilação. Não confunda o QR de instalação com o link GitHub.

## Próximo passo

Após testar a interface no relógio, implementar a sincronização com a API de água do AVN e a proteção contra registros duplicados. A versão inicial salva apenas no relógio e não depende do celular.

Documentação oficial:

- https://docs.zepp.com/docs/reference/app-json/
- https://docs.zepp.com/docs/reference/device-app-api/newAPI/storage/localStorage/
- https://docs.zepp.com/docs/guides/quick-start/preview/
