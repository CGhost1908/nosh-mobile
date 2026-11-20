export type BlockType =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bulletList'
  | 'numberedList'
  | 'code'
  | 'checklist'
  | 'quote'
  | 'divider'
  | 'math';

export interface NoteBlock {
  id: string;
  type: BlockType;
  content: string;
  language?: string; // For 'code' blocks (e.g., 'TypeScript', 'Python', 'Rust')
  checked?: boolean; // For 'checklist' blocks
  wrap?: boolean; // For 'code' blocks
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: 'left' | 'center' | 'right';
  textColor?: string;
  highlightColor?: string;
  listIndex?: number; // For 'numberedList' blocks
  updatedAt: number; // Lamport / timestamp for CRDT conflict resolution
  updatedBy: string; // Anonymous peerId that last modified this block
}

export interface NoshNote {
  id: string; // Stable UUID or slug
  title: string; // Note filename without .nsh
  blocks: NoteBlock[];
  rawNsh?: string; // Cached .nsh HTML representation for 100% Nosh Desktop parity
  folder?: string;
  tags: string[];
  pinned: boolean;
  trashed?: boolean;
  updatedAt: number;
  versionClock: number; // Monotonic Lamport clock for CRDT sync
}

export interface PeerIdentity {
  peerId: string; // e.g. 'anon-8f3a'
  alias: string; // e.g. 'Gece Tilkisi' or 'Anon #8F3A'
  color: string;
  deviceType: 'mobile' | 'desktop';
  activeNoteTitle?: string;
  activeBlockId?: string;
  lastSeen: number;
}

export interface QRSyncPayload {
  protocol: 'nosh-e2ee-v1';
  roomId: string;
  secretKey: string; // 256-bit hex key derived from authToken
  authToken?: string; // 32-char anonymous local authToken
  qrTransferKey?: string; // Ephemeral key used to encrypt authToken inside QR
  lanEndpoint?: string;
  mode: 'vault' | 'collab-note';
  targetNoteTitle?: string;
  hostAlias?: string;
}

export type SyncMessageType =
  | 'peer-hello'
  | 'peer-presence'
  | 'vault-request'
  | 'vault-snapshot'
  | 'note-crdt-op'
  | 'block-crdt-op';

export interface CRDTBlockOp {
  noteTitle: string;
  noteUpdatedAt: number;
  versionClock: number;
  opType: 'upsert-block' | 'delete-block' | 'replace-note';
  block?: NoteBlock;
  blockIndex?: number;
  blockId?: string;
  fullNote?: NoshNote;
  sender: PeerIdentity;
}

export interface EncryptedEnvelope {
  v: 1;
  roomId: string;
  senderId: string;
  type: SyncMessageType;
  iv: string;
  ciphertext: string; // E2EE encrypted JSON payload
  mac: string; // Integrity tag derived with secretKey
  ts: number;
}
