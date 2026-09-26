const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_FILE = path.join(ROOT, 'server.js');

const EXCLUDED_PREFIXES = [
  '/api', '/auth', '/login', '/ws', '/mirian', '/ofertas/', '/pedido/'
];

const EXCLUDED_EXACT = new Set([
  '/bot/admin', '/hub/config'
]);

const OVERRIDES = {
  '/': { nome: 'Catálogo', categoria: 'Vendas', icone: 'store', descricao: 'Catálogo principal de produtos.' },
  '/catalogo-celular': { nome: 'Catálogo Celular', categoria: 'Vendas', icone: 'smartphone', descricao: 'Catálogo otimizado para celular.' },
  '/orcamento': { nome: 'Montar Pedido', categoria: 'Vendas', icone: 'shopping-cart', descricao: 'Montagem de orçamento e pedido pelo catálogo.' },
  '/kits-feirinha': { nome: 'Kit Feirinha', categoria: 'Vendas', icone: 'package', descricao: 'Montagem dos kits para lojas de preço único.' },
  '/central-ofertas': { nome: 'Central de Ofertas', categoria: 'Marketing', icone: 'megaphone', descricao: 'Montagem e publicação de ofertas.' },
  '/whatsapp/status': { nome: 'Status WhatsApp', categoria: 'Marketing', icone: 'message-circle', descricao: 'Publicação de fotos e vídeos nos status e redes.' },
  '/status-videos': { nome: 'Status Vídeos', categoria: 'Marketing', icone: 'video', descricao: 'Geração e publicação de vídeos promocionais.' },
  '/whatsapp/relatorios-recebidos': { nome: 'Relatórios WhatsApp Recebidos', categoria: 'WhatsApp', icone: 'inbox', descricao: 'Relatórios recebidos dos clientes pelo WhatsApp.' },
  '/whatsapp/relatorio-fotos': { nome: 'Relatório de Fotos WhatsApp', categoria: 'WhatsApp', icone: 'image', descricao: 'Consulta e organização de relatórios de fotos.' },
  '/whatsapp/enviar': { nome: 'Enviar WhatsApp', categoria: 'WhatsApp', icone: 'send', descricao: 'Envio manual de mensagens pelo WhatsApp.' },
  '/legado/carradas': { nome: 'Carradas', categoria: 'Produção', icone: 'truck', descricao: 'Consulta e gerenciamento de carradas.' },
  '/legado/carradas/progresso': { nome: 'Progresso da Carrada', categoria: 'Produção', icone: 'activity', descricao: 'Acompanhamento operacional dos pedidos da carrada.' },
  '/legado/semanas': { nome: 'Semanas', categoria: 'Produção', icone: 'calendar', descricao: 'Planejamento e acompanhamento semanal da produção.' },
  '/legado/pedidos': { nome: 'Pedidos', categoria: 'Vendas', icone: 'clipboard-list', descricao: 'Consulta dos pedidos do sistema legado.' },
  '/legado/pedidos-cliente': { nome: 'Pedidos por Cliente', categoria: 'Vendas', icone: 'users', descricao: 'Histórico e resumo de pedidos por cliente.' },
  '/legado/pedidos-insercao-v2': { nome: 'Inserir Pedido', categoria: 'Vendas', icone: 'file-plus', descricao: 'Inserção de pedido por produtos ou relatório WhatsApp.' },
  '/legado/pagamentos': { nome: 'Pagamentos', categoria: 'Financeiro', icone: 'wallet', descricao: 'Consulta de pagamentos do sistema legado.' },
  '/legado/pagamentos/distribuir': { nome: 'Distribuir Pagamentos', categoria: 'Financeiro', icone: 'split', descricao: 'Distribuição de pagamentos entre pedidos.' },
  '/legado/pagamentos/realizados': { nome: 'Pagamentos Realizados', categoria: 'Financeiro', icone: 'circle-check', descricao: 'Pesquisa de pagamentos realizados.' },
  '/legado/cheques': { nome: 'Cheques', categoria: 'Financeiro', icone: 'banknote', descricao: 'Consulta e acompanhamento de cheques.' },
  '/legado/clientes-creditos': { nome: 'Créditos de Clientes', categoria: 'Financeiro', icone: 'badge-dollar-sign', descricao: 'Créditos disponíveis e extratos dos clientes.' },
  '/admin-saidas': { nome: 'Despesas', categoria: 'Financeiro', icone: 'receipt', descricao: 'Lançamento e gestão das despesas da fábrica.' },
  '/admin-saidas-categorias': { nome: 'Categorias de Despesas', categoria: 'Financeiro', icone: 'folders', descricao: 'Cadastro das categorias de despesas.' },
  '/admin-saidas-itens': { nome: 'Tipos de Despesas', categoria: 'Financeiro', icone: 'list-tree', descricao: 'Cadastro dos tipos de despesas por categoria.' },
  '/admin-saidas-consulta': { nome: 'Consulta de Despesas', categoria: 'Financeiro', icone: 'search', descricao: 'Pesquisa dos lançamentos de despesas.' },
  '/relatorio-saidas': { nome: 'Relatório de Despesas', categoria: 'Financeiro', icone: 'chart-column', descricao: 'Relatórios consolidados de saídas.' },
  '/fechamento-mensal': { nome: 'Fechamento Mensal', categoria: 'Financeiro', icone: 'calendar-check', descricao: 'Fechamento financeiro mensal.' },
  '/admin-logistica': { nome: 'Logística', categoria: 'Logística', icone: 'route', descricao: 'Cadastro e administração da logística.' },
  '/admin-logistica/agencias': { nome: 'Agências de Recebimento', categoria: 'Logística', icone: 'warehouse', descricao: 'Cadastro de agências de recebimento.' },
  '/logistica-estado': { nome: 'Logística por Estado', categoria: 'Logística', icone: 'map', descricao: 'Consulta logística organizada por estado.' },
  '/frete': { nome: 'Frete', categoria: 'Logística', icone: 'truck', descricao: 'Ferramenta de apoio ao cálculo e consulta de fretes.' },
  '/admin-produtos': { nome: 'Produtos', categoria: 'Cadastros', icone: 'package-search', descricao: 'Cadastro e manutenção dos produtos.' },
  '/admin-produtos-perfis': { nome: 'Perfis de Produtos', categoria: 'Cadastros', icone: 'tags', descricao: 'Perfis comerciais e classificações de produtos.' },
  '/admin-fornecedores': { nome: 'Fornecedores', categoria: 'Cadastros', icone: 'factory', descricao: 'Cadastro de fornecedores.' },
  '/admin-funcionarios': { nome: 'Funcionários', categoria: 'Cadastros', icone: 'contact', descricao: 'Cadastro de funcionários.' },
  '/vendas/termometro-vendas': { nome: 'Termômetro de Vendas', categoria: 'Análises', icone: 'thermometer', descricao: 'Relação entre divulgação e vendas dos produtos.' },
  '/vendas/performance-vendas': { nome: 'Performance de Vendas', categoria: 'Análises', icone: 'chart-no-axes-combined', descricao: 'Indicadores e desempenho comercial.' },
  '/vendas/performance-expedicao': { nome: 'Performance de Expedição', categoria: 'Análises', icone: 'gauge', descricao: 'Indicadores do processo de expedição.' },
  '/vendas/expedidos-pendentes': { nome: 'Expedidos Pendentes', categoria: 'Análises', icone: 'triangle-alert', descricao: 'Pedidos expedidos com pendências.' },
  '/vendas/relatorio-acrescimo': { nome: 'Relatório de Acréscimo', categoria: 'Análises', icone: 'chart-spline', descricao: 'Análise de acréscimos nas vendas.' },
  '/conversor-relatorios-venda': { nome: 'Conversor de Relatórios', categoria: 'Ferramentas', icone: 'repeat-2', descricao: 'Conversão de relatórios de venda.' },
  '/combinador': { nome: 'Combinador', categoria: 'Ferramentas', icone: 'combine', descricao: 'Ferramenta de combinação de informações.' },
  '/calcular-volumes': { nome: 'Calcular Volumes', categoria: 'Ferramentas', icone: 'boxes', descricao: 'Cálculo de volumes de pedidos.' },
  '/hub': { nome: 'Hub', categoria: 'Ferramentas', icone: 'network', descricao: 'Hub de integrações e serviços.' },
};

function normalizeRoute(route) {
  if (!route) return '/';
  let value = String(route).trim();
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+/g, '/');
  if (value.length > 1) value = value.replace(/\/$/, '');
  return value;
}

function joinRoutes(prefix, child) {
  const p = normalizeRoute(prefix || '/');
  const c = normalizeRoute(child || '/');
  if (p === '/') return c;
  if (c === '/') return p;
  return normalizeRoute(`${p}/${c.replace(/^\//, '')}`);
}

function isLaunchable(route) {
  if (!route || route.includes(':') || route.includes('*')) return false;
  if (EXCLUDED_EXACT.has(route)) return false;
  if (EXCLUDED_PREFIXES.some(prefix => route === prefix || route.startsWith(prefix))) return false;
  if (/\/(mobile|mobile\/detalhe|detalhe|resumo|extrato)$/.test(route)) return false;
  if (/\/resumo-(itens|producao|selecionado)$/.test(route)) return false;
  if (/\/pedidos-insercao\/relatorio$/.test(route)) return false;
  return true;
}

function humanizeRoute(route) {
  const last = route === '/' ? 'Catálogo' : route.split('/').filter(Boolean).pop();
  return String(last || 'Aplicativo')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function classify(route) {
  if (route.includes('whatsapp')) return 'WhatsApp';
  if (route.includes('status') || route.includes('oferta') || route.includes('kit')) return 'Marketing';
  if (route.includes('carrada') || route.includes('semana')) return 'Produção';
  if (route.includes('logistica') || route.includes('frete') || route.includes('agencia')) return 'Logística';
  if (route.includes('pagamento') || route.includes('cheque') || route.includes('saida') || route.includes('fechamento') || route.includes('prestacao')) return 'Financeiro';
  if (route.includes('performance') || route.includes('termometro') || route.includes('relatorio')) return 'Análises';
  if (route.includes('admin-') || route.includes('/admin/')) return 'Cadastros';
  if (route.includes('pedido') || route.includes('cliente') || route.includes('vendedor') || route.includes('orcamento') || route.includes('catalogo')) return 'Vendas';
  return 'Ferramentas';
}

function defaultIcon(category) {
  return ({
    'Vendas': 'shopping-bag', 'Produção': 'factory', 'Financeiro': 'circle-dollar-sign',
    'Logística': 'truck', 'Marketing': 'megaphone', 'WhatsApp': 'message-circle',
    'Cadastros': 'database', 'Análises': 'chart-column', 'Ferramentas': 'wrench'
  })[category] || 'app-window';
}

function readFileSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function parseRouterGets(filePath) {
  const source = readFileSafe(filePath);
  const routes = [];
  const regex = /router\.get\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(source))) routes.push(match[1]);
  return routes;
}

function discoverRoutes() {
  const serverSource = readFileSafe(SERVER_FILE);
  const routes = new Set();

  // Páginas declaradas diretamente em server.js.
  const directGetRegex = /app\.get\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = directGetRegex.exec(serverSource))) {
    const route = normalizeRoute(match[1]);
    if (isLaunchable(route)) routes.add(route);
  }

  // Mapeia variáveis require(...) -> arquivo de rota.
  const requires = new Map();
  const requireRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(serverSource))) {
    requires.set(match[1], match[2]);
  }

  // Descobre routers de VIEW montados com app.use(prefixo, router).
  const useRegex = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:requireAuth\s*,\s*)?([A-Za-z0-9_]+)\s*\)/g;
  while ((match = useRegex.exec(serverSource))) {
    const prefix = match[1];
    const variable = match[2];
    const required = requires.get(variable);
    if (!required) continue;

    const looksLikeView = /view\.routes|Page\.routes|hub\.routes/i.test(required) || /ViewRoutes$|PageRoutes$|hubRoutes$/i.test(variable);
    if (!looksLikeView) continue;

    const absolute = path.resolve(ROOT, `${required}.js`.replace(/\.js\.js$/, '.js'));
    for (const child of parseRouterGets(absolute)) {
      const route = joinRoutes(prefix, child);
      if (isLaunchable(route)) routes.add(route);
    }
  }

  return [...routes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function getCatalog() {
  return discoverRoutes().map((rota) => {
    const override = OVERRIDES[rota] || {};
    const categoria = override.categoria || classify(rota);
    return {
      id: Buffer.from(rota).toString('base64url'),
      rota,
      nome: override.nome || humanizeRoute(rota),
      categoria,
      icone: override.icone || defaultIcon(categoria),
      descricao: override.descricao || `Abrir ${humanizeRoute(rota)}.`,
      conhecido: Boolean(OVERRIDES[rota]),
    };
  });
}

function getSummary() {
  const apps = getCatalog();
  const categorias = [...new Set(apps.map(app => app.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    atualizadoEm: new Date().toISOString(),
    total: apps.length,
    categorias,
    apps,
  };
}

module.exports = { getCatalog, getSummary };
