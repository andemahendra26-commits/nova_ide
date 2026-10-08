/**
 * Monaco themes mirroring the CSS palettes in themes.css, so the editor and the
 * chrome change together rather than one lagging the other (TH-2).
 */

const SHARED_RULES = (c) => [
  { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
  { token: 'keyword', foreground: c.keyword },
  { token: 'keyword.control', foreground: c.keyword },
  { token: 'string', foreground: c.string },
  { token: 'string.escape', foreground: c.escape },
  { token: 'number', foreground: c.number },
  { token: 'regexp', foreground: c.regexp },
  { token: 'type', foreground: c.type },
  { token: 'type.identifier', foreground: c.type },
  { token: 'class', foreground: c.type },
  { token: 'function', foreground: c.func },
  { token: 'identifier', foreground: c.fg },
  { token: 'variable', foreground: c.fg },
  { token: 'variable.predefined', foreground: c.constant },
  { token: 'constant', foreground: c.constant },
  { token: 'operator', foreground: c.operator },
  { token: 'delimiter', foreground: c.delimiter },
  { token: 'delimiter.bracket', foreground: c.delimiter },
  { token: 'tag', foreground: c.keyword },
  { token: 'attribute.name', foreground: c.func },
  { token: 'attribute.value', foreground: c.string },
  { token: 'metatag', foreground: c.constant },
  { token: 'key', foreground: c.func },
  { token: 'value', foreground: c.string },
  { token: 'namespace', foreground: c.type },
];

const THEMES = {
  'claude-dark': {
    base: 'vs-dark',
    palette: {
      fg: 'e6ded6', comment: '6b6058', keyword: 'd97757', string: '9cb380',
      escape: 'f0a868', number: 'f0a868', regexp: 'e06c5a', type: 'e8b98a',
      func: 'd4a843', constant: 'd98e73', operator: '9a8d82', delimiter: '8a7d72',
    },
    colors: {
      'editor.background': '#0c0b0a',
      'editor.foreground': '#e6ded6',
      'editorLineNumber.foreground': '#453d37',
      'editorLineNumber.activeForeground': '#d97757',
      'editorCursor.foreground': '#d97757',
      'editor.selectionBackground': '#d9775740',
      'editor.inactiveSelectionBackground': '#d977571f',
      'editor.lineHighlightBackground': '#ffffff07',
      'editorIndentGuide.background1': '#ffffff0d',
      'editorIndentGuide.activeBackground1': '#d9775755',
      'editorBracketMatch.background': '#d9775730',
      'editorBracketMatch.border': '#d9775777',
      'editorGutter.background': '#0c0b0a',
      'editorWidget.background': '#191714',
      'editorWidget.border': '#ffffff1a',
      'editorSuggestWidget.background': '#191714',
      'editorSuggestWidget.selectedBackground': '#d9775730',
      'editorHoverWidget.background': '#191714',
      'minimap.background': '#0c0b0a',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
      'editorError.foreground': '#e06c5a',
      'editorWarning.foreground': '#e0a458',
      'editor.findMatchBackground': '#f0a8684d',
      'editor.findMatchHighlightBackground': '#d977572b',
    },
  },

  'nova-dark': {
    base: 'vs-dark',
    palette: {
      fg: 'd6dcea', comment: '5b6479', keyword: 'c084fc', string: '86efac',
      escape: 'fbbf24', number: 'fbbf24', regexp: 'fb7185', type: '22d3ee',
      func: '60a5fa', constant: 'f472b6', operator: '94a3b8', delimiter: '8993ab',
    },
    colors: {
      'editor.background': '#0b0e17',
      'editor.foreground': '#d6dcea',
      'editorLineNumber.foreground': '#3a4358',
      'editorLineNumber.activeForeground': '#22d3ee',
      'editorCursor.foreground': '#22d3ee',
      'editor.selectionBackground': '#22d3ee2e',
      'editor.inactiveSelectionBackground': '#22d3ee18',
      'editor.lineHighlightBackground': '#ffffff07',
      'editor.lineHighlightBorder': '#00000000',
      'editorIndentGuide.background1': '#ffffff0d',
      'editorIndentGuide.activeBackground1': '#22d3ee44',
      'editorWhitespace.foreground': '#ffffff12',
      'editorBracketMatch.background': '#22d3ee25',
      'editorBracketMatch.border': '#22d3ee66',
      'editorGutter.background': '#0b0e17',
      'editorWidget.background': '#141826',
      'editorWidget.border': '#ffffff18',
      'editorSuggestWidget.background': '#141826',
      'editorSuggestWidget.selectedBackground': '#22d3ee24',
      'editorHoverWidget.background': '#141826',
      'minimap.background': '#0b0e17',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff22',
      'scrollbarSlider.activeBackground': '#ffffff33',
      'editorOverviewRuler.border': '#00000000',
      'editorError.foreground': '#f87171',
      'editorWarning.foreground': '#fbbf24',
      'editor.findMatchBackground': '#a78bfa4d',
      'editor.findMatchHighlightBackground': '#22d3ee2b',
    },
  },

  midnight: {
    base: 'vs-dark',
    palette: {
      fg: 'c9d1e4', comment: '505a70', keyword: '818cf8', string: '7dd3fc',
      escape: 'facc15', number: 'facc15', regexp: 'fb7185', type: '38bdf8',
      func: 'a5b4fc', constant: 'f0abfc', operator: '8b95ab', delimiter: '7b859c',
    },
    colors: {
      'editor.background': '#06090f',
      'editor.foreground': '#c9d1e4',
      'editorLineNumber.foreground': '#333c4f',
      'editorLineNumber.activeForeground': '#818cf8',
      'editorCursor.foreground': '#818cf8',
      'editor.selectionBackground': '#818cf833',
      'editor.lineHighlightBackground': '#ffffff06',
      'editorIndentGuide.background1': '#ffffff0b',
      'editorIndentGuide.activeBackground1': '#818cf844',
      'editorWidget.background': '#0d1119',
      'editorSuggestWidget.background': '#0d1119',
      'editorSuggestWidget.selectedBackground': '#818cf826',
      'minimap.background': '#06090f',
      'scrollbarSlider.background': '#ffffff12',
      'editor.findMatchBackground': '#38bdf84d',
    },
  },

  synthwave: {
    base: 'vs-dark',
    palette: {
      fg: 'e8dcff', comment: '7663a0', keyword: 'f472b6', string: 'fde047',
      escape: '22d3ee', number: 'fb923c', regexp: 'f9a8d4', type: '22d3ee',
      func: '38bdf8', constant: 'c084fc', operator: 'b8a4dd', delimiter: 'a08fc9',
    },
    colors: {
      'editor.background': '#1a1430',
      'editor.foreground': '#e8dcff',
      'editorLineNumber.foreground': '#584a7d',
      'editorLineNumber.activeForeground': '#f472b6',
      'editorCursor.foreground': '#f472b6',
      'editor.selectionBackground': '#f472b63d',
      'editor.lineHighlightBackground': '#ffffff09',
      'editorIndentGuide.background1': '#ffffff12',
      'editorIndentGuide.activeBackground1': '#f472b655',
      'editorWidget.background': '#251c44',
      'editorSuggestWidget.background': '#251c44',
      'editorSuggestWidget.selectedBackground': '#f472b62e',
      'minimap.background': '#1a1430',
      'scrollbarSlider.background': '#ffffff1a',
      'editor.findMatchBackground': '#22d3ee4d',
    },
  },

  'nova-light': {
    base: 'vs',
    palette: {
      fg: '1e2635', comment: '8792a4', keyword: '7c3aed', string: '059669',
      escape: 'b45309', number: 'b45309', regexp: 'be123c', type: '0891b2',
      func: '2563eb', constant: 'be185d', operator: '5a6577', delimiter: '5a6577',
    },
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1e2635',
      'editorLineNumber.foreground': '#b6bfcd',
      'editorLineNumber.activeForeground': '#0891b2',
      'editorCursor.foreground': '#0891b2',
      'editor.selectionBackground': '#0891b229',
      'editor.lineHighlightBackground': '#0a142d07',
      'editorIndentGuide.background1': '#0a142d16',
      'editorIndentGuide.activeBackground1': '#0891b255',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#0a142d1f',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.selectedBackground': '#0891b21f',
      'minimap.background': '#ffffff',
      'scrollbarSlider.background': '#0a142d22',
      'editor.findMatchBackground': '#7c3aed40',
    },
  },
};

export function defineThemes(monaco) {
  for (const [id, def] of Object.entries(THEMES)) {
    monaco.editor.defineTheme(id, {
      base: def.base,
      inherit: true,
      rules: SHARED_RULES(def.palette),
      colors: def.colors,
    });
  }
}

export function applyTheme(monaco, id) {
  monaco.editor.setTheme(THEMES[id] ? id : 'claude-dark');
}
