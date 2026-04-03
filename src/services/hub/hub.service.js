const fs = require('fs/promises');
const path = require('path');
const defaultConfig = require('../../config/hub.default.config');

const DATA_DIR = process.env.HUB_DATA_DIR || (
  process.cwd().includes('/opt/render/project/src')
    ? path.resolve(process.cwd(), '..', 'data')
    : path.join(process.cwd(), 'data')
);
const CONFIG_FILE = path.join(DATA_DIR, 'hub-config.json');

function slugify(value, fallback) {
  const text = String(value || fallback || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return text || fallback || 'item';
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeModule(moduleData, usedIds) {
  const baseId = slugify(moduleData.id || moduleData.title, 'modulo');
  let id = baseId;
  let counter = 2;

  while (usedIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }

  usedIds.add(id);

  return {
    id,
    title: String(moduleData.title || moduleData.nome || 'Novo módulo').trim(),
    url: String(moduleData.url || '').trim(),
    icon: String(moduleData.icon || moduleData.icone || '📁').trim() || '📁',
    openMode: moduleData.openMode === 'new_tab' ? 'new_tab' : 'iframe',
    active: moduleData.active !== false
  };
}

function normalizeSection(sectionData, usedIds, validModuleIds) {
  const baseId = slugify(sectionData.id || sectionData.title, 'secao');
  let id = baseId;
  let counter = 2;

  while (usedIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }

  usedIds.add(id);

  const items = Array.isArray(sectionData.items)
    ? sectionData.items
        .map((item) => String(item || '').trim())
        .filter((itemId) => validModuleIds.has(itemId))
    : [];

  return {
    id,
    title: String(sectionData.title || 'Nova seção').trim(),
    items
  };
}

function normalizeCard(cardData, usedIds, validModuleIds) {
  const moduleId = String(cardData.moduleId || '').trim();
  const baseId = slugify(cardData.id || cardData.title || moduleId, 'card');
  let id = baseId;
  let counter = 2;

  while (usedIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }

  usedIds.add(id);

  return {
    id,
    moduleId: validModuleIds.has(moduleId) ? moduleId : '',
    title: String(cardData.title || '').trim(),
    subtitle: String(cardData.subtitle || '').trim(),
    imageUrl: String(cardData.imageUrl || '').trim(),
    size: cardData.size === 'wide' ? 'wide' : 'normal',
    active: cardData.active !== false
  };
}

function normalizeConfig(inputConfig) {
  const source = inputConfig && typeof inputConfig === 'object' ? inputConfig : {};
  const config = deepClone(defaultConfig);

  config.title = String(source.title || defaultConfig.title).trim() || defaultConfig.title;
  config.subtitle = String(source.subtitle || defaultConfig.subtitle).trim();
  config.iframeInitialUrl = String(source.iframeInitialUrl || '').trim();

  const moduleIds = new Set();
  const modules = Array.isArray(source.modules) ? source.modules : [];
  config.modules = modules
    .filter((moduleData) => moduleData && typeof moduleData === 'object')
    .map((moduleData) => normalizeModule(moduleData, moduleIds));

  const validModuleIds = new Set(config.modules.map((moduleData) => moduleData.id));

  const sectionIds = new Set();
  const sections = Array.isArray(source.menuSections) ? source.menuSections : [];
  config.menuSections = sections
    .filter((sectionData) => sectionData && typeof sectionData === 'object')
    .map((sectionData) => normalizeSection(sectionData, sectionIds, validModuleIds))
    .filter((sectionData) => sectionData.title);

  const cardIds = new Set();
  const cards = Array.isArray(source.cards) ? source.cards : [];
  config.cards = cards
    .filter((cardData) => cardData && typeof cardData === 'object')
    .map((cardData) => normalizeCard(cardData, cardIds, validModuleIds))
    .filter((cardData) => cardData.moduleId);

  return config;
}

async function ensureConfigFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(CONFIG_FILE);
  } catch (error) {
    const normalizedDefault = normalizeConfig(defaultConfig);
    await fs.writeFile(CONFIG_FILE, `${JSON.stringify(normalizedDefault, null, 2)}\n`, 'utf8');
  }
}

async function loadConfig() {
  await ensureConfigFile();

  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeConfig(parsed);

    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await fs.writeFile(CONFIG_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    }

    return normalized;
  } catch (error) {
    const normalizedDefault = normalizeConfig(defaultConfig);
    await fs.writeFile(CONFIG_FILE, `${JSON.stringify(normalizedDefault, null, 2)}\n`, 'utf8');
    return normalizedDefault;
  }
}

async function saveConfig(inputConfig) {
  const normalized = normalizeConfig(inputConfig);
  await fs.mkdir(DATA_DIR, { recursive: true });

  const tempFile = `${CONFIG_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, CONFIG_FILE);

  return normalized;
}

module.exports = {
  loadConfig,
  saveConfig,
  normalizeConfig,
  CONFIG_FILE
};
