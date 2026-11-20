import AsyncStorage from '@react-native-async-storage/async-storage';
import { NoshNote, QRSyncPayload } from '../types/note';
import {
  extractTagsFromBlocks,
  generateBlockId,
  parseNshToBlocks,
  serializeBlocksToNsh,
} from '../utils/nshFormat';
import {
  createSessionFromAuthToken,
  generateRandomHex,
  normalizeAuthToken,
} from '../utils/cryptoE2EE';
import { ThemeMode } from '../theme/colors';

const STORAGE_KEYS = {
  NOTES: 'nosh_mobile_vault_notes_v2',
  FOLDERS: 'nosh_mobile_folders_v2',
  SETTINGS: 'nosh_mobile_settings_v2',
  PAIRED_SESSION: 'nosh_mobile_paired_session_v2',
  AUTH_TOKEN: 'nosh_auth_token_v1',
};

export interface AppSettings {
  theme: ThemeMode;
  peerId: string;
  peerAlias: string;
  fontSize: number;
  autoSyncOnEdit: boolean;
}

export const ENGINEERING_TEMPLATES: {
  id: string;
  titlePrefix: string;
  subtitle: string;
  icon: string;
  nshHtml: string;
}[] = [
  {
    id: 'rfc',
    titlePrefix: 'RFC - System Design',
    subtitle: 'Architecture specs, component interfaces & action checklist',
    icon: 'layers-outline',
    nshHtml: `<h1>RFC: System Architecture</h1><p>Author: Lead Architect | Status: Proposed</p><hr><h2>1. Context & Motivation</h2><p>Detail the motivation and architectural goals for E2EE CRDT synchronization.</p><h2>2. Component Interfaces</h2><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><span class="code-lang-tag"><span class="lang-name">TypeScript</span></span></div></div><textarea class="code" language="typescript" data-label="TypeScript">interface StorageDriver {\n  read(key: string): Promise<string>;\n  write(key: string, data: string): Promise<void>;\n}</textarea></div><h2>3. Action Checklist</h2><div class="checklist-item"><input type="checkbox" class="checklist-checkbox"><span class="checklist-text">Implement storage driver interfaces</span></div><div class="checklist-item"><input type="checkbox" class="checklist-checkbox"><span class="checklist-text">Verify E2EE QR handshake</span></div>`,
  },
  {
    id: 'bug',
    titlePrefix: 'Bug Investigation',
    subtitle: 'Root cause analysis, code reproduction & resolution steps',
    icon: 'bug-outline',
    nshHtml: `<h1>Bug Investigation: Issue Analysis</h1><p>Severity: High | Module: Core</p><hr><h2>Symptoms & Reproduction</h2><p>• Step 1: Reproduce defect in sandbox\n• Step 2: Inspect runtime logs</p><h2>Root Cause Analysis</h2><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><span class="code-lang-tag"><span class="lang-name">Python</span></span></div></div><textarea class="code" language="python" data-label="Python">def safe_handler(payload):\n    if not payload:\n        return None\n    return process(payload)</textarea></div><h2>Resolution Checklist</h2><div class="checklist-item"><input type="checkbox" class="checklist-checkbox"><span class="checklist-text">Apply hotfix patch</span></div>`,
  },
  {
    id: 'algo',
    titlePrefix: 'Algorithm Showcase',
    subtitle: 'Time/space complexity analysis & Rust/C++ implementation',
    icon: 'code-slash-outline',
    nshHtml: `<h1>Algorithm: Binary Search</h1><p>Category: Algorithms & Data Structures</p><hr><h2>Complexity & Analysis</h2><p>Time: O(log n) | Space: O(1)</p><div class="code-block-wrapper" contenteditable="false"><div class="code-block-header"><div class="code-header-left"><span class="code-lang-tag"><span class="lang-name">Rust</span></span></div></div><textarea class="code" language="rust" data-label="Rust">pub fn binary_search(arr: &[i32], target: i32) -> Option<usize> {\n    let mut low = 0;\n    let mut high = arr.len();\n    while low < high {\n        let mid = low + (high - low) / 2;\n        if arr[mid] == target { return Some(mid); }\n        else if arr[mid] < target { low = mid + 1; }\n        else { high = mid; }\n    }\n    None\n}</textarea></div>`,
  },
  {
    id: 'daily',
    titlePrefix: 'Daily Dev Log',
    subtitle: 'Daily sprint focus, engineering notes & blockers',
    icon: 'calendar-outline',
    nshHtml: `<h1>Daily Dev Log</h1><p>Status: Active Sprint</p><hr><h2>Today's Focus</h2><div class="checklist-item"><input type="checkbox" class="checklist-checkbox" checked><span class="checklist-text">Complete Nosh Mobile QR E2EE architecture</span></div><div class="checklist-item"><input type="checkbox" class="checklist-checkbox"><span class="checklist-text">Test live multiplayer CRDT editing</span></div><h2>Notes & Discoveries</h2><p>Zero-account E2EE keeps user privacy 100% intact while allowing multi-peer collaboration.</p>`,
  },
];

export function createStarterNotes(peerId = 'local'): NoshNote[] {
  const now = Date.now();
  const welcomeBlocks = [
    {
      id: generateBlockId('h1'),
      type: 'heading1' as const,
      content: 'Welcome to Nosh Mobile — Anonymous E2EE Workstation',
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('p'),
      type: 'paragraph' as const,
      content:
        'Zero accounts, zero logins, zero tracking. Sync with Nosh Desktop via QR Code or collaborate live (CRDT) on the same note with multiple peers.',
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('h2'),
      type: 'heading2' as const,
      content: 'Quick Start Guide',
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('chk'),
      type: 'checklist' as const,
      content: 'Tap the QR Sync button in the top-right to pair with Nosh Desktop',
      checked: true,
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('chk'),
      type: 'checklist' as const,
      content: 'Share a note QR code to edit simultaneously with teammates in real time',
      checked: false,
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('code'),
      type: 'code' as const,
      language: 'TypeScript',
      content: `// End-to-End Encrypted (E2EE) & CRDT Synchronization\ninterface AnonymousPeer {\n  peerId: string;\n  roomKey: string; // Lives strictly inside the QR code\n  zeroKnowledge: true;\n}`,
      updatedAt: now,
      updatedBy: peerId,
    },
    {
      id: generateBlockId('quote'),
      type: 'quote' as const,
      content:
        'Tip: Use double brackets like [[RFC - System Design]] to create bidirectional Wiki-links between notes.',
      updatedAt: now,
      updatedBy: peerId,
    },
  ];

  const rfcBlocks = parseNshToBlocks(ENGINEERING_TEMPLATES[0].nshHtml, peerId);

  return [
    {
      id: 'note-welcome',
      title: 'Welcome to Nosh Mobile',
      blocks: welcomeBlocks,
      rawNsh: serializeBlocksToNsh(welcomeBlocks),
      folder: 'General',
      tags: extractTagsFromBlocks(welcomeBlocks),
      pinned: true,
      updatedAt: now,
      versionClock: 1,
    },
    {
      id: 'note-rfc',
      title: 'RFC - System Design',
      blocks: rfcBlocks,
      rawNsh: serializeBlocksToNsh(rfcBlocks),
      folder: 'Architecture',
      tags: extractTagsFromBlocks(rfcBlocks),
      pinned: false,
      updatedAt: now - 3600_000,
      versionClock: 1,
    },
  ];
}

export async function loadVaultNotes(peerId = 'local'): Promise<NoshNote[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.NOTES);
    if (!raw) {
      const starters = createStarterNotes(peerId);
      await saveVaultNotes(starters);
      return starters;
    }
    const parsed = JSON.parse(raw) as NoshNote[];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : createStarterNotes(peerId);
  } catch {
    return createStarterNotes(peerId);
  }
}

export async function saveVaultNotes(notes: NoshNote[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
  } catch (e) {
    console.warn('Failed to save vault notes:', e);
  }
}

export async function loadFolders(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.FOLDERS);
    if (!raw) return ['General', 'Architecture', 'Snippets'];
    return JSON.parse(raw);
  } catch {
    return ['General', 'Architecture', 'Snippets'];
  }
}

export async function saveFolders(folders: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.FOLDERS, JSON.stringify(folders));
  } catch {}
}

export async function loadAppSettings(): Promise<Partial<AppSettings>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {}
}

export async function loadPairedSession(): Promise<QRSyncPayload | null> {
  try {
    const savedToken = normalizeAuthToken(await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN));
    if (savedToken) {
      return createSessionFromAuthToken(savedToken);
    }
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.PAIRED_SESSION);
    if (raw) {
      const parsed = JSON.parse(raw) as QRSyncPayload;
      if (parsed?.authToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, parsed.authToken);
        return createSessionFromAuthToken(parsed.authToken, parsed.qrTransferKey);
      }
    }
    // Automatically issue an anonymous authToken on first app entry (Zero-Account philosophy)
    const freshToken = generateRandomHex(16);
    await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, freshToken);
    const session = createSessionFromAuthToken(freshToken);
    await AsyncStorage.setItem(STORAGE_KEYS.PAIRED_SESSION, JSON.stringify(session));
    return session;
  } catch {
    const fallbackToken = generateRandomHex(16);
    return createSessionFromAuthToken(fallbackToken);
  }
}

export async function savePairedSession(session: QRSyncPayload | null): Promise<void> {
  try {
    if (!session) {
      const freshToken = generateRandomHex(16);
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, freshToken);
      const freshSession = createSessionFromAuthToken(freshToken);
      await AsyncStorage.setItem(STORAGE_KEYS.PAIRED_SESSION, JSON.stringify(freshSession));
    } else {
      if (session.authToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, session.authToken);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.PAIRED_SESSION, JSON.stringify(session));
    }
  } catch {}
}
