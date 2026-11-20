import { NoteBlock } from '../types/note';

let idCounter = 0;
export function generateBlockId(prefix = 'blk'): string {
  idCounter += 1;
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${rand}`;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(html: string): string {
  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n');
  const stripped = withNewlines.replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(stripped).trim();
}

function extractInlineStyles(chunk: string): Partial<NoteBlock> {
  const stylePatch: Partial<NoteBlock> = {};

  if (/<(b|strong)\b/i.test(chunk) || /font-weight\s*:\s*(bold|700|800)/i.test(chunk)) {
    stylePatch.bold = true;
  }
  if (/<(i|em)\b/i.test(chunk) || /font-style\s*:\s*italic/i.test(chunk)) {
    stylePatch.italic = true;
  }
  if (/<u\b/i.test(chunk) || /text-decoration[^;"]*underline/i.test(chunk)) {
    stylePatch.underline = true;
  }
  if (
    /<(s|strike|del)\b/i.test(chunk) ||
    /text-decoration[^;"]*line-through/i.test(chunk)
  ) {
    stylePatch.strikethrough = true;
  }

  const alignMatch = chunk.match(/text-align\s*:\s*(left|center|right)/i);
  if (alignMatch) {
    stylePatch.align = alignMatch[1].toLowerCase() as 'left' | 'center' | 'right';
  }

  const colorMatch = chunk.match(/(?:^|[;"\s])color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/i);
  if (colorMatch) {
    stylePatch.textColor = colorMatch[1].trim();
  }

  const bgMatch = chunk.match(
    /background-color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/i
  );
  if (bgMatch) {
    stylePatch.highlightColor = bgMatch[1].trim();
  }

  return stylePatch;
}

function formatBlockHtmlContent(block: NoteBlock): {
  styleAttr: string;
  innerHtml: string;
} {
  const styles: string[] = [];
  if (block.align && block.align !== 'left') {
    styles.push(`text-align:${block.align}`);
  }
  if (block.textColor) {
    styles.push(`color:${block.textColor}`);
  }
  if (block.highlightColor) {
    styles.push(`background-color:${block.highlightColor}`);
  }

  let inner = escapeHtml(block.content).replace(/\n/g, '<br>');
  if (!inner) inner = '<br>';

  if (block.bold) inner = `<b>${inner}</b>`;
  if (block.italic) inner = `<i>${inner}</i>`;
  if (block.underline) inner = `<u>${inner}</u>`;
  if (block.strikethrough) inner = `<s>${inner}</s>`;

  const styleAttr = styles.length > 0 ? ` style="${styles.join(';')}"` : '';
  return { styleAttr, innerHtml: inner };
}

/**
 * Parses a Nosh Desktop `.nsh` HTML string into mobile structured blocks (`NoteBlock[]`).
 * Handles:
 * - `<div class="code-block-wrapper">...<textarea class="code" language="..." data-label="...">...</textarea></div>`
 * - `<div class="checklist-item">...<input type="checkbox" ...><span class="checklist-text">...</span></div>`
 * - `<h1>`, `<h2>`, `<h3>`, `<p>`, `<blockquote>`, `<hr>`, `<ul><li>`, `<ol><li>`
 * - Math formulas `[data-latex]`
 */
export function parseNshToBlocks(nshHtml: string, peerId = 'local'): NoteBlock[] {
  if (!nshHtml || !nshHtml.trim()) {
    return [
      {
        id: generateBlockId(),
        type: 'paragraph',
        content: '',
        updatedAt: Date.now(),
        updatedBy: peerId,
      },
    ];
  }

  const blocks: NoteBlock[] = [];
  const now = Date.now();

  const tokenRegex =
    /(<div[^>]*class="[^"]*code-block-wrapper[^"]*"[^>]*>[\s\S]*?<\/textarea>\s*<\/div>|<div[^>]*class="[^"]*checklist-item[^"]*"[^>]*>[\s\S]*?<\/div>|<div[^>]*class="[^"]*math-formula-block[^"]*"[^>]*>[\s\S]*?<\/div>|<h1[^>]*>[\s\S]*?<\/h1>|<h2[^>]*>[\s\S]*?<\/h2>|<h3[^>]*>[\s\S]*?<\/h3>|<blockquote[^>]*>[\s\S]*?<\/blockquote>|<ul[^>]*>[\s\S]*?<\/ul>|<ol[^>]*>[\s\S]*?<\/ol>|<hr\s*\/?>|<p[^>]*>[\s\S]*?<\/p>)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(nshHtml)) !== null) {
    if (match.index > lastIndex) {
      const between = stripTags(nshHtml.slice(lastIndex, match.index));
      if (between) {
        blocks.push({
          id: generateBlockId(),
          type: 'paragraph',
          content: between,
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    }

    const chunk = match[0];
    const lower = chunk.toLowerCase();

    if (lower.includes('code-block-wrapper')) {
      const textareaMatch = chunk.match(
        /<textarea[^>]*class="[^"]*code[^"]*"[^>]*>([\s\S]*?)<\/textarea>/i
      );
      const labelMatch =
        chunk.match(/data-label="([^"]+)"/i) ||
        chunk.match(/<span[^>]*class="[^"]*lang-name[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
        chunk.match(/language="([^"]+)"/i);

      const codeContent = textareaMatch ? decodeHtmlEntities(textareaMatch[1]) : '';
      const language = labelMatch ? stripTags(labelMatch[1]) : 'TypeScript';

      blocks.push({
        id: generateBlockId('code'),
        type: 'code',
        content: codeContent,
        language,
        wrap: false,
        updatedAt: now,
        updatedBy: peerId,
      });
    } else if (lower.includes('checklist-item')) {
      const isChecked = /checked/i.test(chunk.split('<span')[0] || '');
      const textMatch = chunk.match(
        /<span[^>]*class="[^"]*checklist-text[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      );
      const text = textMatch ? stripTags(textMatch[1]) : stripTags(chunk);

      blocks.push({
        id: generateBlockId('chk'),
        type: 'checklist',
        content: text,
        checked: isChecked,
        updatedAt: now,
        updatedBy: peerId,
      });
    } else if (lower.includes('math-formula-block')) {
      const latexMatch = chunk.match(/data-latex="([^"]+)"/i);
      const latex = latexMatch ? decodeHtmlEntities(latexMatch[1]) : stripTags(chunk);
      blocks.push({
        id: generateBlockId('math'),
        type: 'math',
        content: latex,
        updatedAt: now,
        updatedBy: peerId,
      });
    } else if (lower.startsWith('<h1')) {
      const text = stripTags(chunk);
      if (text) {
        blocks.push({
          id: generateBlockId('h1'),
          type: 'heading1',
          content: text,
          ...extractInlineStyles(chunk),
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    } else if (lower.startsWith('<h2')) {
      const text = stripTags(chunk);
      if (text) {
        blocks.push({
          id: generateBlockId('h2'),
          type: 'heading2',
          content: text,
          ...extractInlineStyles(chunk),
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    } else if (lower.startsWith('<h3')) {
      const text = stripTags(chunk);
      if (text) {
        blocks.push({
          id: generateBlockId('h3'),
          type: 'heading3',
          content: text,
          ...extractInlineStyles(chunk),
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    } else if (lower.startsWith('<blockquote')) {
      const text = stripTags(chunk);
      if (text) {
        blocks.push({
          id: generateBlockId('quote'),
          type: 'quote',
          content: text,
          ...extractInlineStyles(chunk),
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    } else if (lower.startsWith('<ul')) {
      const liMatches = chunk.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      for (const li of liMatches) {
        const text = stripTags(li);
        if (text) {
          blocks.push({
            id: generateBlockId('ul'),
            type: 'bulletList',
            content: text,
            ...extractInlineStyles(li),
            updatedAt: now,
            updatedBy: peerId,
          });
        }
      }
    } else if (lower.startsWith('<ol')) {
      const liMatches = chunk.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
      liMatches.forEach((li, idx) => {
        const text = stripTags(li);
        if (text) {
          blocks.push({
            id: generateBlockId('ol'),
            type: 'numberedList',
            content: text,
            listIndex: idx + 1,
            ...extractInlineStyles(li),
            updatedAt: now,
            updatedBy: peerId,
          });
        }
      });
    } else if (lower.startsWith('<hr')) {
      blocks.push({
        id: generateBlockId('hr'),
        type: 'divider',
        content: '',
        updatedAt: now,
        updatedBy: peerId,
      });
    } else if (lower.startsWith('<p')) {
      const text = stripTags(chunk);
      if (text) {
        blocks.push({
          id: generateBlockId('p'),
          type: 'paragraph',
          content: text,
          ...extractInlineStyles(chunk),
          updatedAt: now,
          updatedBy: peerId,
        });
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < nshHtml.length) {
    const trailing = stripTags(nshHtml.slice(lastIndex));
    if (trailing) {
      blocks.push({
        id: generateBlockId('p'),
        type: 'paragraph',
        content: trailing,
        updatedAt: now,
        updatedBy: peerId,
      });
    }
  }

  if (blocks.length === 0) {
    const fallback = stripTags(nshHtml);
    blocks.push({
      id: generateBlockId('p'),
      type: 'paragraph',
      content: fallback,
      updatedAt: now,
      updatedBy: peerId,
    });
  }

  return blocks;
}

/**
 * Serializes mobile structured `NoteBlock[]` back into 100% compatible Nosh Desktop `.nsh` HTML!
 */
export function serializeBlocksToNsh(blocks: NoteBlock[]): string {
  return blocks
    .map((block) => {
      const { styleAttr, innerHtml } = formatBlockHtmlContent(block);
      switch (block.type) {
        case 'heading1':
          return `<h1${styleAttr}>${innerHtml}</h1>`;
        case 'heading2':
          return `<h2${styleAttr}>${innerHtml}</h2>`;
        case 'heading3':
          return `<h3${styleAttr}>${innerHtml}</h3>`;
        case 'quote':
          return `<blockquote${styleAttr}>${innerHtml}</blockquote>`;
        case 'bulletList':
          return `<ul><li${styleAttr}>${innerHtml}</li></ul>`;
        case 'numberedList':
          return `<ol><li${styleAttr}>${innerHtml}</li></ol>`;
        case 'divider':
          return `<hr>`;
        case 'math':
          return `<div class="math-formula-block" data-latex="${escapeHtml(
            block.content
          )}" data-display-mode="true" contenteditable="false">\\[${escapeHtml(
            block.content
          )}\\]</div>`;
        case 'checklist': {
          const checkedAttr = block.checked ? ' checked' : '';
          const doneClass = block.checked ? ' completed' : '';
          return `<div class="checklist-item${doneClass}" contenteditable="false"><input type="checkbox" class="checklist-checkbox"${checkedAttr} onchange="toggleChecklistItem(this)"><span class="checklist-text" contenteditable="true">${escapeHtml(
            block.content
          )}</span></div>`;
        }
        case 'code': {
          const label = block.language || 'TypeScript';
          const langMode = label.toLowerCase();
          return `<div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><div class="code-window-dots"><span class="code-dot red"></span><span class="code-dot yellow"></span><span class="code-dot green"></span></div><span class="code-lang-tag clickable" onclick="openBlockLangSwitcher(this)"><span class="lang-name">${escapeHtml(
            label
          )}</span></span></div><div class="code-block-actions"><button class="code-action-btn wrap-btn" onclick="toggleCodeWrap(this)">Wrap</button><button class="code-action-btn copy-btn" onclick="copyCodeSnippet(this)">Copy</button><button class="code-action-btn delete" onclick="deleteCodeBlock(this)"></button></div></div><textarea class="code" language="${escapeHtml(
            langMode
          )}" data-label="${escapeHtml(label)}" style="display:block;">${escapeHtml(
            block.content
          )}</textarea></div>`;
        }
        case 'paragraph':
        default: {
          return `<p${styleAttr}>${innerHtml}</p>`;
        }
      }
    })
    .join('');
}

/**
 * Tag extraction disabled per user request.
 */
export function extractTagsFromBlocks(_blocks: NoteBlock[]): string[] {
  return [];
}

/**
 * Extracts `[[Wiki Links]]` from note blocks.
 */
export function extractWikiLinksFromBlocks(blocks: NoteBlock[]): string[] {
  const links = new Set<string>();
  const regex = /\[\[([^\[\]]+)\]\]/g;
  for (const b of blocks) {
    if (b.type === 'code') continue;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(b.content)) !== null) {
      links.add(m[1].trim());
    }
  }
  return Array.from(links);
}
