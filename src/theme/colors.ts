export type ThemeMode = 'dark' | 'oled';

export interface ThemeTokens {
  bgApp: string;
  bgSidebar: string;
  bgSurface: string;
  bgSurfaceHover: string;
  bgSurfaceActive: string;
  bgElevated: string;
  bgCard: string;
  bgModal: string;
  bgCode: string;
  borderSubtle: string;
  borderMedium: string;
  borderFocus: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentSubtle: string;
  accentBorder: string;
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
}

export const DARK_THEME: ThemeTokens = {
  bgApp: '#0d0f12',
  bgSidebar: '#13161c',
  bgSurface: '#181c24',
  bgSurfaceHover: '#1f2430',
  bgSurfaceActive: '#272d3c',
  bgElevated: '#202634',
  bgCard: '#151821',
  bgModal: '#141720',
  bgCode: '#11131a',
  borderSubtle: 'rgba(255, 255, 255, 0.07)',
  borderMedium: 'rgba(255, 255, 255, 0.13)',
  borderFocus: '#6366f1',
  textPrimary: '#f3f4f6',
  textSecondary: '#9ca3af',
  textMuted: '#64748b',
  accent: '#6366f1',
  accentHover: '#4f46e5',
  accentSubtle: 'rgba(99, 102, 241, 0.14)',
  accentBorder: 'rgba(99, 102, 241, 0.38)',
  success: '#10b981',
  successSubtle: 'rgba(16, 185, 129, 0.15)',
  warning: '#f59e0b',
  warningSubtle: 'rgba(245, 158, 11, 0.15)',
  danger: '#ef4444',
  dangerSubtle: 'rgba(239, 68, 68, 0.15)',
};

export const OLED_THEME: ThemeTokens = {
  ...DARK_THEME,
  bgApp: '#000000',
  bgSidebar: '#060606',
  bgSurface: '#0f0f0f',
  bgSurfaceHover: '#171717',
  bgSurfaceActive: '#222222',
  bgElevated: '#141414',
  bgCard: '#0a0a0c',
  bgModal: '#08080a',
  bgCode: '#07080a',
};

export interface LanguageMeta {
  id: string;
  label: string;
  icon: string;
  color: string;
}

// Identical language list & Iconify logos as Nosh Desktop (code_block.js)
export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { id: 'python', label: 'Python', icon: 'logos:python', color: '#3572A5' },
  { id: 'javascript', label: 'JavaScript', icon: 'logos:javascript', color: '#f1e05a' },
  { id: 'typescript', label: 'TypeScript', icon: 'logos:typescript-icon', color: '#3178c6' },
  { id: 'rust', label: 'Rust', icon: 'logos:rust', color: '#dea584' },
  { id: 'go', label: 'Go', icon: 'logos:go', color: '#00ADD8' },
  { id: 'cpp', label: 'C++', icon: 'logos:c-plusplus', color: '#f34b7d' },
  { id: 'c', label: 'C', icon: 'logos:c', color: '#555555' },
  { id: 'csharp', label: 'C#', icon: 'logos:c-sharp', color: '#178600' },
  { id: 'java', label: 'Java', icon: 'logos:java', color: '#b07219' },
  { id: 'kotlin', label: 'Kotlin', icon: 'logos:kotlin-icon', color: '#A97BFF' },
  { id: 'dart', label: 'Dart', icon: 'logos:dart', color: '#00B4AB' },
  { id: 'swift', label: 'Swift', icon: 'logos:swift', color: '#F05138' },
  { id: 'html', label: 'HTML', icon: 'logos:html-5', color: '#e34c26' },
  { id: 'css', label: 'CSS', icon: 'logos:css-3', color: '#563d7c' },
  { id: 'sql', label: 'SQL', icon: 'vscode-icons:file-type-sql', color: '#e38c00' },
  { id: 'bash', label: 'Bash', icon: 'logos:bash-icon', color: '#89e051' },
  { id: 'json', label: 'JSON', icon: 'vscode-icons:file-type-json', color: '#cbcb41' },
  { id: 'yaml', label: 'YAML', icon: 'vscode-icons:file-type-yaml', color: '#cb171e' },
  { id: 'markdown', label: 'Markdown', icon: 'logos:markdown', color: '#083fa1' },
  { id: 'php', label: 'PHP', icon: 'logos:php', color: '#4F5D95' },
  { id: 'ruby', label: 'Ruby', icon: 'logos:ruby', color: '#701516' },
  { id: 'vue', label: 'Vue', icon: 'logos:vue', color: '#41b883' },
  { id: 'react', label: 'React', icon: 'logos:react', color: '#61dafb' },
  { id: 'lua', label: 'Lua', icon: 'logos:lua', color: '#000080' },
  { id: 'r', label: 'R', icon: 'logos:r-lang', color: '#198CE7' },
];

export function getLanguageMeta(langOrLabel?: string): LanguageMeta {
  if (!langOrLabel) return SUPPORTED_LANGUAGES[2];
  const lower = langOrLabel.toLowerCase();
  return (
    SUPPORTED_LANGUAGES.find(
      (l) =>
        l.id.toLowerCase() === lower ||
        l.label.toLowerCase() === lower ||
        (lower.includes('bash') && l.id === 'bash')
    ) || {
      id: lower,
      label: langOrLabel,
      icon: 'solar:code-square-linear',
      color: '#6366f1',
    }
  );
}

export const PEER_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
];
