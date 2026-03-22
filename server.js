const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const botEvents = require('./src/services/bot/botEvents');

// =====================================================
// 📦 IMPORTAÇÃO DE ROTAS MODULARES
// =====================================================
const pedidosLegadoPageRoutes = require('./src/routes/legado/pedido/pedidosLegadoPage.routes');
const pedidosLegadoRoutes = require('./src/routes/legado/pedido/pedidosLegado.routes');
const clientesLegadoRoutes = require('./src/routes/legado/clientes/clientes.routes');
const clientesLegadoViewRoutes = require('./src/routes/legado/clientes/clientes.view.routes');
const pedidosClienteApiRoutes = require('./src/routes/legado/pedidos-cliente/pedidos-cliente.routes');
const pedidosClienteViewRoutes = require('./src/routes/legado/pedidos-cliente/pedidos-cliente.view.routes');



const botAutonomiaService = require('./src/services/bot/botAutonomia.services');
const botAutonomiaRoutes = require('./src/routes/bot/botAutonomia.routes');

const transportadorasRoutes = require('./src/routes/logistica/transportadorasRoutes');
const logisticaRoutes = require('./src/routes/logistica/logisticaRoutes');

const funcionarioRoutes = require('./src/routes/funcionario/funcionario.routes');
const fornecedorRoutes = require('./src/routes/fornecedor/fornecedor.routes');
const produtoRoutes = require('./src/routes/produto/produto.routes');
const produtoCategoriaRoutes = require('./src/routes/produtoCategoria/produtoCategoria.routes');
const volumeRoutes = require('./src/routes/volume/volume.routes');
const adminVolumeRoutes = require('./src/routes/volume/adminVolume.routes');
const prestacaoContasRoutes = require('./src/routes/prestacao_contas/prestacao_contas.routes');

const botRoutes = require('./src/routes/bot/bot.routes');
const botAdminRoutes = require('./src/routes/bot/bot.admin.routes');
const botContatosRoutes = require('./src/routes/bot/botContatos.routes');
const botIntencoesRoutes = require('./src/routes/bot/botIntencoes.routes');
const classificadorIntencaoRoutes = require('./src/routes/bot/classificadorIntencao.routes');
const botFluxoRoutes = require('./src/routes/bot/botFluxo.routes');

const app = express();

// =====================================================
// 🔧 MIDDLEWARES
// =====================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.use('/bot/autonomia', botAutonomiaRoutes);
app.use('/api/produtos-categorias', produtoCategoriaRoutes);
app.use('/api/produtos', produtoRoutes);
app.use('/api/transportadoras', transportadorasRoutes);
app.use('/api/logistica', logisticaRoutes);
app.use('/api/funcionarios', funcionarioRoutes);
app.use('/api/fornecedores', fornecedorRoutes);
app.use('/api/volume', volumeRoutes);
app.use('/api/admin-volume', adminVolumeRoutes);
app.use('/api/prestacoes', prestacaoContasRoutes);

app.use('/bot', botRoutes);
app.use('/bot/admin', botAdminRoutes);
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

app.get('/kits-feirinha', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kits-feirinha.html'));
});

app.get('/orcamento', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orcamento.html'));
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
