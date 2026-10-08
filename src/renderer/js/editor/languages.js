import { extname, basename } from '../core/util.js';

const BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.html': 'html', '.htm': 'html', '.vue': 'html', '.svelte': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
  '.md': 'markdown', '.markdown': 'markdown', '.mdx': 'markdown',
  '.py': 'python', '.pyw': 'python', '.pyi': 'python',
  '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin',
  '.scala': 'scala', '.dart': 'dart', '.lua': 'lua', '.r': 'r', '.pl': 'perl',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
  '.bat': 'bat', '.cmd': 'bat',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'ini', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.xml': 'xml', '.svg': 'xml', '.xaml': 'xml', '.plist': 'xml',
  '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql', '.proto': 'proto',
  '.dockerfile': 'dockerfile', '.tf': 'hcl', '.hcl': 'hcl',
  '.txt': 'plaintext', '.log': 'plaintext', '.env': 'ini',
  '.clj': 'clojure', '.ex': 'elixir', '.exs': 'elixir', '.elm': 'elm',
  '.fs': 'fsharp', '.hs': 'plaintext', '.jl': 'julia', '.m': 'objective-c',
  '.pas': 'pascal', '.vb': 'vb', '.asm': 'plaintext', '.s': 'plaintext',
};

const BY_NAME = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  'cmakelists.txt': 'plaintext',
};

export function languageFor(filePath) {
  const name = basename(filePath).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('.env')) return 'ini';
  return BY_EXT[extname(filePath)] || 'plaintext';
}

/* ── File-type badges ─────────────────────────────────────────────────────
   Deliberately typographic rather than an icon font: two or three letters in
   the language's own accent colour reads faster at 15 px than a glyph, and
   costs nothing in assets.                                                 */

const BADGES = {
  javascript: ['JS', '#f0db4f'], typescript: ['TS', '#3178c6'],
  json: ['{}', '#cbcb41'], html: ['<>', '#e34c26'],
  css: ['CSS', '#2965f1'], scss: ['SC', '#cf649a'], less: ['LE', '#1d365d'],
  markdown: ['MD', '#7c9fd4'], python: ['PY', '#3572A5'], ruby: ['RB', '#cc342d'],
  go: ['GO', '#00add8'], rust: ['RS', '#dea584'], java: ['JV', '#b07219'],
  c: ['C', '#555555'], cpp: ['C+', '#f34b7d'], csharp: ['C#', '#178600'],
  php: ['PHP', '#4f5d95'], swift: ['SW', '#f05138'], kotlin: ['KT', '#a97bff'],
  shell: ['SH', '#89e051'], powershell: ['PS', '#5391fe'], bat: ['BAT', '#c1f12e'],
  yaml: ['YML', '#cb171e'], ini: ['CFG', '#6d8086'], xml: ['XML', '#0060ac'],
  sql: ['SQL', '#e38c00'], graphql: ['GQL', '#e10098'], dockerfile: ['DK', '#384d54'],
  lua: ['LUA', '#000080'], dart: ['DT', '#00b4ab'], scala: ['SC', '#c22d40'],
  r: ['R', '#198ce7'], perl: ['PL', '#0298c3'], elixir: ['EX', '#6e4a7e'],
  julia: ['JL', '#a270ba'], plaintext: ['TXT', '#8993ab'],
};

export function badgeFor(filePath) {
  const lang = languageFor(filePath);
  const [text, color] = BADGES[lang] || BADGES.plaintext;
  return { text, color };
}

export const ALL_LANGUAGES = [...new Set(Object.values(BY_EXT))].sort();
