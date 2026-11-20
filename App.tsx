import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Keyboard,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  DARK_THEME,
  getLanguageMeta,
  OLED_THEME,
  ThemeMode,
} from './src/theme/colors';
import {
  BlockType,
  CRDTBlockOp,
  NoshNote,
  NoteBlock,
  PeerIdentity,
  QRSyncPayload,
} from './src/types/note';
import {
  extractWikiLinksFromBlocks,
  generateBlockId,
  parseNshToBlocks,
  serializeBlocksToNsh,
} from './src/utils/nshFormat';
import {
  loadAppSettings,
  loadPairedSession,
  loadVaultNotes,
  saveAppSettings,
  savePairedSession,
  saveVaultNotes,
} from './src/storage/vaultStorage';
import {
  AnonymousQRSyncEngine,
  createDevicePeer,
  createNewRoomSession,
  mergeNoteCRDT,
} from './src/sync/qrSyncEngine';
import { CodeBlockCard } from './src/components/CodeBlockCard';
import { SolarIcon, SolarIconName } from './src/components/SolarIcon';
import { QRScannerModal } from './src/screens/QRScannerModal';

type MainTab = 'notes' | 'graph' | 'settings';
type NoteFilter = 'all' | 'pinned' | 'code' | 'tasks';
type EditorToolPanel = 'none' | 'color' | 'wikilink' | 'weblink' | 'math';

const TEXT_COLOR_SWATCHES = [
  { label: 'Default', value: undefined, preview: '#f3f4f6' },
  { label: 'Indigo', value: '#818cf8', preview: '#818cf8' },
  { label: 'Emerald', value: '#34d399', preview: '#34d399' },
  { label: 'Amber', value: '#fbbf24', preview: '#fbbf24' },
  { label: 'Rose', value: '#f87171', preview: '#f87171' },
  { label: 'Sky', value: '#38bdf8', preview: '#38bdf8' },
  { label: 'Purple', value: '#c084fc', preview: '#c084fc' },
  { label: 'Orange', value: '#fb923c', preview: '#fb923c' },
];

const HIGHLIGHT_COLOR_SWATCHES = [
  { label: 'None', value: undefined, preview: 'transparent' },
  { label: 'Indigo', value: 'rgba(99, 102, 241, 0.24)', preview: '#6366f1' },
  { label: 'Emerald', value: 'rgba(16, 185, 129, 0.24)', preview: '#10b981' },
  { label: 'Amber', value: 'rgba(245, 158, 11, 0.24)', preview: '#f59e0b' },
  { label: 'Rose', value: 'rgba(239, 68, 68, 0.24)', preview: '#ef4444' },
  { label: 'Sky', value: 'rgba(14, 165, 233, 0.24)', preview: '#0ea5e9' },
  { label: 'Purple', value: 'rgba(168, 85, 247, 0.24)', preview: '#a855f7' },
];

const MATH_QUICK_SYMBOLS = [
  { label: '∑', latex: '\\sum_{i=1}^{n} ' },
  { label: '∫', latex: '\\int_{a}^{b} ' },
  { label: '√x', latex: '\\sqrt{x}' },
  { label: 'a/b', latex: '\\frac{a}{b}' },
  { label: 'x²', latex: 'x^{2}' },
  { label: 'xᵢ', latex: 'x_{i}' },
  { label: '∞', latex: '\\infty' },
  { label: 'π', latex: '\\pi' },
  { label: 'α', latex: '\\alpha' },
  { label: 'β', latex: '\\beta' },
  { label: 'θ', latex: '\\theta' },
  { label: 'λ', latex: '\\lambda' },
  { label: '≈', latex: '\\approx ' },
  { label: '≠', latex: '\\neq ' },
  { label: '≤', latex: '\\leq ' },
  { label: '≥', latex: '\\geq ' },
  { label: '→', latex: '\\rightarrow ' },
  { label: '⇒', latex: '\\Rightarrow ' },
];

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function extractUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  const regex = /https?:\/\/[^\s)\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    urls.add(m[0]);
  }
  return Array.from(urls);
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NoshMobileApp />
    </SafeAreaProvider>
  );
}

function NoshMobileApp() {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(
    insets.top,
    Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0
  );
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 14 : 0);

  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [editorFontSize, setEditorFontSize] = useState<number>(16);
  const [autoSyncOnEdit, setAutoSyncOnEdit] = useState<boolean>(true);
  const theme = themeMode === 'oled' ? OLED_THEME : DARK_THEME;

  // Navigation: Opens directly on 'notes' tab; tapping a note opens the full-screen mobile editor
  const [activeTab, setActiveTab] = useState<MainTab>('notes');
  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Notes & Filters (Tag logic completely removed per user request)
  const [notes, setNotes] = useState<NoshNote[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<NoteFilter>('all');

  // Rich Mobile Editor State
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [activeToolPanel, setActiveToolPanel] = useState<EditorToolPanel>('none');
  const [editorFindOpen, setEditorFindOpen] = useState<boolean>(false);
  const [editorFindQuery, setEditorFindQuery] = useState<string>('');
  const [webLinkUrl, setWebLinkUrl] = useState<string>('');
  const [webLinkLabel, setWebLinkLabel] = useState<string>('');
  const [wikiSearchQuery, setWikiSearchQuery] = useState<string>('');

  // Undo / Redo History Stacks (Per Note ID)
  const undoStackRef = useRef<Record<string, NoteBlock[][]>>({});
  const redoStackRef = useRef<Record<string, NoteBlock[][]>>({});
  const [, setHistoryTick] = useState(0);

  // Keyboard & Auto-Scroll Tracking
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const maxRootHeightRef = useRef<number>(Dimensions.get('window').height);
  const [currentRootHeight, setCurrentRootHeight] = useState<number>(
    Dimensions.get('window').height
  );
  const editorScrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const blockYPositionsRef = useRef<Record<string, number>>({});
  const blockInputRefs = useRef<Record<string, React.ComponentRef<typeof TextInput> | null>>({});
  const focusedBlockIdRef = useRef<string | null>(null);
  focusedBlockIdRef.current = focusedBlockId;

  // Anonymous E2EE QR Sync State
  const [selfPeer, setSelfPeer] = useState<PeerIdentity>(() => createDevicePeer());
  const [activeSession, setActiveSession] = useState<QRSyncPayload | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'syncing'
  >('disconnected');
  const [connectedPeers, setConnectedPeers] = useState<PeerIdentity[]>([]);

  // Modals & Toasts
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const notesRef = useRef<NoshNote[]>([]);
  notesRef.current = notes;
  const syncEngineRef = useRef<AnonymousQRSyncEngine | null>(null);

  const hapticLight = () => {
    try {
      Haptics.selectionAsync();
    } catch {}
  };

  const hapticMedium = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
  };

  const scrollToBlock = (blockId: string | null, delay = 110) => {
    if (!blockId) return;
    setTimeout(() => {
      const y = blockYPositionsRef.current[blockId];
      if (typeof y === 'number' && editorScrollRef.current) {
        editorScrollRef.current.scrollTo({
          y: Math.max(0, y - 80),
          animated: true,
        });
      }
    }, delay);
  };

  // Listen to native Keyboard events on both iOS and Android
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates?.height || 0;
      setKeyboardHeight(h);
      if (focusedBlockIdRef.current) {
        scrollToBlock(focusedBlockIdRef.current, 90);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Compute effective bottom offset so the toolbar rises right above the keyboard
  // whether or not Android's window resized automatically.
  const windowShrunkBy = Math.max(0, maxRootHeightRef.current - currentRootHeight);
  const effectiveKeyboardOffset =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - windowShrunkBy) : 0;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const savedSettings = await loadAppSettings();
      const peer = createDevicePeer(savedSettings.peerId);
      if (savedSettings.theme) setThemeMode(savedSettings.theme);
      if (savedSettings.fontSize) setEditorFontSize(savedSettings.fontSize);
      setAutoSyncOnEdit(savedSettings.autoSyncOnEdit ?? true);
      setSelfPeer(peer);

      const [loadedNotes, pairedSession] = await Promise.all([
        loadVaultNotes(peer.peerId),
        loadPairedSession(),
      ]);

      if (!mounted) return;
      const sanitizedNotes = loadedNotes.map((n) => ({ ...n, tags: [] }));
      setNotes(sanitizedNotes);

      const engine = new AnonymousQRSyncEngine(peer, {
        onStatusChange: (st) => {
          if (mounted) setSyncStatus(st);
        },
        onPeersUpdated: (peerList) => {
          if (mounted) setConnectedPeers([...peerList]);
        },
        onVaultSnapshotReceived: (
          incomingNotes,
          _senderPeer,
          mode,
          manifestTitles
        ) => {
          if (!mounted) return;
          setNotes((prev) => {
            const normalizedIncomingList: NoshNote[] = incomingNotes.map((inc) => {
              const normalizedBlocks =
                inc.blocks && inc.blocks.length > 0
                  ? inc.blocks
                  : parseNshToBlocks(inc.rawNsh || '', 'peer');
              return {
                ...inc,
                id: inc.id || `note-${inc.title}`,
                blocks: normalizedBlocks,
                rawNsh: inc.rawNsh || serializeBlocksToNsh(normalizedBlocks),
                tags: [],
                versionClock: inc.versionClock || 1,
                updatedAt: inc.updatedAt || Date.now(),
              };
            });

            // 1. Replace mode ("Continue with Desktop Vault"): exact match with remote vault
            if (mode === 'replace') {
              notesRef.current = normalizedIncomingList;
              saveVaultNotes(normalizedIncomingList);
              showToast(
                `Loaded ${normalizedIncomingList.length} note(s) from Desktop vault`
              );
              return normalizedIncomingList;
            }

            // 2. Merge or Incremental mode
            const byTitle = new Map(prev.map((n) => [n.title, n]));
            let mergedCount = 0;

            for (const normalizedIncoming of normalizedIncomingList) {
              const existing = byTitle.get(normalizedIncoming.title);
              if (existing) {
                byTitle.set(
                  normalizedIncoming.title,
                  mergeNoteCRDT(existing, normalizedIncoming)
                );
              } else {
                byTitle.set(normalizedIncoming.title, normalizedIncoming);
              }
              mergedCount++;
            }

            // In incremental mode, if a note was deleted on the other device, remove it here too
            if (mode === 'incremental' && Array.isArray(manifestTitles)) {
              const manifestSet = new Set(manifestTitles);
              for (const titleKey of Array.from(byTitle.keys())) {
                if (!manifestSet.has(titleKey)) {
                  byTitle.delete(titleKey);
                  mergedCount++;
                }
              }
            }

            const nextList = Array.from(byTitle.values());
            notesRef.current = nextList;
            saveVaultNotes(nextList);
            if (mergedCount > 0) {
              showToast(
                mode === 'merge'
                  ? `Merged ${nextList.length} total notes across devices`
                  : `Synced ${mergedCount} note(s) from vault`
              );
            }
            return nextList;
          });
        },
        onCRDTBlockOpReceived: (op: CRDTBlockOp) => {
          if (!mounted) return;
          setNotes((prev) => {
            const idx = prev.findIndex((n) => n.title === op.noteTitle);
            if (idx === -1 && op.fullNote) {
              const next = [{ ...op.fullNote, tags: [] }, ...prev];
              saveVaultNotes(next);
              return next;
            }
            if (idx === -1) return prev;

            const target = prev[idx];
            let updatedBlocks = [...target.blocks];

            if (op.opType === 'upsert-block' && op.block) {
              const bIdx = updatedBlocks.findIndex((b) => b.id === op.block!.id);
              if (bIdx >= 0) {
                if (op.block.updatedAt >= updatedBlocks[bIdx].updatedAt) {
                  updatedBlocks[bIdx] = op.block;
                }
              } else {
                const insertPos =
                  typeof op.blockIndex === 'number'
                    ? Math.min(op.blockIndex, updatedBlocks.length)
                    : updatedBlocks.length;
                updatedBlocks.splice(insertPos, 0, op.block);
              }
            } else if (op.opType === 'delete-block' && op.blockId) {
              updatedBlocks = updatedBlocks.filter((b) => b.id !== op.blockId);
            } else if (op.opType === 'replace-note' && op.fullNote) {
              const merged = mergeNoteCRDT(target, op.fullNote);
              const next = [...prev];
              next[idx] = { ...merged, tags: [] };
              saveVaultNotes(next);
              return next;
            }

            const updatedNote: NoshNote = {
              ...target,
              blocks: updatedBlocks,
              rawNsh: serializeBlocksToNsh(updatedBlocks),
              tags: [],
              updatedAt: Math.max(target.updatedAt, op.noteUpdatedAt),
              versionClock: Math.max(target.versionClock, op.versionClock) + 1,
            };

            const next = [...prev];
            next[idx] = updatedNote;
            saveVaultNotes(next);
            return next;
          });
        },
        getCurrentVaultNotes: () => notesRef.current,
      });

      syncEngineRef.current = engine;

      if (pairedSession) {
        setActiveSession(pairedSession);
        engine.connectToSession(pairedSession);
      }
    })();

    return () => {
      mounted = false;
      syncEngineRef.current?.disconnect();
    };
  }, []);

  const activeNotes = useMemo(
    () => notes.filter((n) => !n.trashed),
    [notes]
  );

  const activeNote = useMemo(
    () => activeNotes.find((n) => n.id === activeNoteId) || null,
    [activeNotes, activeNoteId]
  );

  const focusedBlock = useMemo(() => {
    if (!activeNote) return null;
    if (focusedBlockId) {
      const found = activeNote.blocks.find((b) => b.id === focusedBlockId);
      if (found) return found;
    }
    return activeNote.blocks[activeNote.blocks.length - 1] || null;
  }, [activeNote, focusedBlockId]);

  const filteredNotes = useMemo(() => {
    return activeNotes
      .filter((n) => {
        if (selectedFilter === 'pinned' && !n.pinned) return false;
        if (
          selectedFilter === 'code' &&
          !n.blocks.some((b) => b.type === 'code')
        ) {
          return false;
        }
        if (
          selectedFilter === 'tasks' &&
          !n.blocks.some((b) => b.type === 'checklist')
        ) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.blocks.some((b) => b.content.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [activeNotes, selectedFilter, searchQuery]);

  const editorStats = useMemo(() => {
    if (!activeNote) return { words: 0, chars: 0, codeBlocks: 0 };
    let text = '';
    let codeBlocks = 0;
    for (const b of activeNote.blocks) {
      if (b.type === 'code') codeBlocks++;
      text += ' ' + (b.content || '');
    }
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, chars: trimmed.length, codeBlocks };
  }, [activeNote]);

  const findMatchBlockIds = useMemo(() => {
    if (!activeNote || !editorFindOpen || !editorFindQuery.trim()) return [];
    const q = editorFindQuery.toLowerCase();
    return activeNote.blocks
      .filter((b) => b.content.toLowerCase().includes(q))
      .map((b) => b.id);
  }, [activeNote, editorFindOpen, editorFindQuery]);

  const pushUndoSnapshot = (noteId: string, blocks: NoteBlock[]) => {
    const stack = undoStackRef.current[noteId] || [];
    const snapshot = blocks.map((b) => ({ ...b }));
    const last = stack[stack.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;
    undoStackRef.current[noteId] = [...stack.slice(-29), snapshot];
    redoStackRef.current[noteId] = [];
    setHistoryTick((t) => t + 1);
  };

  const handleUndo = () => {
    if (!activeNote) return;
    const stack = undoStackRef.current[activeNote.id] || [];
    if (stack.length === 0) return;
    hapticLight();
    const previousBlocks = stack[stack.length - 1];
    undoStackRef.current[activeNote.id] = stack.slice(0, -1);
    const redoStack = redoStackRef.current[activeNote.id] || [];
    redoStackRef.current[activeNote.id] = [
      ...redoStack,
      activeNote.blocks.map((b) => ({ ...b })),
    ];
    setHistoryTick((t) => t + 1);
    updateNoteById(activeNote.id, (n) => ({ ...n, blocks: previousBlocks }), undefined, false);
  };

  const handleRedo = () => {
    if (!activeNote) return;
    const redoStack = redoStackRef.current[activeNote.id] || [];
    if (redoStack.length === 0) return;
    hapticLight();
    const nextBlocks = redoStack[redoStack.length - 1];
    redoStackRef.current[activeNote.id] = redoStack.slice(0, -1);
    const undoStack = undoStackRef.current[activeNote.id] || [];
    undoStackRef.current[activeNote.id] = [
      ...undoStack,
      activeNote.blocks.map((b) => ({ ...b })),
    ];
    setHistoryTick((t) => t + 1);
    updateNoteById(activeNote.id, (n) => ({ ...n, blocks: nextBlocks }), undefined, false);
  };

  const updateNoteById = (
    noteId: string,
    updater: (n: NoshNote) => NoshNote,
    crdtOp?: Omit<CRDTBlockOp, 'sender' | 'noteTitle' | 'noteUpdatedAt' | 'versionClock'>,
    recordHistory = true
  ) => {
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === noteId);
      if (idx === -1) return prev;
      const current = prev[idx];
      if (recordHistory) {
        pushUndoSnapshot(noteId, current.blocks);
      }
      const updated = updater(current);
      const finalized: NoshNote = {
        ...updated,
        rawNsh: serializeBlocksToNsh(updated.blocks),
        tags: [],
        updatedAt: Date.now(),
        versionClock: (current.versionClock || 1) + 1,
      };
      const next = [...prev];
      next[idx] = finalized;
      notesRef.current = next;
      saveVaultNotes(next);

      if (autoSyncOnEdit && syncEngineRef.current) {
        if (crdtOp) {
          syncEngineRef.current.broadcastBlockOp({
            ...crdtOp,
            noteTitle: finalized.title,
            noteUpdatedAt: finalized.updatedAt,
            versionClock: finalized.versionClock,
          });
        } else {
          syncEngineRef.current.pushVaultSnapshot();
        }
      }

      return next;
    });
  };

  const handleCreateNewNote = (initialBlockType: BlockType = 'paragraph') => {
    hapticMedium();
    const now = Date.now();
    const existingTitles = new Set(notes.map((n) => n.title));
    let uniqueTitle = 'Untitled Note';
    let c = 1;
    while (existingTitles.has(uniqueTitle)) {
      uniqueTitle = `Untitled Note (${c++})`;
    }

    const firstBlockId = generateBlockId(initialBlockType);
    const blocks: NoteBlock[] = [
      {
        id: firstBlockId,
        type: initialBlockType,
        content: '',
        language: initialBlockType === 'code' ? 'TypeScript' : undefined,
        checked: initialBlockType === 'checklist' ? false : undefined,
        updatedAt: now,
        updatedBy: selfPeer.peerId,
      },
    ];

    const newNote: NoshNote = {
      id: `note-${now}`,
      title: uniqueTitle,
      blocks,
      rawNsh: serializeBlocksToNsh(blocks),
      tags: [],
      pinned: false,
      updatedAt: now,
      versionClock: 1,
    };

    const next = [newNote, ...notes];
    notesRef.current = next;
    setNotes(next);
    saveVaultNotes(next);
    setActiveNoteId(newNote.id);
    setFocusedBlockId(firstBlockId);
    setActiveToolPanel('none');
    setEditorOpen(true);

    syncEngineRef.current?.broadcastBlockOp({
      noteTitle: newNote.title,
      noteUpdatedAt: newNote.updatedAt,
      versionClock: newNote.versionClock,
      opType: 'replace-note',
      fullNote: newNote,
    });
  };

  const handleOpenNote = (noteId: string) => {
    hapticLight();
    const target = notes.find((n) => n.id === noteId);
    setActiveNoteId(noteId);
    setFocusedBlockId(target?.blocks[0]?.id || null);
    setActiveToolPanel('none');
    setEditorFindOpen(false);
    setEditorFindQuery('');
    setEditorOpen(true);
  };

  // Inserts a new block right after the currently focused block (or at the end)
  const handleInsertBlockAfterFocused = (
    type: BlockType,
    initialContent = ''
  ) => {
    if (!activeNote) return;
    hapticLight();
    const now = Date.now();
    const currentIndex = focusedBlock
      ? activeNote.blocks.findIndex((b) => b.id === focusedBlock.id)
      : activeNote.blocks.length - 1;
    const insertIndex =
      currentIndex >= 0 ? currentIndex + 1 : activeNote.blocks.length;

    const prevBlock = activeNote.blocks[currentIndex];
    const nextListIndex =
      type === 'numberedList'
        ? prevBlock?.type === 'numberedList'
          ? (prevBlock.listIndex || 1) + 1
          : 1
        : undefined;

    const newBlock: NoteBlock = {
      id: generateBlockId(type),
      type,
      content:
        type === 'math' && !initialContent
          ? '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}'
          : initialContent,
      language: type === 'code' ? 'TypeScript' : undefined,
      checked: type === 'checklist' ? false : undefined,
      listIndex: nextListIndex,
      updatedAt: now,
      updatedBy: selfPeer.peerId,
    };

    updateNoteById(
      activeNote.id,
      (n) => {
        const nextBlocks = [...n.blocks];
        nextBlocks.splice(insertIndex, 0, newBlock);
        return { ...n, blocks: nextBlocks };
      },
      {
        opType: 'upsert-block',
        block: newBlock,
        blockIndex: insertIndex,
      }
    );

    setFocusedBlockId(newBlock.id);
    setTimeout(() => {
      blockInputRefs.current[newBlock.id]?.focus();
      scrollToBlock(newBlock.id, 60);
    }, 80);
  };

  // Applies a block format type to the currently focused block (if text-compatible),
  // or inserts a new block of that type if the current block is a divider/code/math.
  const handleSetOrInsertBlockType = (targetType: BlockType) => {
    if (!activeNote) return;
    hapticLight();

    if (
      targetType === 'divider' ||
      targetType === 'code' ||
      targetType === 'math'
    ) {
      handleInsertBlockAfterFocused(targetType);
      if (targetType === 'math') {
        setActiveToolPanel('math');
      }
      return;
    }

    if (
      focusedBlock &&
      focusedBlock.type !== 'code' &&
      focusedBlock.type !== 'divider' &&
      focusedBlock.type !== 'math'
    ) {
      const nextType: BlockType =
        focusedBlock.type === targetType && targetType !== 'paragraph'
          ? 'paragraph'
          : targetType;
      handleUpdateBlock(focusedBlock.id, {
        type: nextType,
        checked: nextType === 'checklist' ? Boolean(focusedBlock.checked) : undefined,
        listIndex: nextType === 'numberedList' ? focusedBlock.listIndex || 1 : undefined,
      });
      setTimeout(() => {
        blockInputRefs.current[focusedBlock.id]?.focus();
      }, 40);
    } else {
      handleInsertBlockAfterFocused(targetType);
    }
  };

  const handleToggleInlineStyle = (
    prop: 'bold' | 'italic' | 'underline' | 'strikethrough'
  ) => {
    if (!activeNote || !focusedBlock) return;
    hapticLight();
    handleUpdateBlock(focusedBlock.id, {
      [prop]: !focusedBlock[prop],
    });
  };

  const handleSetAlignment = (align: 'left' | 'center' | 'right') => {
    if (!activeNote || !focusedBlock) return;
    hapticLight();
    handleUpdateBlock(focusedBlock.id, { align });
  };

  const handleMoveFocusedBlock = (direction: -1 | 1) => {
    if (!activeNote || !focusedBlock) return;
    const idx = activeNote.blocks.findIndex((b) => b.id === focusedBlock.id);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= activeNote.blocks.length) return;
    hapticLight();
    updateNoteById(activeNote.id, (n) => {
      const next = [...n.blocks];
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      return { ...n, blocks: next };
    });
    scrollToBlock(focusedBlock.id, 70);
  };

  const handleDuplicateFocusedBlock = () => {
    if (!activeNote || !focusedBlock) return;
    hapticLight();
    const idx = activeNote.blocks.findIndex((b) => b.id === focusedBlock.id);
    const copyBlock: NoteBlock = {
      ...focusedBlock,
      id: generateBlockId(focusedBlock.type),
      updatedAt: Date.now(),
      updatedBy: selfPeer.peerId,
    };
    updateNoteById(activeNote.id, (n) => {
      const next = [...n.blocks];
      next.splice(idx + 1, 0, copyBlock);
      return { ...n, blocks: next };
    });
    setFocusedBlockId(copyBlock.id);
    scrollToBlock(copyBlock.id, 80);
    showToast('Duplicated block');
  };

  const handleAppendTextToFocusedBlock = (snippet: string) => {
    if (!activeNote) return;
    if (
      focusedBlock &&
      focusedBlock.type !== 'divider' &&
      focusedBlock.type !== 'code'
    ) {
      const sep =
        focusedBlock.content.length > 0 && !focusedBlock.content.endsWith(' ')
          ? ' '
          : '';
      handleUpdateBlock(focusedBlock.id, {
        content: `${focusedBlock.content}${sep}${snippet}`,
      });
    } else {
      handleInsertBlockAfterFocused('paragraph', snippet);
    }
  };

  const handleUpdateBlock = (blockId: string, patch: Partial<NoteBlock>) => {
    if (!activeNote) return;
    let updatedBlockRef: NoteBlock | undefined;
    let blockIdx = 0;

    updateNoteById(
      activeNote.id,
      (n) => {
        const nextBlocks = n.blocks.map((b, i) => {
          if (b.id === blockId) {
            blockIdx = i;
            updatedBlockRef = {
              ...b,
              ...patch,
              updatedAt: Date.now(),
              updatedBy: selfPeer.peerId,
            };
            return updatedBlockRef;
          }
          return b;
        });
        return { ...n, blocks: nextBlocks };
      },
      updatedBlockRef
        ? {
            opType: 'upsert-block',
            block: updatedBlockRef,
            blockIndex: blockIdx,
          }
        : undefined
    );
  };

  const handleDeleteBlock = (blockId: string) => {
    if (!activeNote) return;
    hapticLight();
    updateNoteById(
      activeNote.id,
      (n) => {
        if (n.blocks.length <= 1) {
          return {
            ...n,
            blocks: [
              {
                ...n.blocks[0],
                type: 'paragraph',
                content: '',
                bold: false,
                italic: false,
                underline: false,
                strikethrough: false,
                textColor: undefined,
                highlightColor: undefined,
              },
            ],
          };
        }
        return {
          ...n,
          blocks: n.blocks.filter((b) => b.id !== blockId),
        };
      },
      {
        opType: 'delete-block',
        blockId,
      }
    );
  };

  const handleExportActiveNote = async () => {
    if (!activeNote) return;
    try {
      const nsh = activeNote.rawNsh || serializeBlocksToNsh(activeNote.blocks);
      await Clipboard.setStringAsync(nsh);
      hapticLight();
      showToast('Copied .nsh markup to clipboard');
    } catch {
      showToast('Failed to copy note');
    }
  };

  const handleJumpOrCreateWikiLink = (targetTitle: string) => {
    hapticLight();
    const found = activeNotes.find(
      (n) => n.title.toLowerCase() === targetTitle.toLowerCase()
    );
    if (found) {
      setActiveNoteId(found.id);
      setFocusedBlockId(found.blocks[0]?.id || null);
      setEditorOpen(true);
    } else {
      const now = Date.now();
      const firstId = generateBlockId('p');
      const blocks: NoteBlock[] = [
        {
          id: firstId,
          type: 'paragraph',
          content: '',
          updatedAt: now,
          updatedBy: selfPeer.peerId,
        },
      ];
      const created: NoshNote = {
        id: `note-${now}`,
        title: targetTitle,
        blocks,
        rawNsh: serializeBlocksToNsh(blocks),
        tags: [],
        pinned: false,
        updatedAt: now,
        versionClock: 1,
      };
      const next = [created, ...notes];
      setNotes(next);
      saveVaultNotes(next);
      setActiveNoteId(created.id);
      setFocusedBlockId(firstId);
      setEditorOpen(true);
    }
  };

  const handleJoinQRSession = (
    payload: QRSyncPayload,
    joinStrategy: 'replace' | 'merge' = 'replace'
  ) => {
    setActiveSession(payload);
    savePairedSession(payload);
    syncEngineRef.current?.connectToSession(payload, joinStrategy);
    showToast(
      joinStrategy === 'replace'
        ? 'Loading Desktop vault...'
        : 'Merging both devices...'
    );
  };

  const handleCreateNewQRSession = (
    mode: 'vault' | 'collab-note',
    targetNote?: string
  ): QRSyncPayload => {
    const newSession = createNewRoomSession(mode, targetNote);
    setActiveSession(newSession);
    savePairedSession(newSession);
    syncEngineRef.current?.connectToSession(newSession);
    showToast('Generated new encrypted auth token');
    return newSession;
  };

  const handleDisconnectQRSession = () => {
    const freshSession = createNewRoomSession('vault');
    setActiveSession(freshSession);
    savePairedSession(freshSession);
    syncEngineRef.current?.connectToSession(freshSession);
    showToast('Generated new local auth token');
  };

  // ============================================================================
  // RENDER MOBILE NOTE CARD (Tags Removed)
  // ============================================================================
  const renderMobileNoteCard = (note: NoshNote) => {
    const previewBlocks = note.blocks.filter(
      (b) => b.type !== 'divider' && b.content.trim().length > 0
    );
    const previewText =
      previewBlocks.length > 0
        ? previewBlocks
            .slice(0, 2)
            .map((b) =>
              b.type === 'code'
                ? `[${b.language || 'Code'}] ${b.content.split('\n')[0]}`
                : b.type === 'math'
                ? `[Formula] ${b.content}`
                : b.content
            )
            .join(' · ')
        : 'Empty note — tap to start writing...';

    const codeBlocks = note.blocks.filter((b) => b.type === 'code');
    const tasks = note.blocks.filter((b) => b.type === 'checklist');
    const doneTasks = tasks.filter((t) => t.checked).length;

    return (
      <TouchableOpacity
        key={note.id}
        style={[
          styles.noteCard,
          {
            backgroundColor: theme.bgSurface,
            borderColor: note.pinned ? theme.accentBorder : theme.borderSubtle,
          },
        ]}
        activeOpacity={0.8}
        onPress={() => handleOpenNote(note.id)}
      >
        {/* Top Row: Document Icon + Title + Timestamp + Pin */}
        <View style={styles.noteCardHeader}>
          <View style={styles.noteCardTitleWrap}>
            <View
              style={[
                styles.pinIconWrap,
                {
                  backgroundColor: note.pinned
                    ? theme.accentSubtle
                    : theme.bgElevated,
                },
              ]}
            >
              <SolarIcon
                name={
                  note.pinned ? 'solar:pin-bold' : 'solar:document-text-linear'
                }
                size={14}
                color={note.pinned ? theme.accent : theme.textSecondary}
              />
            </View>
            <Text
              style={[styles.noteCardTitle, { color: theme.textPrimary }]}
              numberOfLines={1}
            >
              {note.title}
            </Text>
          </View>

          <View style={styles.noteCardMetaRight}>
            <Text style={[styles.noteCardTime, { color: theme.textMuted }]}>
              {formatRelativeTime(note.updatedAt)}
            </Text>
            <TouchableOpacity
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => {
                hapticLight();
                updateNoteById(note.id, (n) => ({ ...n, pinned: !n.pinned }));
              }}
            >
              <SolarIcon
                name={note.pinned ? 'solar:pin-bold' : 'solar:pin-linear'}
                size={16}
                color={note.pinned ? theme.accent : theme.textMuted}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Preview Snippet */}
        <Text
          style={[styles.noteCardPreview, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {previewText}
        </Text>

        {/* Bottom Badges Row (Code languages & Checklist progress only) */}
        {(codeBlocks.length > 0 || tasks.length > 0) && (
          <View style={styles.noteCardFooter}>
            {codeBlocks.slice(0, 2).map((cb) => {
              const meta = getLanguageMeta(cb.language);
              return (
                <View
                  key={cb.id}
                  style={[
                    styles.cardBadge,
                    { backgroundColor: theme.bgElevated },
                  ]}
                >
                  <SolarIcon name={meta.icon} size={13} color={meta.color} />
                  <Text
                    style={[
                      styles.cardBadgeText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </View>
              );
            })}

            {tasks.length > 0 && (
              <View
                style={[
                  styles.cardBadge,
                  { backgroundColor: theme.bgElevated },
                ]}
              >
                <SolarIcon
                  name="solar:checklist-minimalistic-linear"
                  size={13}
                  color={
                    doneTasks === tasks.length
                      ? theme.success
                      : theme.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.cardBadgeText,
                    { color: theme.textSecondary },
                  ]}
                >
                  {doneTasks}/{tasks.length}
                </Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const canUndo =
    activeNote && (undoStackRef.current[activeNote.id]?.length || 0) > 0;
  const canRedo =
    activeNote && (redoStackRef.current[activeNote.id]?.length || 0) > 0;

  return (
    <View
      style={[styles.root, { backgroundColor: theme.bgApp }]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (h > maxRootHeightRef.current) {
          maxRootHeightRef.current = h;
        }
        setCurrentRootHeight(h);
      }}
    >
      <StatusBar barStyle="light-content" />

      {/* ====================================================================
          FULL-SCREEN MOBILE EDITOR VIEW (When a note is open)
         ==================================================================== */}
      {editorOpen && activeNote ? (
        <View
          style={{
            flex: 1,
            paddingBottom: effectiveKeyboardOffset,
          }}
        >
          {/* Mobile Editor Top Navigation Bar */}
          <View
            style={[
              styles.editorNavHeader,
              {
                backgroundColor: theme.bgApp,
                borderBottomColor: theme.borderSubtle,
                paddingTop: topInset + 8,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.editorBackPill,
                { backgroundColor: theme.bgSurface },
              ]}
              onPress={() => {
                hapticLight();
                Keyboard.dismiss();
                setEditorOpen(false);
              }}
              activeOpacity={0.75}
            >
              <SolarIcon
                name="solar:alt-arrow-left-linear"
                size={17}
                color={theme.textPrimary}
              />
              <Text style={[styles.editorBackText, { color: theme.textPrimary }]}>
                Notes
              </Text>
            </TouchableOpacity>

            <View style={styles.editorHeaderActions}>
              {/* Undo Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  {
                    backgroundColor: theme.bgSurface,
                    opacity: canUndo ? 1 : 0.4,
                  },
                ]}
                disabled={!canUndo}
                onPress={handleUndo}
              >
                <SolarIcon
                  name="solar:undo-left-linear"
                  size={17}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Redo Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  {
                    backgroundColor: theme.bgSurface,
                    opacity: canRedo ? 1 : 0.4,
                  },
                ]}
                disabled={!canRedo}
                onPress={handleRedo}
              >
                <SolarIcon
                  name="solar:undo-right-linear"
                  size={17}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Find in Note Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  {
                    backgroundColor: editorFindOpen
                      ? theme.accentSubtle
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  setEditorFindOpen((prev) => !prev);
                }}
              >
                <SolarIcon
                  name="solar:magnifer-linear"
                  size={17}
                  color={editorFindOpen ? theme.accent : theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Pin Note Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  {
                    backgroundColor: activeNote.pinned
                      ? theme.accentSubtle
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  updateNoteById(activeNote.id, (n) => ({
                    ...n,
                    pinned: !n.pinned,
                  }));
                }}
              >
                <SolarIcon
                  name={activeNote.pinned ? 'solar:pin-bold' : 'solar:pin-linear'}
                  size={17}
                  color={activeNote.pinned ? theme.accent : theme.textSecondary}
                />
              </TouchableOpacity>

              {/* QR Sync Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  {
                    backgroundColor:
                      syncStatus === 'connected'
                        ? theme.successSubtle
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  setQrModalOpen(true);
                }}
              >
                <SolarIcon
                  name="solar:qr-code-linear"
                  size={17}
                  color={
                    syncStatus === 'connected'
                      ? theme.success
                      : theme.textSecondary
                  }
                />
              </TouchableOpacity>

              {/* Copy .nsh Markup Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  { backgroundColor: theme.bgSurface },
                ]}
                onPress={handleExportActiveNote}
              >
                <SolarIcon
                  name="solar:share-circle-linear"
                  size={18}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Move to Trash Button */}
              <TouchableOpacity
                style={[
                  styles.editorCircleBtn,
                  { backgroundColor: theme.dangerSubtle },
                ]}
                onPress={() => {
                  hapticMedium();
                  Keyboard.dismiss();
                  updateNoteById(activeNote.id, (n) => ({
                    ...n,
                    trashed: true,
                  }));
                  setEditorOpen(false);
                  showToast('Moved note to Trash');
                }}
              >
                <SolarIcon
                  name="solar:trash-bin-trash-linear"
                  size={17}
                  color={theme.danger}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Collapsible In-Note Find Bar (Matches Desktop Ctrl+F) */}
          {editorFindOpen && (
            <View
              style={[
                styles.findInNoteBar,
                {
                  backgroundColor: theme.bgSurface,
                  borderBottomColor: theme.borderSubtle,
                },
              ]}
            >
              <SolarIcon
                name="solar:magnifer-linear"
                size={16}
                color={theme.accent}
              />
              <TextInput
                value={editorFindQuery}
                onChangeText={(q) => {
                  setEditorFindQuery(q);
                  if (q.trim()) {
                    const matchBlock = activeNote.blocks.find((b) =>
                      b.content.toLowerCase().includes(q.toLowerCase())
                    );
                    if (matchBlock) {
                      scrollToBlock(matchBlock.id, 40);
                    }
                  }
                }}
                placeholder="Find in this note..."
                placeholderTextColor={theme.textMuted}
                autoFocus
                style={[styles.findInNoteInput, { color: theme.textPrimary }]}
              />
              <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>
                {editorFindQuery.trim()
                  ? `${findMatchBlockIds.length} match${
                      findMatchBlockIds.length === 1 ? '' : 'es'
                    }`
                  : ''}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setEditorFindOpen(false);
                  setEditorFindQuery('');
                }}
              >
                <SolarIcon
                  name="solar:close-circle-linear"
                  size={18}
                  color={theme.textMuted}
                />
              </TouchableOpacity>
            </View>
          )}

          {/* Mobile Document Body */}
          <ScrollView
            ref={editorScrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[
              styles.editorScrollContent,
              { paddingBottom: keyboardHeight > 0 ? 180 : 90 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Large Mobile Note Title */}
            <TextInput
              value={activeNote.title}
              onChangeText={(newTitle) =>
                updateNoteById(activeNote.id, (n) => ({
                  ...n,
                  title: newTitle,
                }))
              }
              placeholder="Note title..."
              placeholderTextColor={theme.textMuted}
              style={[styles.mobileTitleInput, { color: theme.textPrimary }]}
            />

            {/* Subtle Mobile Metadata Row (No Tags) */}
            <View style={styles.editorMetaRow}>
              <Text style={[styles.editorMetaText, { color: theme.textMuted }]}>
                Edited {formatRelativeTime(activeNote.updatedAt)} ·{' '}
                {editorStats.words} words · {editorStats.chars} chars
                {editorStats.codeBlocks > 0
                  ? ` · ${editorStats.codeBlocks} code blocks`
                  : ''}
              </Text>
            </View>

            {/* Blocks */}
            {activeNote.blocks.map((block, blockIndex) => {
              const isFocused = focusedBlock?.id === block.id;
              const isFindMatch = findMatchBlockIds.includes(block.id);

              // Compute dynamic numbered list index
              let computedNumberIndex = block.listIndex || 1;
              if (block.type === 'numberedList') {
                let count = 1;
                for (let k = blockIndex - 1; k >= 0; k--) {
                  if (activeNote.blocks[k].type === 'numberedList') {
                    count++;
                  } else {
                    break;
                  }
                }
                computedNumberIndex = count;
              }

              return (
                <View
                  key={block.id}
                  onLayout={(e) => {
                    blockYPositionsRef.current[block.id] =
                      e.nativeEvent.layout.y;
                  }}
                  style={[
                    isFindMatch && {
                      backgroundColor: 'rgba(245, 158, 11, 0.14)',
                      borderRadius: 12,
                      paddingHorizontal: 6,
                    },
                  ]}
                >
                  {block.type === 'code' ? (
                    <View
                      onTouchStart={() => {
                        setFocusedBlockId(block.id);
                      }}
                    >
                      <CodeBlockCard
                        block={block}
                        theme={theme}
                        onChangeCode={(text) =>
                          handleUpdateBlock(block.id, { content: text })
                        }
                        onChangeLanguage={(lang) =>
                          handleUpdateBlock(block.id, { language: lang })
                        }
                        onToggleWrap={() =>
                          handleUpdateBlock(block.id, { wrap: !block.wrap })
                        }
                        onDelete={() => handleDeleteBlock(block.id)}
                      />
                    </View>
                  ) : block.type === 'divider' ? (
                    <TouchableOpacity
                      onPress={() => setFocusedBlockId(block.id)}
                      onLongPress={() => handleDeleteBlock(block.id)}
                      style={styles.dividerWrap}
                    >
                      <View
                        style={[
                          styles.dividerLine,
                          {
                            backgroundColor: isFocused
                              ? theme.accent
                              : theme.borderMedium,
                          },
                        ]}
                      />
                    </TouchableOpacity>
                  ) : block.type === 'math' ? (
                    <View
                      style={[
                        styles.mathBlockCard,
                        {
                          backgroundColor: theme.bgSurface,
                          borderColor: isFocused
                            ? theme.accent
                            : theme.borderSubtle,
                        },
                      ]}
                    >
                      <View style={styles.mathHeaderRow}>
                        <View style={styles.mathBadge}>
                          <SolarIcon
                            name="solar:calculator-minimalistic-linear"
                            size={14}
                            color={theme.accent}
                          />
                          <Text
                            style={{
                              color: theme.accent,
                              fontSize: 11.5,
                              fontWeight: '700',
                            }}
                          >
                            LaTeX Math Formula
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteBlock(block.id)}
                        >
                          <SolarIcon
                            name="solar:close-circle-linear"
                            size={17}
                            color={theme.textMuted}
                          />
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        ref={(r) => {
                          blockInputRefs.current[block.id] = r;
                        }}
                        value={block.content}
                        onFocus={() => {
                          setFocusedBlockId(block.id);
                          setActiveToolPanel('math');
                          scrollToBlock(block.id, 90);
                        }}
                        onChangeText={(t) => {
                          handleUpdateBlock(block.id, { content: t });
                          scrollToBlock(block.id, 60);
                        }}
                        placeholder="\int_0^\infty e^{-x^2} dx"
                        placeholderTextColor={theme.textMuted}
                        multiline
                        style={[
                          styles.mathInput,
                          {
                            color: theme.textPrimary,
                            fontSize: editorFontSize,
                          },
                        ]}
                      />
                    </View>
                  ) : block.type === 'checklist' ? (
                    <View
                      style={[
                        styles.checklistCard,
                        {
                          backgroundColor:
                            block.highlightColor || theme.bgSurface,
                          borderColor: isFocused
                            ? theme.accentBorder
                            : theme.borderSubtle,
                        },
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          styles.checkboxCircle,
                          {
                            backgroundColor: block.checked
                              ? theme.accent
                              : 'transparent',
                            borderColor: block.checked
                              ? theme.accent
                              : theme.borderMedium,
                          },
                        ]}
                        onPress={() => {
                          hapticLight();
                          handleUpdateBlock(block.id, {
                            checked: !block.checked,
                          });
                        }}
                      >
                        {block.checked && (
                          <SolarIcon
                            name="solar:check-read-linear"
                            size={14}
                            color="#fff"
                          />
                        )}
                      </TouchableOpacity>

                      <TextInput
                        ref={(r) => {
                          blockInputRefs.current[block.id] = r;
                        }}
                        value={block.content}
                        onFocus={() => {
                          setFocusedBlockId(block.id);
                          scrollToBlock(block.id, 90);
                        }}
                        onChangeText={(t) => {
                          handleUpdateBlock(block.id, { content: t });
                        }}
                        placeholder="To-do item..."
                        placeholderTextColor={theme.textMuted}
                        multiline
                        style={[
                          styles.checklistInput,
                          {
                            fontSize: editorFontSize,
                            color: block.checked
                              ? theme.textMuted
                              : block.textColor || theme.textPrimary,
                            fontWeight: block.bold ? '700' : '400',
                            fontStyle: block.italic ? 'italic' : 'normal',
                            textAlign: block.align || 'left',
                            textDecorationLine:
                              block.checked || block.strikethrough
                                ? 'line-through'
                                : block.underline
                                ? 'underline'
                                : 'none',
                          },
                        ]}
                      />

                      {activeNote.blocks.length > 1 && (
                        <TouchableOpacity
                          onPress={() => handleDeleteBlock(block.id)}
                          style={styles.deleteBlockBtn}
                        >
                          <SolarIcon
                            name="solar:close-circle-linear"
                            size={18}
                            color={theme.textMuted}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : (
                    (() => {
                      const wikiLinks = extractWikiLinksFromBlocks([block]);
                      const webUrls = extractUrlsFromText(block.content);

                      const textDecorations: string[] = [];
                      if (block.underline) textDecorations.push('underline');
                      if (block.strikethrough)
                        textDecorations.push('line-through');

                      return (
                        <View
                          style={[
                            styles.textBlockContainer,
                            block.highlightColor
                              ? {
                                  backgroundColor: block.highlightColor,
                                  borderRadius: 10,
                                  paddingHorizontal: 10,
                                  paddingVertical: 4,
                                }
                              : null,
                            block.type === 'quote' && {
                              borderLeftWidth: 3.5,
                              borderLeftColor: theme.accent,
                              paddingLeft: 14,
                              paddingVertical: 6,
                              backgroundColor:
                                block.highlightColor || theme.bgSurface,
                              borderRadius: 12,
                            },
                          ]}
                        >
                          <View style={styles.textBlockRow}>
                            {block.type === 'bulletList' && (
                              <Text
                                style={[
                                  styles.listPrefixBullet,
                                  {
                                    color: theme.accent,
                                    fontSize: editorFontSize + 2,
                                  },
                                ]}
                              >
                                •
                              </Text>
                            )}

                            {block.type === 'numberedList' && (
                              <Text
                                style={[
                                  styles.listPrefixNumber,
                                  {
                                    color: theme.accent,
                                    fontSize: editorFontSize,
                                  },
                                ]}
                              >
                                {computedNumberIndex}.
                              </Text>
                            )}

                            <TextInput
                              ref={(r) => {
                                blockInputRefs.current[block.id] = r;
                              }}
                              value={block.content}
                              onFocus={() => {
                                setFocusedBlockId(block.id);
                                scrollToBlock(block.id, 90);
                              }}
                              onChangeText={(t) => {
                                handleUpdateBlock(block.id, { content: t });
                              }}
                              multiline
                              placeholder={
                                block.type === 'heading1'
                                  ? 'Heading 1'
                                  : block.type === 'heading2'
                                  ? 'Heading 2'
                                  : block.type === 'heading3'
                                  ? 'Heading 3'
                                  : block.type === 'bulletList'
                                  ? 'List item...'
                                  : block.type === 'numberedList'
                                  ? 'Numbered item...'
                                  : block.type === 'quote'
                                  ? 'Write a quote...'
                                  : 'Tap to write...'
                              }
                              placeholderTextColor={theme.textMuted}
                              style={[
                                styles.blockTextInput,
                                {
                                  fontSize: editorFontSize,
                                  color: block.textColor || theme.textPrimary,
                                  textAlign: block.align || 'left',
                                  fontWeight: block.bold ? '700' : '400',
                                  fontStyle: block.italic ? 'italic' : 'normal',
                                  textDecorationLine:
                                    textDecorations.length > 0
                                      ? (textDecorations.join(' ') as
                                          | 'underline'
                                          | 'line-through'
                                          | 'underline line-through')
                                      : 'none',
                                },
                                block.type === 'heading1' && styles.h1Mobile,
                                block.type === 'heading2' && styles.h2Mobile,
                                block.type === 'heading3' && styles.h3Mobile,
                                block.type === 'quote' && {
                                  color:
                                    block.textColor || theme.textSecondary,
                                  fontStyle: 'italic',
                                },
                              ]}
                            />

                            {activeNote.blocks.length > 1 && isFocused && (
                              <TouchableOpacity
                                onPress={() => handleDeleteBlock(block.id)}
                                style={styles.deleteBlockBtn}
                              >
                                <SolarIcon
                                  name="solar:close-circle-linear"
                                  size={16}
                                  color={theme.textMuted}
                                />
                              </TouchableOpacity>
                            )}
                          </View>

                          {(wikiLinks.length > 0 || webUrls.length > 0) && (
                            <View style={styles.wikiChipsRow}>
                              {wikiLinks.map((target) => (
                                <TouchableOpacity
                                  key={`wiki-${target}`}
                                  style={[
                                    styles.wikiChip,
                                    {
                                      backgroundColor: theme.accentSubtle,
                                      borderColor: theme.accentBorder,
                                    },
                                  ]}
                                  onPress={() =>
                                    handleJumpOrCreateWikiLink(target)
                                  }
                                >
                                  <SolarIcon
                                    name="solar:link-circle-linear"
                                    size={14}
                                    color={theme.accent}
                                  />
                                  <Text
                                    style={{
                                      color: theme.accent,
                                      fontSize: 12,
                                      fontWeight: '700',
                                    }}
                                  >
                                    {target}
                                  </Text>
                                </TouchableOpacity>
                              ))}

                              {webUrls.map((url) => (
                                <TouchableOpacity
                                  key={`url-${url}`}
                                  style={[
                                    styles.wikiChip,
                                    {
                                      backgroundColor: theme.bgElevated,
                                      borderColor: theme.borderMedium,
                                    },
                                  ]}
                                  onPress={() => {
                                    Linking.openURL(url).catch(() =>
                                      showToast('Could not open URL')
                                    );
                                  }}
                                >
                                  <SolarIcon
                                    name="solar:link-linear"
                                    size={13}
                                    color={theme.textSecondary}
                                  />
                                  <Text
                                    style={{
                                      color: theme.textSecondary,
                                      fontSize: 11.5,
                                      fontWeight: '600',
                                    }}
                                    numberOfLines={1}
                                  >
                                    {url.replace(/^https?:\/\//i, '')}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })()
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* ================================================================
              EXPANDABLE TOOL SUB-PANELS (Color Picker, Wiki Link, Web URL, Math)
             ================================================================ */}
          {activeToolPanel !== 'none' && (
            <View
              style={[
                styles.toolPopoverDrawer,
                {
                  backgroundColor: theme.bgElevated,
                  borderTopColor: theme.borderMedium,
                },
              ]}
            >
              {/* 1. TEXT & HIGHLIGHT COLOR PICKER PANEL */}
              {activeToolPanel === 'color' && (
                <View style={{ gap: 10 }}>
                  <View style={styles.popoverHeaderRow}>
                    <Text
                      style={[
                        styles.popoverTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      Text & Highlight Color
                    </Text>
                    <TouchableOpacity
                      onPress={() => setActiveToolPanel('none')}
                    >
                      <SolarIcon
                        name="solar:close-circle-linear"
                        size={18}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.colorRowWrap}>
                    <Text
                      style={[styles.colorRowLabel, { color: theme.textMuted }]}
                    >
                      Text
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="always"
                      contentContainerStyle={styles.colorSwatchesScroll}
                    >
                      {TEXT_COLOR_SWATCHES.map((sw) => {
                        const selected = focusedBlock?.textColor === sw.value;
                        return (
                          <TouchableOpacity
                            key={`tc-${sw.label}`}
                            style={[
                              styles.colorSwatchCircle,
                              {
                                backgroundColor: sw.preview,
                                borderColor: selected
                                  ? '#ffffff'
                                  : theme.borderSubtle,
                                borderWidth: selected ? 2.5 : 1,
                              },
                            ]}
                            onPress={() => {
                              if (!focusedBlock) return;
                              hapticLight();
                              handleUpdateBlock(focusedBlock.id, {
                                textColor: sw.value,
                              });
                            }}
                          />
                        );
                      })}
                    </ScrollView>
                  </View>

                  <View style={styles.colorRowWrap}>
                    <Text
                      style={[styles.colorRowLabel, { color: theme.textMuted }]}
                    >
                      Highlight
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="always"
                      contentContainerStyle={styles.colorSwatchesScroll}
                    >
                      {HIGHLIGHT_COLOR_SWATCHES.map((sw) => {
                        const selected =
                          focusedBlock?.highlightColor === sw.value;
                        return (
                          <TouchableOpacity
                            key={`hc-${sw.label}`}
                            style={[
                              styles.colorSwatchCircle,
                              {
                                backgroundColor:
                                  sw.preview === 'transparent'
                                    ? theme.bgSurface
                                    : sw.preview,
                                borderColor: selected
                                  ? '#ffffff'
                                  : theme.borderSubtle,
                                borderWidth: selected ? 2.5 : 1,
                              },
                            ]}
                            onPress={() => {
                              if (!focusedBlock) return;
                              hapticLight();
                              handleUpdateBlock(focusedBlock.id, {
                                highlightColor: sw.value,
                              });
                            }}
                          >
                            {sw.preview === 'transparent' && (
                              <SolarIcon
                                name="solar:close-circle-linear"
                                size={14}
                                color={theme.textMuted}
                              />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              )}

              {/* 2. INTERNAL NOTE LINK ([[Wiki-Link]]) PANEL */}
              {activeToolPanel === 'wikilink' && (
                <View style={{ gap: 8 }}>
                  <View style={styles.popoverHeaderRow}>
                    <Text
                      style={[
                        styles.popoverTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      Insert Internal Note Link [[...]]
                    </Text>
                    <TouchableOpacity
                      onPress={() => setActiveToolPanel('none')}
                    >
                      <SolarIcon
                        name="solar:close-circle-linear"
                        size={18}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    value={wikiSearchQuery}
                    onChangeText={setWikiSearchQuery}
                    placeholder="Filter or type note name to link..."
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.popoverInput,
                      {
                        backgroundColor: theme.bgSurface,
                        color: theme.textPrimary,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{ gap: 8 }}
                  >
                    {activeNotes
                      .filter(
                        (n) =>
                          n.id !== activeNote.id &&
                          (!wikiSearchQuery.trim() ||
                            n.title
                              .toLowerCase()
                              .includes(wikiSearchQuery.toLowerCase()))
                      )
                      .slice(0, 12)
                      .map((n) => (
                        <TouchableOpacity
                          key={n.id}
                          style={[
                            styles.dockPill,
                            {
                              backgroundColor: theme.accentSubtle,
                              borderColor: theme.accentBorder,
                              borderWidth: 1,
                            },
                          ]}
                          onPress={() => {
                            hapticLight();
                            handleAppendTextToFocusedBlock(`[[${n.title}]]`);
                            setWikiSearchQuery('');
                            setActiveToolPanel('none');
                          }}
                        >
                          <SolarIcon
                            name="solar:link-minimalistic-2-linear"
                            size={14}
                            color={theme.accent}
                          />
                          <Text
                            style={{
                              color: theme.accent,
                              fontSize: 12.5,
                              fontWeight: '700',
                            }}
                          >
                            {n.title}
                          </Text>
                        </TouchableOpacity>
                      ))}

                    {wikiSearchQuery.trim().length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.dockPill,
                          { backgroundColor: theme.accent },
                        ]}
                        onPress={() => {
                          hapticLight();
                          handleAppendTextToFocusedBlock(
                            `[[${wikiSearchQuery.trim()}]]`
                          );
                          setWikiSearchQuery('');
                          setActiveToolPanel('none');
                        }}
                      >
                        <SolarIcon
                          name="solar:add-circle-linear"
                          size={14}
                          color="#fff"
                        />
                        <Text
                          style={{
                            color: '#fff',
                            fontSize: 12.5,
                            fontWeight: '700',
                          }}
                        >
                          Link &quot;{wikiSearchQuery.trim()}&quot;
                        </Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                </View>
              )}

              {/* 3. WEB LINK INSERTER PANEL */}
              {activeToolPanel === 'weblink' && (
                <View style={{ gap: 8 }}>
                  <View style={styles.popoverHeaderRow}>
                    <Text
                      style={[
                        styles.popoverTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      Insert Web Link
                    </Text>
                    <TouchableOpacity
                      onPress={() => setActiveToolPanel('none')}
                    >
                      <SolarIcon
                        name="solar:close-circle-linear"
                        size={18}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={webLinkLabel}
                      onChangeText={setWebLinkLabel}
                      placeholder="Label (optional)"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.popoverInput,
                        {
                          flex: 0.9,
                          backgroundColor: theme.bgSurface,
                          color: theme.textPrimary,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    />
                    <TextInput
                      value={webLinkUrl}
                      onChangeText={setWebLinkUrl}
                      placeholder="https://example.com"
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="none"
                      keyboardType="url"
                      style={[
                        styles.popoverInput,
                        {
                          flex: 1.4,
                          backgroundColor: theme.bgSurface,
                          color: theme.textPrimary,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    />
                    <TouchableOpacity
                      style={[
                        styles.popoverActionBtn,
                        { backgroundColor: theme.accent },
                      ]}
                      onPress={() => {
                        const rawUrl = webLinkUrl.trim();
                        if (!rawUrl) return;
                        const normalizedUrl = /^https?:\/\//i.test(rawUrl)
                          ? rawUrl
                          : `https://${rawUrl}`;
                        const snippet = webLinkLabel.trim()
                          ? `${webLinkLabel.trim()} (${normalizedUrl})`
                          : normalizedUrl;
                        hapticLight();
                        handleAppendTextToFocusedBlock(snippet);
                        setWebLinkLabel('');
                        setWebLinkUrl('');
                        setActiveToolPanel('none');
                      }}
                    >
                      <Text
                        style={{
                          color: '#fff',
                          fontWeight: '700',
                          fontSize: 12.5,
                        }}
                      >
                        Insert
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* 4. MATH LATEX QUICK SYMBOLS PANEL */}
              {activeToolPanel === 'math' && (
                <View style={{ gap: 8 }}>
                  <View style={styles.popoverHeaderRow}>
                    <Text
                      style={[
                        styles.popoverTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      LaTeX Math Symbols
                    </Text>
                    <TouchableOpacity
                      onPress={() => setActiveToolPanel('none')}
                    >
                      <SolarIcon
                        name="solar:close-circle-linear"
                        size={18}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{ gap: 6 }}
                  >
                    {MATH_QUICK_SYMBOLS.map((sym) => (
                      <TouchableOpacity
                        key={sym.label}
                        style={[
                          styles.mathSymbolChip,
                          {
                            backgroundColor: theme.bgSurface,
                            borderColor: theme.borderSubtle,
                          },
                        ]}
                        onPress={() => {
                          hapticLight();
                          if (focusedBlock && focusedBlock.type === 'math') {
                            handleUpdateBlock(focusedBlock.id, {
                              content: `${focusedBlock.content}${sym.latex}`,
                            });
                          } else {
                            handleInsertBlockAfterFocused('math', sym.latex);
                          }
                        }}
                      >
                        <Text
                          style={{
                            color: theme.textPrimary,
                            fontSize: 13.5,
                            fontWeight: '700',
                          }}
                        >
                          {sym.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}

          {/* ================================================================
              2-TIER MOBILE RICH EDITOR TOOLBAR (Rises Above Keyboard!)
             ================================================================ */}
          <View
            style={[
              styles.mobileFormatDock,
              {
                backgroundColor: theme.bgSidebar,
                borderTopColor: theme.borderSubtle,
                paddingBottom: keyboardHeight > 0 ? 8 : bottomInset + 8,
              },
            ]}
          >
            {/* TIER 1: Block Types & Rich Inserts */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={styles.formatDockScroll}
            >
              {/* + New Block Below */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor: theme.accentSubtle,
                    borderColor: theme.accentBorder,
                    borderWidth: 1,
                  },
                ]}
                onPress={() => handleInsertBlockAfterFocused('paragraph')}
              >
                <SolarIcon
                  name="solar:add-circle-linear"
                  size={15}
                  color={theme.accent}
                />
                <Text style={[styles.dockPillText, { color: theme.accent }]}>
                  New Line
                </Text>
              </TouchableOpacity>

              {/* Paragraph */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'paragraph'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('paragraph')}
              >
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'paragraph'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  P
                </Text>
              </TouchableOpacity>

              {/* H1 */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'heading1'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('heading1')}
              >
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'heading1'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  H1
                </Text>
              </TouchableOpacity>

              {/* H2 */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'heading2'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('heading2')}
              >
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'heading2'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  H2
                </Text>
              </TouchableOpacity>

              {/* H3 */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'heading3'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('heading3')}
              >
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'heading3'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  H3
                </Text>
              </TouchableOpacity>

              {/* Bullet List */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'bulletList'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('bulletList')}
              >
                <SolarIcon
                  name="solar:list-linear"
                  size={15}
                  color={
                    focusedBlock?.type === 'bulletList'
                      ? '#fff'
                      : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'bulletList'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  Bullet
                </Text>
              </TouchableOpacity>

              {/* Numbered List */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'numberedList'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('numberedList')}
              >
                <SolarIcon
                  name="solar:list-heart-minimalistic-linear"
                  size={15}
                  color={
                    focusedBlock?.type === 'numberedList'
                      ? '#fff'
                      : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'numberedList'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  1. List
                </Text>
              </TouchableOpacity>

              {/* Checklist / Task */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'checklist'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('checklist')}
              >
                <SolarIcon
                  name="solar:checklist-minimalistic-linear"
                  size={15}
                  color={
                    focusedBlock?.type === 'checklist'
                      ? '#fff'
                      : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'checklist'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  Task
                </Text>
              </TouchableOpacity>

              {/* Quote */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      focusedBlock?.type === 'quote'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetOrInsertBlockType('quote')}
              >
                <SolarIcon
                  name="solar:quote-up-square-linear"
                  size={15}
                  color={
                    focusedBlock?.type === 'quote' ? '#fff' : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        focusedBlock?.type === 'quote'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  Quote
                </Text>
              </TouchableOpacity>

              {/* Code Block */}
              <TouchableOpacity
                style={[styles.dockPill, { backgroundColor: theme.bgSurface }]}
                onPress={() => handleSetOrInsertBlockType('code')}
              >
                <SolarIcon
                  name="solar:code-square-linear"
                  size={15}
                  color={theme.accent}
                />
                <Text style={[styles.dockPillText, { color: theme.textPrimary }]}>
                  Code
                </Text>
              </TouchableOpacity>

              {/* Math Formula (LaTeX) */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      activeToolPanel === 'math'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  if (focusedBlock?.type !== 'math') {
                    handleInsertBlockAfterFocused('math');
                  }
                  setActiveToolPanel((p) => (p === 'math' ? 'none' : 'math'));
                }}
              >
                <SolarIcon
                  name="solar:calculator-minimalistic-linear"
                  size={15}
                  color={
                    activeToolPanel === 'math' ? '#fff' : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        activeToolPanel === 'math' ? '#fff' : theme.textPrimary,
                    },
                  ]}
                >
                  Math
                </Text>
              </TouchableOpacity>

              {/* [[Wiki Note Link]] */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      activeToolPanel === 'wikilink'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  setActiveToolPanel((p) =>
                    p === 'wikilink' ? 'none' : 'wikilink'
                  );
                }}
              >
                <SolarIcon
                  name="solar:link-minimalistic-2-linear"
                  size={15}
                  color={
                    activeToolPanel === 'wikilink' ? '#fff' : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        activeToolPanel === 'wikilink'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  [[Note]]
                </Text>
              </TouchableOpacity>

              {/* Web URL Link */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      activeToolPanel === 'weblink'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  setActiveToolPanel((p) =>
                    p === 'weblink' ? 'none' : 'weblink'
                  );
                }}
              >
                <SolarIcon
                  name="solar:link-linear"
                  size={15}
                  color={
                    activeToolPanel === 'weblink' ? '#fff' : theme.textPrimary
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        activeToolPanel === 'weblink'
                          ? '#fff'
                          : theme.textPrimary,
                    },
                  ]}
                >
                  Link
                </Text>
              </TouchableOpacity>

              {/* Divider */}
              <TouchableOpacity
                style={[styles.dockPill, { backgroundColor: theme.bgSurface }]}
                onPress={() => handleSetOrInsertBlockType('divider')}
              >
                <SolarIcon
                  name="solar:minus-square-linear"
                  size={15}
                  color={theme.textPrimary}
                />
                <Text style={[styles.dockPillText, { color: theme.textPrimary }]}>
                  Divider
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* TIER 2: Inline Text Styling, Color Palette, Alignment & Block Controls */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={[
                styles.formatDockScroll,
                { marginTop: 8 },
              ]}
            >
              {/* Bold */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor: focusedBlock?.bold
                      ? theme.accent
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => handleToggleInlineStyle('bold')}
              >
                <SolarIcon
                  name="solar:text-bold-linear"
                  size={16}
                  color={focusedBlock?.bold ? '#fff' : theme.textPrimary}
                />
              </TouchableOpacity>

              {/* Italic */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor: focusedBlock?.italic
                      ? theme.accent
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => handleToggleInlineStyle('italic')}
              >
                <SolarIcon
                  name="solar:text-italic-linear"
                  size={16}
                  color={focusedBlock?.italic ? '#fff' : theme.textPrimary}
                />
              </TouchableOpacity>

              {/* Underline */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor: focusedBlock?.underline
                      ? theme.accent
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => handleToggleInlineStyle('underline')}
              >
                <SolarIcon
                  name="solar:text-underline-linear"
                  size={16}
                  color={focusedBlock?.underline ? '#fff' : theme.textPrimary}
                />
              </TouchableOpacity>

              {/* Strikethrough */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor: focusedBlock?.strikethrough
                      ? theme.accent
                      : theme.bgSurface,
                  },
                ]}
                onPress={() => handleToggleInlineStyle('strikethrough')}
              >
                <SolarIcon
                  name="solar:text-cross-linear"
                  size={16}
                  color={
                    focusedBlock?.strikethrough ? '#fff' : theme.textPrimary
                  }
                />
              </TouchableOpacity>

              {/* Color & Highlight Picker Trigger */}
              <TouchableOpacity
                style={[
                  styles.dockPill,
                  {
                    backgroundColor:
                      activeToolPanel === 'color'
                        ? theme.accent
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => {
                  hapticLight();
                  setActiveToolPanel((p) => (p === 'color' ? 'none' : 'color'));
                }}
              >
                <SolarIcon
                  name="solar:paint-roller-linear"
                  size={15}
                  color={
                    activeToolPanel === 'color'
                      ? '#fff'
                      : focusedBlock?.textColor || theme.accent
                  }
                />
                <Text
                  style={[
                    styles.dockPillText,
                    {
                      color:
                        activeToolPanel === 'color' ? '#fff' : theme.textPrimary,
                    },
                  ]}
                >
                  Color
                </Text>
              </TouchableOpacity>

              <View
                style={[
                  styles.dockSeparator,
                  { backgroundColor: theme.borderSubtle },
                ]}
              />

              {/* Align Left */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor:
                      !focusedBlock?.align || focusedBlock?.align === 'left'
                        ? theme.accentSubtle
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetAlignment('left')}
              >
                <SolarIcon
                  name="lucide:align-left"
                  size={16}
                  color={
                    !focusedBlock?.align || focusedBlock?.align === 'left'
                      ? theme.accent
                      : theme.textSecondary
                  }
                />
              </TouchableOpacity>

              {/* Align Center */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor:
                      focusedBlock?.align === 'center'
                        ? theme.accentSubtle
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetAlignment('center')}
              >
                <SolarIcon
                  name="lucide:align-center"
                  size={16}
                  color={
                    focusedBlock?.align === 'center'
                      ? theme.accent
                      : theme.textSecondary
                  }
                />
              </TouchableOpacity>

              {/* Align Right */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  {
                    backgroundColor:
                      focusedBlock?.align === 'right'
                        ? theme.accentSubtle
                        : theme.bgSurface,
                  },
                ]}
                onPress={() => handleSetAlignment('right')}
              >
                <SolarIcon
                  name="lucide:align-right"
                  size={16}
                  color={
                    focusedBlock?.align === 'right'
                      ? theme.accent
                      : theme.textSecondary
                  }
                />
              </TouchableOpacity>

              <View
                style={[
                  styles.dockSeparator,
                  { backgroundColor: theme.borderSubtle },
                ]}
              />

              {/* Move Block Up */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  { backgroundColor: theme.bgSurface },
                ]}
                onPress={() => handleMoveFocusedBlock(-1)}
              >
                <SolarIcon
                  name="solar:arrow-up-linear"
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Move Block Down */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  { backgroundColor: theme.bgSurface },
                ]}
                onPress={() => handleMoveFocusedBlock(1)}
              >
                <SolarIcon
                  name="solar:arrow-down-linear"
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Duplicate Focused Block */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  { backgroundColor: theme.bgSurface },
                ]}
                onPress={handleDuplicateFocusedBlock}
              >
                <SolarIcon
                  name="solar:copy-linear"
                  size={16}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>

              {/* Delete Focused Block */}
              <TouchableOpacity
                style={[
                  styles.dockIconBtn,
                  { backgroundColor: theme.dangerSubtle },
                ]}
                onPress={() => {
                  if (focusedBlock) handleDeleteBlock(focusedBlock.id);
                }}
              >
                <SolarIcon
                  name="solar:trash-bin-trash-linear"
                  size={16}
                  color={theme.danger}
                />
              </TouchableOpacity>

              {/* Dismiss Keyboard Button (Shown when keyboard is open) */}
              {keyboardHeight > 0 && (
                <TouchableOpacity
                  style={[
                    styles.dockPill,
                    { backgroundColor: theme.bgElevated },
                  ]}
                  onPress={() => {
                    hapticLight();
                    Keyboard.dismiss();
                  }}
                >
                  <SolarIcon
                    name="solar:keyboard-linear"
                    size={15}
                    color={theme.textPrimary}
                  />
                  <SolarIcon
                    name="solar:alt-arrow-down-linear"
                    size={14}
                    color={theme.textPrimary}
                  />
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      ) : (
        /* ====================================================================
           MAIN MOBILE SCREENS + FLOATING BOTTOM NAVIGATION BAR
           ==================================================================== */
        <View style={{ flex: 1 }}>
          {/* 1. NOTES TAB (DEFAULT HOME SCREEN) */}
          {activeTab === 'notes' && (
            <View style={{ flex: 1, paddingTop: topInset + 10 }}>
              {/* Native Mobile Large Title Bar with Official Nosh Desktop Logo */}
              <View style={styles.mobileLargeHeader}>
                <View style={styles.headerBrandGroup}>
                  <View style={styles.brandRow}>
                    <Image
                      source={require('./assets/icon.png')}
                      style={styles.mobileLogoImage}
                    />
                    <Text
                      style={[
                        styles.mobileLargeTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      nosh
                    </Text>
                    <View
                      style={[
                        styles.versionBadge,
                        {
                          backgroundColor: theme.bgElevated,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: theme.textMuted,
                          fontSize: 10.5,
                          fontWeight: '700',
                        }}
                      >
                        v1.4
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.mobileHeaderSub,
                      { color: theme.textMuted },
                    ]}
                  >
                    {activeNotes.length} notes · Encrypted local vault
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.syncHeaderPill,
                    {
                      backgroundColor:
                        syncStatus === 'connected'
                          ? theme.successSubtle
                          : theme.bgSurface,
                      borderColor:
                        syncStatus === 'connected'
                          ? theme.success
                          : theme.borderSubtle,
                    },
                  ]}
                  onPress={() => {
                    hapticLight();
                    setQrModalOpen(true);
                  }}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.syncPillDot,
                      {
                        backgroundColor:
                          syncStatus === 'connected'
                            ? theme.success
                            : theme.accent,
                      },
                    ]}
                  />
                  <SolarIcon
                    name="solar:qr-code-linear"
                    size={15}
                    color={
                      syncStatus === 'connected'
                        ? theme.success
                        : theme.textPrimary
                    }
                  />
                  <Text
                    style={[
                      styles.syncPillText,
                      {
                        color:
                          syncStatus === 'connected'
                            ? theme.success
                            : theme.textPrimary,
                      },
                    ]}
                  >
                    {syncStatus === 'connected' ? 'Synced' : 'QR Sync'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Rounded Mobile Search Capsule */}
              <View style={styles.searchCapsuleWrap}>
                <View
                  style={[
                    styles.searchCapsule,
                    {
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  <SolarIcon
                    name="solar:magnifer-linear"
                    size={18}
                    color={theme.textMuted}
                  />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search notes or code..."
                    placeholderTextColor={theme.textMuted}
                    style={[
                      styles.searchCapsuleInput,
                      { color: theme.textPrimary },
                    ]}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <SolarIcon
                        name="solar:close-circle-bold"
                        size={18}
                        color={theme.textMuted}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Horizontal Filter Pills (No Tag Chips) */}
              <View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterChipsScroll}
                >
                  {(
                    [
                      {
                        id: 'all',
                        label: 'All Notes',
                        icon: 'solar:notes-linear' as SolarIconName,
                      },
                      {
                        id: 'pinned',
                        label: 'Pinned',
                        icon: 'solar:pin-linear' as SolarIconName,
                      },
                      {
                        id: 'code',
                        label: 'Code',
                        icon: 'solar:code-square-linear' as SolarIconName,
                      },
                      {
                        id: 'tasks',
                        label: 'Tasks',
                        icon: 'solar:checklist-minimalistic-linear' as SolarIconName,
                      },
                    ] as const
                  ).map((f) => {
                    const active = selectedFilter === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: active
                              ? theme.accent
                              : theme.bgSurface,
                            borderColor: active
                              ? theme.accent
                              : theme.borderSubtle,
                          },
                        ]}
                        onPress={() => {
                          hapticLight();
                          setSelectedFilter(f.id);
                        }}
                        activeOpacity={0.8}
                      >
                        <SolarIcon
                          name={f.icon}
                          size={14}
                          color={active ? '#fff' : theme.textSecondary}
                        />
                        <Text
                          style={[
                            styles.filterChipText,
                            { color: active ? '#fff' : theme.textSecondary },
                          ]}
                        >
                          {f.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Mobile Notes Card List */}
              <ScrollView
                contentContainerStyle={styles.notesFeedScroll}
                showsVerticalScrollIndicator={false}
              >
                {filteredNotes.map(renderMobileNoteCard)}

                {filteredNotes.length === 0 && (
                  <View style={styles.emptyFeedBox}>
                    <View
                      style={[
                        styles.emptyIconCircle,
                        { backgroundColor: theme.bgSurface },
                      ]}
                    >
                      <SolarIcon
                        name="solar:notes-linear"
                        size={32}
                        color={theme.textMuted}
                      />
                    </View>
                    <Text
                      style={[
                        styles.emptyFeedTitle,
                        { color: theme.textPrimary },
                      ]}
                    >
                      No matching notes
                    </Text>
                    <Text
                      style={[
                        styles.emptyFeedSub,
                        { color: theme.textMuted },
                      ]}
                    >
                      Tap the + button below to create a new note or scan a QR code from Nosh Desktop.
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          )}

          {/* 2. GRAPH / LINKS TAB */}
          {activeTab === 'graph' && (
            <ScrollView
              style={{ flex: 1, paddingTop: topInset + 10 }}
              contentContainerStyle={styles.tabScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.mobileLargeHeader}>
                <View>
                  <Text
                    style={[
                      styles.mobileLargeTitle,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Knowledge Graph
                  </Text>
                  <Text
                    style={[
                      styles.mobileHeaderSub,
                      { color: theme.textMuted },
                    ]}
                  >
                    Connected [[Wiki-Links]] across your vault
                  </Text>
                </View>
              </View>

              <View style={styles.graphCardsWrap}>
                {activeNotes.map((note) => {
                  const links = extractWikiLinksFromBlocks(note.blocks);
                  return (
                    <TouchableOpacity
                      key={note.id}
                      style={[
                        styles.graphNodeCard,
                        {
                          backgroundColor: theme.bgSurface,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                      activeOpacity={0.8}
                      onPress={() => handleOpenNote(note.id)}
                    >
                      <View style={styles.graphNodeHeader}>
                        <View
                          style={[
                            styles.graphNodeIcon,
                            { backgroundColor: theme.accentSubtle },
                          ]}
                        >
                          <SolarIcon
                            name="solar:pie-chart-2-linear"
                            size={18}
                            color={theme.accent}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.graphNodeTitle,
                              { color: theme.textPrimary },
                            ]}
                          >
                            {note.title}
                          </Text>
                          <Text
                            style={{ color: theme.textMuted, fontSize: 12 }}
                          >
                            {links.length} outgoing link
                            {links.length === 1 ? '' : 's'}
                          </Text>
                        </View>
                        <SolarIcon
                          name="solar:alt-arrow-right-linear"
                          size={18}
                          color={theme.textMuted}
                        />
                      </View>

                      {links.length > 0 && (
                        <View style={styles.wikiChipsRow}>
                          {links.map((target) => (
                            <TouchableOpacity
                              key={target}
                              style={[
                                styles.wikiChip,
                                {
                                  backgroundColor: theme.accentSubtle,
                                  borderColor: theme.accentBorder,
                                },
                              ]}
                              onPress={() =>
                                handleJumpOrCreateWikiLink(target)
                              }
                            >
                              <SolarIcon
                                name="solar:link-circle-linear"
                                size={14}
                                color={theme.accent}
                              />
                              <Text
                                style={{
                                  color: theme.accent,
                                  fontSize: 12,
                                  fontWeight: '700',
                                }}
                              >
                                {target}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* 3. SETTINGS TAB */}
          {activeTab === 'settings' && (
            <ScrollView
              style={{ flex: 1, paddingTop: topInset + 10 }}
              contentContainerStyle={styles.tabScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.mobileLargeHeader}>
                <View>
                  <Text
                    style={[
                      styles.mobileLargeTitle,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Settings
                  </Text>
                  <Text
                    style={[
                      styles.mobileHeaderSub,
                      { color: theme.textMuted },
                    ]}
                  >
                    Appearance, editor preferences & trash recovery
                  </Text>
                </View>
              </View>

              <View style={styles.settingsCardsWrap}>
                {/* Theme Card */}
                <View
                  style={[
                    styles.settingsCard,
                    {
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsSectionTitle,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Theme
                  </Text>
                  <View style={styles.themeSelectorRow}>
                    <TouchableOpacity
                      style={[
                        styles.themeOptionCard,
                        {
                          backgroundColor:
                            themeMode === 'dark'
                              ? theme.accentSubtle
                              : theme.bgElevated,
                          borderColor:
                            themeMode === 'dark'
                              ? theme.accent
                              : theme.borderSubtle,
                        },
                      ]}
                      onPress={() => {
                        hapticLight();
                        setThemeMode('dark');
                        saveAppSettings({
                          theme: 'dark',
                          peerId: selfPeer.peerId,
                          peerAlias: 'Mobile',
                          fontSize: editorFontSize,
                          autoSyncOnEdit,
                        });
                      }}
                    >
                      <SolarIcon
                        name="solar:moon-linear"
                        size={18}
                        color={
                          themeMode === 'dark'
                            ? theme.accent
                            : theme.textSecondary
                        }
                      />
                      <Text
                        style={{
                          color: theme.textPrimary,
                          fontWeight: '700',
                          fontSize: 13.5,
                        }}
                      >
                        Nosh Dark
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                        #0d0f12
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.themeOptionCard,
                        {
                          backgroundColor:
                            themeMode === 'oled'
                              ? theme.accentSubtle
                              : theme.bgElevated,
                          borderColor:
                            themeMode === 'oled'
                              ? theme.accent
                              : theme.borderSubtle,
                        },
                      ]}
                      onPress={() => {
                        hapticLight();
                        setThemeMode('oled');
                        saveAppSettings({
                          theme: 'oled',
                          peerId: selfPeer.peerId,
                          peerAlias: 'Mobile',
                          fontSize: editorFontSize,
                          autoSyncOnEdit,
                        });
                      }}
                    >
                      <SolarIcon
                        name="solar:sun-2-linear"
                        size={18}
                        color={
                          themeMode === 'oled'
                            ? theme.accent
                            : theme.textSecondary
                        }
                      />
                      <Text
                        style={{
                          color: theme.textPrimary,
                          fontWeight: '700',
                          fontSize: 13.5,
                        }}
                      >
                        OLED Black
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                        #000000
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Editor Preferences */}
                <View
                  style={[
                    styles.settingsCard,
                    {
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsSectionTitle,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Editor Font Size
                  </Text>
                  <View style={styles.fontSizeRow}>
                    {[14, 16, 18].map((sz) => (
                      <TouchableOpacity
                        key={sz}
                        style={[
                          styles.fontSizePill,
                          {
                            backgroundColor:
                              editorFontSize === sz
                                ? theme.accent
                                : theme.bgElevated,
                          },
                        ]}
                        onPress={() => {
                          hapticLight();
                          setEditorFontSize(sz);
                          saveAppSettings({
                            theme: themeMode,
                            peerId: selfPeer.peerId,
                            peerAlias: 'Mobile',
                            fontSize: sz,
                            autoSyncOnEdit,
                          });
                        }}
                      >
                        <Text
                          style={{
                            color:
                              editorFontSize === sz
                                ? '#fff'
                                : theme.textSecondary,
                            fontWeight: '700',
                            fontSize: 13,
                          }}
                        >
                          {sz}px
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: theme.textPrimary,
                          fontSize: 14,
                          fontWeight: '600',
                        }}
                      >
                        Real-Time E2EE Broadcast
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        Automatically sync edits when paired via QR code
                      </Text>
                    </View>
                    <Switch
                      value={autoSyncOnEdit}
                      onValueChange={(v) => {
                        setAutoSyncOnEdit(v);
                        saveAppSettings({
                          theme: themeMode,
                          peerId: selfPeer.peerId,
                          peerAlias: 'Mobile',
                          fontSize: editorFontSize,
                          autoSyncOnEdit: v,
                        });
                      }}
                      trackColor={{
                        false: theme.bgElevated,
                        true: theme.accent,
                      }}
                    />
                  </View>
                </View>

                {/* Trash Section */}
                <View
                  style={[
                    styles.settingsCard,
                    {
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.borderSubtle,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.settingsSectionTitle,
                      { color: theme.textPrimary },
                    ]}
                  >
                    Trash ({notes.filter((n) => n.trashed).length})
                  </Text>
                  {notes.filter((n) => n.trashed).length === 0 ? (
                    <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                      Trash is empty.
                    </Text>
                  ) : (
                    notes
                      .filter((n) => n.trashed)
                      .map((trashedNote) => (
                        <View key={trashedNote.id} style={styles.trashItemRow}>
                          <Text
                            style={{
                              color: theme.textPrimary,
                              fontSize: 14,
                              fontWeight: '600',
                              flex: 1,
                            }}
                            numberOfLines={1}
                          >
                            {trashedNote.title}
                          </Text>
                          <TouchableOpacity
                            style={[
                              styles.restorePill,
                              { backgroundColor: theme.successSubtle },
                            ]}
                            onPress={() => {
                              hapticLight();
                              updateNoteById(trashedNote.id, (n) => ({
                                ...n,
                                trashed: false,
                              }));
                              showToast(`Restored "${trashedNote.title}"`);
                            }}
                          >
                            <Text
                              style={{
                                color: theme.success,
                                fontSize: 12,
                                fontWeight: '700',
                              }}
                            >
                              Restore
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))
                  )}
                </View>
              </View>
            </ScrollView>
          )}

          {/* ==================================================================
              NATIVE MOBILE BOTTOM NAVIGATION BAR (With Solar Icons & + FAB)
             ================================================================== */}
          <View
            style={[
              styles.bottomTabBar,
              {
                backgroundColor: theme.bgSidebar,
                borderTopColor: theme.borderSubtle,
                paddingBottom: bottomInset + 6,
              },
            ]}
          >
            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => {
                hapticLight();
                setActiveTab('notes');
              }}
              activeOpacity={0.75}
            >
              <SolarIcon
                name={
                  activeTab === 'notes'
                    ? 'solar:notes-bold'
                    : 'solar:notes-linear'
                }
                size={21}
                color={
                  activeTab === 'notes' ? theme.accent : theme.textMuted
                }
              />
              <Text
                style={[
                  styles.tabItemLabel,
                  {
                    color:
                      activeTab === 'notes' ? theme.accent : theme.textMuted,
                  },
                ]}
              >
                Notes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => {
                hapticLight();
                setActiveTab('graph');
              }}
              activeOpacity={0.75}
            >
              <SolarIcon
                name={
                  activeTab === 'graph'
                    ? 'solar:pie-chart-2-bold'
                    : 'solar:pie-chart-2-linear'
                }
                size={21}
                color={
                  activeTab === 'graph' ? theme.accent : theme.textMuted
                }
              />
              <Text
                style={[
                  styles.tabItemLabel,
                  {
                    color:
                      activeTab === 'graph' ? theme.accent : theme.textMuted,
                  },
                ]}
              >
                Graph
              </Text>
            </TouchableOpacity>

            {/* Center Elevated + Action Button (Matches Desktop solar:document-add-linear) */}
            <View style={styles.centerFabWrap}>
              <TouchableOpacity
                style={[
                  styles.centerFabBtn,
                  { backgroundColor: theme.accent },
                ]}
                onPress={() => handleCreateNewNote('paragraph')}
                activeOpacity={0.85}
              >
                <SolarIcon
                  name="solar:document-add-linear"
                  size={24}
                  color="#ffffff"
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => {
                hapticLight();
                setQrModalOpen(true);
              }}
              activeOpacity={0.75}
            >
              <View style={{ position: 'relative' }}>
                <SolarIcon
                  name="solar:qr-code-linear"
                  size={21}
                  color={
                    syncStatus === 'connected'
                      ? theme.success
                      : theme.textMuted
                  }
                />
                {syncStatus === 'connected' && (
                  <View
                    style={[
                      styles.tabBadgeDot,
                      { backgroundColor: theme.success },
                    ]}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.tabItemLabel,
                  {
                    color:
                      syncStatus === 'connected'
                        ? theme.success
                        : theme.textMuted,
                  },
                ]}
              >
                QR Sync
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tabItem}
              onPress={() => {
                hapticLight();
                setActiveTab('settings');
              }}
              activeOpacity={0.75}
            >
              <SolarIcon
                name={
                  activeTab === 'settings'
                    ? 'solar:settings-bold'
                    : 'solar:settings-linear'
                }
                size={21}
                color={
                  activeTab === 'settings' ? theme.accent : theme.textMuted
                }
              />
              <Text
                style={[
                  styles.tabItemLabel,
                  {
                    color:
                      activeTab === 'settings' ? theme.accent : theme.textMuted,
                  },
                ]}
              >
                Settings
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* QR SYNC BOTTOM SHEET MODAL */}
      <QRScannerModal
        visible={qrModalOpen}
        theme={theme}
        activeSession={activeSession}
        activeNoteTitle={activeNote?.title}
        connectedCount={connectedPeers.length}
        syncStatus={syncStatus}
        onClose={() => setQrModalOpen(false)}
        onScanOrJoinSession={handleJoinQRSession}
        onCreateNewSession={handleCreateNewQRSession}
        onDisconnectSession={handleDisconnectQRSession}
        onTriggerManualSync={() => {
          syncEngineRef.current?.pullEncryptedMailbox('incremental', true).then(() => {
            syncEngineRef.current?.pushVaultSnapshot(false);
          });
          showToast('Synced notes with token vault');
        }}
      />

      {/* TOAST PILL */}
      {toastMsg ? (
        <View
          style={[
            styles.toastPill,
            {
              backgroundColor: theme.bgElevated,
              borderColor: theme.borderMedium,
              bottom: 84 + bottomInset,
            },
          ]}
        >
          <SolarIcon
            name="solar:check-circle-bold"
            size={16}
            color={theme.accent}
          />
          <Text style={[styles.toastText, { color: theme.textPrimary }]}>
            {toastMsg}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Mobile Large Header
  mobileLargeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerBrandGroup: {
    gap: 3,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  versionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 2,
  },
  mobileLargeTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  mobileHeaderSub: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  syncHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  syncPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  syncPillText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  // Search Capsule
  searchCapsuleWrap: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  searchCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
  },
  searchCapsuleInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  // Filter Chips
  filterChipsScroll: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Notes Feed
  notesFeedScroll: {
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 110,
    gap: 12,
  },
  noteCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  noteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteCardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  pinIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    flex: 1,
  },
  noteCardMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noteCardTime: {
    fontSize: 12,
    fontWeight: '500',
  },
  noteCardPreview: {
    fontSize: 14,
    lineHeight: 20,
  },
  noteCardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  cardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cardBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  emptyFeedBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyFeedTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  emptyFeedSub: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Full-Screen Mobile Editor
  editorNavHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  editorBackPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  editorBackText: {
    fontSize: 14,
    fontWeight: '700',
  },
  editorHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editorCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findInNoteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  findInNoteInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  editorScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 10,
  },
  mobileTitleInput: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    paddingVertical: 4,
  },
  editorMetaRow: {
    gap: 8,
    marginBottom: 6,
  },
  editorMetaText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  textBlockContainer: {
    marginVertical: 2,
  },
  textBlockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  listPrefixBullet: {
    fontWeight: '800',
    marginRight: 8,
    marginTop: 4,
  },
  listPrefixNumber: {
    fontWeight: '700',
    marginRight: 8,
    marginTop: 6,
    minWidth: 18,
  },
  blockTextInput: {
    flex: 1,
    lineHeight: 24,
    paddingVertical: 6,
  },
  h1Mobile: {
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 30,
    marginTop: 8,
  },
  h2Mobile: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
    marginTop: 6,
  },
  h3Mobile: {
    fontSize: 16.5,
    fontWeight: '700',
    lineHeight: 23,
    marginTop: 4,
  },
  deleteBlockBtn: {
    padding: 6,
    marginTop: 2,
  },
  checklistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginVertical: 3,
  },
  checkboxCircle: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistInput: {
    flex: 1,
    paddingVertical: 2,
  },
  mathBlockCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    marginVertical: 4,
  },
  mathHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mathBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mathInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingVertical: 4,
  },
  dividerWrap: {
    paddingVertical: 14,
  },
  dividerLine: {
    height: 1.5,
    width: '100%',
  },
  wikiChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  wikiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 260,
  },
  // Expandable Sub-Panel Drawer above Toolbar
  toolPopoverDrawer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  popoverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  popoverTitle: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  colorRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorRowLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    width: 58,
  },
  colorSwatchesScroll: {
    gap: 10,
    paddingVertical: 2,
  },
  colorSwatchCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13.5,
    paddingVertical: 0,
  },
  popoverActionBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mathSymbolChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  // 2-Tier Mobile Formatting Dock
  mobileFormatDock: {
    borderTopWidth: 1,
    paddingTop: 8,
  },
  formatDockScroll: {
    paddingHorizontal: 14,
    gap: 7,
    alignItems: 'center',
  },
  dockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  dockPillText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  dockIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockSeparator: {
    width: 1,
    height: 20,
    marginHorizontal: 2,
  },
  // Graph & Settings Tabs
  tabScrollContent: {
    paddingBottom: 110,
  },
  graphCardsWrap: {
    paddingHorizontal: 20,
    gap: 12,
  },
  graphNodeCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  graphNodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  graphNodeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  graphNodeTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  settingsCardsWrap: {
    paddingHorizontal: 20,
    gap: 14,
  },
  settingsCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  settingsSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  themeSelectorRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeOptionCard: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  fontSizeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fontSizePill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  trashItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  restorePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  // Native Mobile Bottom Tab Bar
  bottomTabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabItemLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabBadgeDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  centerFabWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  centerFabBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  // Toast Pill
  toastPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
