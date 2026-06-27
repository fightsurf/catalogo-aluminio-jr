const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const botEvents = require('./src/services/bot/botEvents');
const { authRoutes } = require('./src/middlewares/adminAuth.middleware');

// =====================================================
// 📦 IMPORTAÇÃO DE ROTAS MODULARES
// =====================================================
const pedidosLegadoPageRoutes = require('./src/routes/legado/pedido/pedidosLegadoPage.routes');
const pedidosLegadoRoutes = require('./src/routes/legado/pedido/pedidosLegado.routes');
const clientesLegadoRoutes = require('./src/routes/legado/clientes/clientes.routes');
const clientesLegadoViewRoutes = require('./src/routes/legado/clientes/clientes.view.routes');
const pedidosClienteApiRoutes = require('./src/routes/legado/pedidos-cliente/pedidos-cliente.routes');
const pedidosClienteViewRoutes = require('./src/routes/legado/pedidos-cliente/pedidos-cliente.view.routes');
const pedidosInsercaoLegadoRoutes = require('./src/routes/legado/pedidos-insercao/pedidos-insercao.routes');
const pedidosInsercaoLegadoViewRoutes = require('./src/routes/legado/pedidos-insercao/pedidos-insercao.view.routes');
const itensLegadoRoutes = require('./src/routes/legado/itens/itens.routes');
const itensLegadoViewRoutes = require('./src/routes/legado/itens/itens.view.routes');
const carradasLegadoRoutes = require('./src/routes/legado/carradas/carradas.routes');
const carradasLegadoViewRoutes = require('./src/routes/legado/carradas/carradas.view.routes');
const carradasProgressoLegadoRoutes = require('./src/routes/legado/carradas-progresso/carradas-progresso.routes');
const semanasLegadoRoutes = require('./src/routes/legado/semanas/semanas.routes');
const semanasLegadoViewRoutes = require('./src/routes/legado/semanas/semanas.view.routes');
const pagamentosLegadoRoutes = require('./src/routes/legado/pagamentos/pagamentos.routes');
const pagamentosLegadoViewRoutes = require('./src/routes/legado/pagamentos/pagamentos.view.routes');
const clientesCreditosLegadoRoutes = require('./src/routes/legado/clientes-creditos/clientes-creditos.routes');
const clientesCreditosLegadoViewRoutes = require('./src/routes/legado/clientes-creditos/clientes-creditos.view.routes');
const vendedoresLegadoRoutes = require('./src/routes/legado/vendedores/vendedores.routes');
const vendedoresLegadoViewRoutes = require('./src/routes/legado/vendedores/vendedores.view.routes');
const dashboardPedidosLegadoRoutes = require('./src/routes/legado/dashboard-pedidos/dashboard-pedidos.routes');
const dashboardPedidosLegadoViewRoutes = require('./src/routes/legado/dashboard-pedidos/dashboard-pedidos.view.routes');
const pedidosRelatorioViewRoutes = require('./src/routes/legado/pedidos-relatorio/pedidos-relatorio.view.routes');

const botAutonomiaService = require('./src/services/bot/botAutonomia.services');
const botAutonomiaRoutes = require('./src/routes/bot/botAutonomia.routes');

const transportadorasRoutes = require('./src/routes/logistica/transportadorasRoutes');
const logisticaRoutes = require('./src/routes/logistica/logisticaRoutes');

const funcionarioRoutes = require('./src/routes/funcionario/funcionario.routes');
const fornecedorRoutes = require('./src/routes/fornecedor/fornecedor.routes');
const produtoRoutes = require('./src/routes/produto/produto.routes');
const produtoCategoriaRoutes = require('./src/routes/produtoCategoria/produtoCategoria.routes');
const insumoCategoriaRoutes = require('./src/routes/insumoCategoria/insumoCategoria.routes');
const insumoRoutes = require('./src/routes/insumo/insumo.routes');
const insumoDiscoRoutes = require('./src/routes/insumoDisco/insumoDisco.routes');
const insumoFornecedorRoutes = require('./src/routes/insumoFornecedor/insumoFornecedor.routes');
const pedidoFornecedorRoutes = require('./src/routes/pedidoFornecedor/pedidoFornecedor.routes');
const produtoComposicaoRoutes = require('./src/routes/produtoComposicao/produtoComposicao.routes');
const produtoResumoCustoRoutes = require('./src/routes/produtoResumoCusto/produtoResumoCusto.routes');
const volumeRoutes = require('./src/routes/volume/volume.routes');
const adminVolumeRoutes = require('./src/routes/volume/adminVolume.routes');
const prestacaoContasRoutes = require('./src/routes/prestacao_contas/prestacao_contas.routes');
const saidaCategoriaRoutes = require('./src/routes/saidas/saidaCategoria.routes');
const saidaItemRoutes = require('./src/routes/saidas/saidaItem.routes');
const saidaRoutes = require('./src/routes/saidas/saida.routes');
const fechamentoMensalRoutes = require('./src/routes/fechamento-mensal/fechamento-mensal.routes');

const botRoutes = require('./src/routes/bot/bot.routes');
const botAdminRoutes = require('./src/routes/bot/bot.admin.routes');
const executarIntencaoRoutes = require('./src/routes/bot/executar-intencao.routes');
const botContatosRoutes = require('./src/routes/bot/botContatos.routes');
const botIntencoesRoutes = require('./src/routes/bot/botIntencoes.routes');
const classificadorIntencaoRoutes = require('./src/routes/bot/classificadorIntencao.routes');
const botFluxoRoutes = require('./src/routes/bot/botFluxo.routes');
const relatorioAcrescimoApiRoutes = require('./src/routes/vendas/relatorio-acrescimo.routes');
const relatorioAcrescimoViewRoutes = require('./src/routes/vendas/relatorio-acrescimo.view.routes');
const pedidosInsercaoLegadoV2Routes = require('./src/routes/legado/pedidos-insercao-v2/pedidos-insercao-v2.routes');
const pedidosInsercaoLegadoV2ViewRoutes = require('./src/routes/legado/pedidos-insercao-v2/pedidos-insercao-v2.view.routes');
const pedidosInsercaoMobileViewRoutes = require('./src/routes/legado/pedidos-insercao-mobile/pedidos-insercao-mobile.view.routes');
const envioWhatsappRoutes = require('./src/routes/whatsapp/envio-whatsapp.routes');
const envioWhatsappViewRoutes = require('./src/routes/whatsapp/envio-whatsapp.view.routes');
const hubRoutes = require('./src/routes/hub/hub.routes');


const app = express();
app.set('trust proxy', 1);

// =====================================================
// 🔧 MIDDLEWARES
// =====================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authRoutes);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/prestacao_contas', express.static(path.join(__dirname, 'views', 'prestacao_contas')));

// =====================================================
// 📡 APIs
// =====================================================
app.use('/api/legado', pedidosLegadoRoutes);
app.use('/', pedidosLegadoPageRoutes);
app.use('/api/legado/clientes', clientesLegadoRoutes);
app.use('/legado/clientes', clientesLegadoViewRoutes);
app.use('/api/legado/pedidos-cliente', pedidosClienteApiRoutes);
app.use('/legado/pedidos-cliente', pedidosClienteViewRoutes);
app.use('/api/legado/pedidos-insercao', pedidosInsercaoLegadoRoutes);
app.use('/legado/pedidos-insercao', pedidosInsercaoLegadoViewRoutes);
app.use('/api/legado/itens', itensLegadoRoutes);
app.use('/legado/itens', itensLegadoViewRoutes);
app.use('/api/legado/carradas', carradasLegadoRoutes);
app.use('/api/legado/carradas-progresso', carradasProgressoLegadoRoutes);
app.use('/legado/carradas', carradasLegadoViewRoutes);
app.use('/api/legado/semanas', semanasLegadoRoutes);
app.use('/legado/semanas', semanasLegadoViewRoutes);
app.use('/api/legado/pagamentos', pagamentosLegadoRoutes);
app.use('/legado/pagamentos', pagamentosLegadoViewRoutes);
app.use('/api/legado/clientes-creditos', clientesCreditosLegadoRoutes);
app.use('/legado/clientes-creditos', clientesCreditosLegadoViewRoutes);
app.use('/api/legado/vendedores', vendedoresLegadoRoutes);
app.use('/legado/vendedores', vendedoresLegadoViewRoutes);
app.use('/api/legado/dashboard-pedidos', dashboardPedidosLegadoRoutes);
app.use('/legado/dashboard-pedidos', dashboardPedidosLegadoViewRoutes);
app.use('/legado/pedidos-relatorio', pedidosRelatorioViewRoutes);
app.use('/api/vendas', relatorioAcrescimoApiRoutes);
app.use('/vendas', relatorioAcrescimoViewRoutes);

app.use('/bot/autonomia', botAutonomiaRoutes);
app.use('/api/produtos-categorias', produtoCategoriaRoutes);
app.use('/api/insumos-categorias', insumoCategoriaRoutes);
app.use('/api/insumos', insumoRoutes);
app.use('/api/insumos-discos', insumoDiscoRoutes);
app.use('/api/insumos-fornecedores', insumoFornecedorRoutes);
app.use('/api/pedidos-fornecedores', pedidoFornecedorRoutes);
app.use('/api/produtos-composicoes', produtoComposicaoRoutes);
app.use('/api/produtos-resumo-custos', produtoResumoCustoRoutes);
app.use('/api/produtos', produtoRoutes);
app.use('/api/transportadoras', transportadorasRoutes);
app.use('/api/logistica', logisticaRoutes);
app.use('/api/funcionarios', funcionarioRoutes);
app.use('/api/fornecedores', fornecedorRoutes);
app.use('/api/volume', volumeRoutes);
app.use('/api/admin-volume', adminVolumeRoutes);
app.use('/api/prestacoes', prestacaoContasRoutes);
app.use('/api/saidas-categorias', saidaCategoriaRoutes);
app.use('/api/saidas-itens', saidaItemRoutes);
app.use('/api/saidas', saidaRoutes);
app.use('/api/fechamento-mensal', fechamentoMensalRoutes);
app.use('/api/legado/pedidos-insercao-v2', pedidosInsercaoLegadoV2Routes);
app.use('/legado/pedidos-insercao-v2', pedidosInsercaoLegadoV2ViewRoutes);
app.use('/legado/pedidos-insercao-mobile', pedidosInsercaoMobileViewRoutes);
app.use('/api/whatsapp', envioWhatsappRoutes);
app.use('/whatsapp', envioWhatsappViewRoutes);
app.use('/hub', hubRoutes);

app.use('/bot', botRoutes);
app.use('/bot/admin', botAdminRoutes);
app.use('/bot/admin', executarIntencaoRoutes);
app.use('/api/bot', botContatosRoutes);
app.use('/bot', botIntencoesRoutes);
app.use('/bot', classificadorIntencaoRoutes);
app.use('/bot/fluxo', botFluxoRoutes);

app.use('/bot-admin', express.static(path.join(__dirname, 'views', 'bot-admin')));

app.get('/bot/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'index.html'));
});

// =====================================================
// 📦 ROTAS DE PÁGINAS (VIEWS)
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

app.get('/catalogo-celular', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo-celular.html'));
});

app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/admin-produtos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'produto', 'admin-produtos.html'));
});

app.get('/admin-insumos-categorias', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'insumoCategoria', 'admin-insumo-categoria.html'));
});

app.get('/admin-insumos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'insumo', 'admin-insumo.html'));
});

app.get('/admin-insumos-discos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'insumoDisco', 'admin-insumo-disco.html'));
});

app.get('/admin-insumos-fornecedores', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'insumoFornecedor', 'admin-insumo-fornecedor.html'));
});

app.get('/admin-pedido-fornecedor', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'pedidoFornecedor', 'admin-pedido-fornecedor.html'));
});

app.get('/admin-produtos-composicao', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'produtoComposicao', 'admin-produto-composicao.html'));
});

app.get('/admin-produtos-resumo-custos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'produtoResumoCusto', 'admin-produtos-resumo-custos.html'));
});

app.get('/kits-feirinha', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kits-feirinha.html'));
});

app.get('/kits-feirinha-retomar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kits-feirinha-retomar.html'));
});

app.get('/orcamento', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orcamento.html'));
});

app.get('/orcamento-retomar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orcamento-retomar.html'));
});


app.get('/conversor-relatorios-venda', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'vendas', 'conversor-relatorios-venda.html'));
});

app.get('/combinador', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'combinador.html'));
});

// 🔥 LOGÍSTICA (MOVIDO PARA PASTA /logistica)

app.get('/admin-logistica', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica', 'logistica-admin.html'));
});

app.get('/logistica-estado', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica', 'logistica-estado.html'));
});

app.get('/frete', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica', 'frete-bot.html'));
});

// 🔥 FUNCIONÁRIOS
app.get('/admin-funcionarios', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'funcionario', 'admin-funcionario.html'));
});

// 🔥 FORNECEDORES
app.get('/admin-fornecedores', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'fornecedor', 'admin-fornecedor.html'));
});

// 🔥 FOTOS
app.get('/admin-fotos-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-fotos.html'));
});

// 🔥 VOLUME
app.get('/calcular-volumes', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'volume', 'volume.html'));
});

app.get('/admin-volume', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'volume', 'admin-volume.html'));
});

// 🔥 PRESTAÇÃO DE CONTAS
app.get('/prestacao-contas', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'prestacao_contas', 'prestacao.html'));
});

// 🔥 SAÍDAS DE DINHEIRO
app.get('/admin-saidas-categorias', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saida-categoria.html'));
});

app.get('/admin-saidas-itens', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saida-item.html'));
});

app.get('/admin-saidas', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saidas.html'));
});

app.get('/admin-saidas-consulta', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saidas-consulta.html'));
});

app.get('/admin-saidas-carne', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saidas-carne.html'));
});

app.get('/admin-saidas-boletos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'admin-saidas-boletos.html'));
});

app.get('/relatorio-saidas', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas', 'relatorio-saidas.html'));
});

app.get('/fechamento-mensal', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'fechamento-mensal', 'fechamento-mensal.html'));
});

// 🔥 BOT
app.get('/bot/contatos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'bot-contatos.html'));
});

app.get('/bot/intencoes-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'bot-intencoes.html'));
});

app.get('/bot/fluxo', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'bot', 'botFluxo.html'));
});

// =====================================================
// 🚀 SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

// Criar índices ao iniciar
const botAdminService = require('./src/services/bot/bot.admin.service');
botAdminService.criarIndices().catch(err =>
  console.warn('⚠️  Índices bot (não crítico):', err.message)
);

const saidaSchemaService = require('./src/services/saidas/saidaSchema.service');
saidaSchemaService.criarEstrutura().catch(err =>
  console.warn('⚠️  Estrutura de saídas (não crítico):', err.message)
);

const produtoComposicaoSchemaService = require('./src/services/produtoComposicao/produtoComposicaoSchema.service');
produtoComposicaoSchemaService.criarEstrutura().catch(err =>
  console.warn('⚠️  Estrutura de composição/custos dos produtos (não crítico):', err.message)
);

// =====================================================
// 🔌 WEBSOCKET – Bot Admin
// =====================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/bot-admin' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

botEvents.on('nova_mensagem', ({ telefone }) => {
  broadcast({ tipo: 'nova_mensagem', telefone });

  botAutonomiaService
    .processarTelefoneAutonomamente({ telefone, porta: PORT })
    .catch(err =>
      console.error('[botAutonomia] erro ao disparar processamento:', err.message)
    );
});

server.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando na porta', PORT);
});
