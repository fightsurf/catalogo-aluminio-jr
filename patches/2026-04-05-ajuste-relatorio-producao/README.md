# Ajuste da tela `/legado/pedidos`

Este patch adiciona o botão **Imprimir relatório para produção** e faz o relatório abrir em modo produção, ocultando:
- preços
- subtotais
- total final

Também preserva os ajustes já feitos no módulo de pedidos:
- botão **Adicionar pagamentos**
- exibição de **Total pago** e **Saldo restante**
- integração do pedido com `/legado/pagamentos`

## Arquivos que precisam ser atualizados

- `views/legado/pedido/pedidos-legado.html`
- `views/legado/pedidos-relatorio/pedidos-relatorio.html`

## Observação

O conector do GitHub que tenho aqui conseguiu criar o branch e adicionar arquivos novos, mas bloqueou a sobrescrita direta desses dois arquivos existentes. Por isso, deixei abaixo o diff pronto no arquivo `ajuste-relatorio-producao.patch` desta mesma pasta.
