const HUB_DEFAULT_CONFIG = require('../../config/hub.default.config');

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeConfig(config) {
  const safeConfig = cloneDeep(config || HUB_DEFAULT_CONFIG);

  safeConfig.appTitle = safeConfig.appTitle || 'Central de Módulos';
  safeConfig.appSubtitle = safeConfig.appSubtitle || 'Alumínio JR';
  safeConfig.iframeInitialUrl = safeConfig.iframeInitialUrl || '/';
  safeConfig.modules = Array.isArray(safeConfig.modules) ? safeConfig.modules : [];
  safeConfig.menuSections = Array.isArray(safeConfig.menuSections) ? safeConfig.menuSections : [];
  safeConfig.cards = Array.isArray(safeConfig.cards) ? safeConfig.cards : [];

  const moduleMap = new Map();
  safeConfig.modules = safeConfig.modules
    .filter((item) => item && item.id && item.nome && item.url)
    .map((item) => {
      const normalized = {
        id: String(item.id),
        nome: String(item.nome),
        descricao: item.descricao ? String(item.descricao) : '',
        categoria: item.categoria ? String(item.categoria) : 'Geral',
        url: String(item.url),
        embedUrl: item.embedUrl ? String(item.embedUrl) : String(item.url),
        imageUrl: item.imageUrl ? String(item.imageUrl) : '',
        icon: item.icon ? String(item.icon) : '📁',
        openMode: item.openMode === 'newtab' ? 'newtab' : 'iframe',
        active: item.active !== false,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : []
      };
      moduleMap.set(normalized.id, normalized);
      return normalized;
    });

  safeConfig.menuSections = safeConfig.menuSections
    .filter((section) => section && section.id && section.title)
    .map((section) => ({
      id: String(section.id),
      title: String(section.title),
      collapsed: Boolean(section.collapsed),
      items: Array.isArray(section.items)
        ? section.items.map(String).filter((itemId) => moduleMap.has(itemId))
        : []
    }));

  safeConfig.cards = safeConfig.cards
    .filter((card) => card && card.id && card.moduleId && moduleMap.has(String(card.moduleId)))
    .map((card) => ({
      id: String(card.id),
      moduleId: String(card.moduleId),
      title: card.title ? String(card.title) : moduleMap.get(String(card.moduleId)).nome,
      subtitle: card.subtitle ? String(card.subtitle) : '',
      imageUrl: card.imageUrl ? String(card.imageUrl) : (moduleMap.get(String(card.moduleId)).imageUrl || ''),
      size: ['small', 'normal', 'wide', 'tall'].includes(card.size) ? card.size : 'normal',
      active: card.active !== false
    }));

  return safeConfig;
}

function getDefaultConfig() {
  return normalizeConfig(HUB_DEFAULT_CONFIG);
}

module.exports = {
  getDefaultConfig,
  normalizeConfig
};
