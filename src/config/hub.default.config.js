const HUB_DEFAULT_CONFIG = {
  appTitle: 'Central de Módulos',
  appSubtitle: 'Alumínio JR',
  iframeInitialUrl: '/legado/dashboard-pedidos',
  modules: [
    {
      id: 'dashboard-pedidos',
      nome: 'Últimos Pedidos e Carradas',
      descricao: 'Dashboard operacional com pedidos e carradas recentes.',
      categoria: 'Operação',
      url: '/legado/dashboard-pedidos',
      embedUrl: '/legado/dashboard-pedidos?embed=1',
      imageUrl: '',
      icon: '📊',
      openMode: 'iframe',
      active: true,
      tags: ['dashboard', 'ultimos', 'pedidos', 'carradas']
    },
    {
      id: 'pedidos',
      nome: 'Pedidos',
      descricao: 'Consulta de pedidos do legado.',
      categoria: 'Operação',
      url: '/legado/pedidos',
      embedUrl: '/legado/pedidos?embed=1',
      imageUrl: '',
      icon: '📦',
      openMode: 'iframe',
      active: true,
      tags: ['pedido', 'pedidos', 'cliente', 'numero']
    },
    {
      id: 'pagamentos',
      nome: 'Pagamentos',
      descricao: 'Pagamentos por pedido.',
      categoria: 'Financeiro',
      url: '/legado/pagamentos',
      embedUrl: '/legado/pagamentos?embed=1',
      imageUrl: '',
      icon: '💰',
      openMode: 'iframe',
      active: true,
      tags: ['pagamento', 'financeiro', 'saldo']
    },
    {
      id: 'carradas',
      nome: 'Carradas',
      descricao: 'Montagem e consulta de carradas.',
      categoria: 'Logística',
      url: '/legado/carradas',
      embedUrl: '/legado/carradas?embed=1',
      imageUrl: '',
      icon: '🚚',
      openMode: 'iframe',
      active: true,
      tags: ['carrada', 'entrega', 'logistica']
    },
    {
      id: 'semanas',
      nome: 'Semanas',
      descricao: 'Semanas com carradas agrupadas.',
      categoria: 'Logística',
      url: '/legado/semanas',
      embedUrl: '/legado/semanas?embed=1',
      imageUrl: '',
      icon: '🗓️',
      openMode: 'iframe',
      active: true,
      tags: ['semana', 'planejamento']
    },
    {
      id: 'pedidos-insercao-v2',
      nome: 'Inserção Pedido V2',
      descricao: 'Inserção de pedido no legado pela versão 2.',
      categoria: 'Integrações',
      url: '/legado/pedidos-insercao-v2',
      embedUrl: '/legado/pedidos-insercao-v2?embed=1',
      imageUrl: '',
      icon: '🧾',
      openMode: 'iframe',
      active: true,
      tags: ['pedido', 'insercao', 'legado']
    },
    {
      id: 'bot-admin',
      nome: 'Bot Admin',
      descricao: 'Administração do bot e das conversas.',
      categoria: 'Integrações',
      url: '/bot/admin',
      embedUrl: '/bot/admin?embed=1',
      imageUrl: '',
      icon: '🤖',
      openMode: 'iframe',
      active: true,
      tags: ['bot', 'admin', 'whatsapp']
    },
    {
      id: 'whatsapp-enviar',
      nome: 'Enviar WhatsApp',
      descricao: 'Tela de envio para WhatsApp.',
      categoria: 'Integrações',
      url: '/whatsapp/enviar',
      embedUrl: '/whatsapp/enviar?embed=1',
      imageUrl: '',
      icon: '💬',
      openMode: 'iframe',
      active: true,
      tags: ['whatsapp', 'envio']
    },
    {
      id: 'produtos-admin',
      nome: 'Produtos',
      descricao: 'Cadastro de produtos.',
      categoria: 'Cadastros',
      url: '/admin-produtos',
      embedUrl: '/admin-produtos?embed=1',
      imageUrl: '',
      icon: '🏷️',
      openMode: 'iframe',
      active: true,
      tags: ['produto', 'cadastro']
    },
    {
      id: 'fornecedores-admin',
      nome: 'Fornecedores',
      descricao: 'Cadastro de fornecedores.',
      categoria: 'Cadastros',
      url: '/admin-fornecedores',
      embedUrl: '/admin-fornecedores?embed=1',
      imageUrl: '',
      icon: '🏭',
      openMode: 'iframe',
      active: true,
      tags: ['fornecedor', 'cadastro']
    },
    {
      id: 'funcionarios-admin',
      nome: 'Funcionários',
      descricao: 'Cadastro de funcionários.',
      categoria: 'Cadastros',
      url: '/admin-funcionarios',
      embedUrl: '/admin-funcionarios?embed=1',
      imageUrl: '',
      icon: '👥',
      openMode: 'iframe',
      active: true,
      tags: ['funcionario', 'cadastro']
    },
    {
      id: 'logistica-admin',
      nome: 'Logística',
      descricao: 'Transportadoras e cidades.',
      categoria: 'Cadastros',
      url: '/admin-logistica',
      embedUrl: '/admin-logistica?embed=1',
      imageUrl: '',
      icon: '🛣️',
      openMode: 'iframe',
      active: true,
      tags: ['logistica', 'transportadora', 'cidade']
    },
    {
      id: 'volume-admin',
      nome: 'Admin Volume',
      descricao: 'Gestão do cálculo de volumes.',
      categoria: 'Cadastros',
      url: '/admin-volume',
      embedUrl: '/admin-volume?embed=1',
      imageUrl: '',
      icon: '📐',
      openMode: 'iframe',
      active: true,
      tags: ['volume', 'admin']
    },
    {
      id: 'prestacao-contas',
      nome: 'Prestação de Contas',
      descricao: 'Planilhas visuais de prestação de contas.',
      categoria: 'Financeiro',
      url: '/prestacao-contas',
      embedUrl: '/prestacao-contas?embed=1',
      imageUrl: '',
      icon: '🧮',
      openMode: 'iframe',
      active: true,
      tags: ['prestacao', 'contas']
    }
  ],
  menuSections: [
    {
      id: 'sec-operacao',
      title: 'Operação',
      collapsed: false,
      items: ['dashboard-pedidos', 'pedidos', 'pagamentos', 'carradas', 'semanas']
    },
    {
      id: 'sec-integracoes',
      title: 'Integrações',
      collapsed: false,
      items: ['pedidos-insercao-v2', 'whatsapp-enviar', 'bot-admin']
    },
    {
      id: 'sec-cadastros',
      title: 'Cadastros',
      collapsed: false,
      items: ['produtos-admin', 'fornecedores-admin', 'funcionarios-admin', 'logistica-admin', 'volume-admin']
    }
  ],
  cards: [
    {
      id: 'card-dashboard',
      moduleId: 'dashboard-pedidos',
      title: 'Últimos Pedidos e Carradas',
      subtitle: 'Entrada rápida para o dashboard operacional.',
      imageUrl: '',
      size: 'wide',
      active: true
    },
    {
      id: 'card-pedidos',
      moduleId: 'pedidos',
      title: 'Pedidos',
      subtitle: 'Consultar pedidos do legado.',
      imageUrl: '',
      size: 'normal',
      active: true
    },
    {
      id: 'card-pagamentos',
      moduleId: 'pagamentos',
      title: 'Pagamentos',
      subtitle: 'Acompanhar valores pagos e saldo.',
      imageUrl: '',
      size: 'normal',
      active: true
    },
    {
      id: 'card-carradas',
      moduleId: 'carradas',
      title: 'Carradas',
      subtitle: 'Montagem e consulta.',
      imageUrl: '',
      size: 'normal',
      active: true
    },
    {
      id: 'card-semanas',
      moduleId: 'semanas',
      title: 'Semanas',
      subtitle: 'Agrupamento por semana.',
      imageUrl: '',
      size: 'normal',
      active: true
    },
    {
      id: 'card-bot',
      moduleId: 'bot-admin',
      title: 'Bot Admin',
      subtitle: 'Conversas, contatos e IA.',
      imageUrl: '',
      size: 'normal',
      active: true
    }
  ]
};

module.exports = HUB_DEFAULT_CONFIG;
