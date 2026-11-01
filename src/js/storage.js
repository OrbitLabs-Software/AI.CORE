// storage.js — Speicherschicht (localStorage). Die Chats liegen im Browser, nicht
// auf dem Server. Für Sicherung und Umzug gibt es Export/Import in den Einstellungen.

const KEYS = {
  chats: 'aicore.chats.v1',
  settings: 'aicore.settings.v1',
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  sidebarCollapsed: false,
  model: '',
  username: 'Brett',
  roleId: 'default',
  customRoles: [],
  temperature: null, // null = Server-Standard
  useMemory: true,     // Erinnerungen in Gespräche einbeziehen
  memoryHints: true,   // Vorschläge „Merken?“ unter Nachrichten
  autoPreview: true,   // Vorschau bei HTML/SVG automatisch öffnen (breite Bildschirme)
  cloudAck: {},        // Cloud-Quellen, deren Datenschutz-Hinweis bestätigt wurde
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('storage: failed to parse', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('storage: failed to persist', key, e);
    window.dispatchEvent(new CustomEvent('aicore:storage-full'));
    return false;
  }
}

export const storage = {
  getChats() {
    const chats = readJSON(KEYS.chats, []);
    return Array.isArray(chats) ? chats : [];
  },
  saveChats(chats) {
    return writeJSON(KEYS.chats, chats);
  },
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJSON(KEYS.settings, {}) };
  },
  saveSettings(settings) {
    return writeJSON(KEYS.settings, settings);
  },
  usageBytes() {
    try { return (localStorage.getItem(KEYS.chats) || '').length * 2; } catch { return 0; }
  },
};
