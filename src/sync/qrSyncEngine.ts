import {
  CRDTBlockOp,
  EncryptedEnvelope,
  NoshNote,
  PeerIdentity,
  QRSyncPayload,
  SyncMessageType,
} from '../types/note';
import {
  createSessionFromAuthToken,
  decryptPayloadE2EE,
  deriveNoteDbId,
  deriveVaultCredentials,
  encryptPayloadE2EE,
  generateRandomHex,
} from '../utils/cryptoE2EE';
import {
  extractTagsFromBlocks,
  parseNshToBlocks,
  serializeBlocksToNsh,
} from '../utils/nshFormat';

const SUPABASE_BASE_URL = 'https://buvtdaxlibejpjlkxaor.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1dnRkYXhsaWJlanBqbGt4YW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MjA2NTIsImV4cCI6MjEwOTA5NjY1Mn0.Kd2bR8gAm2lLGKHLhV1CJCacuLE1NKPptVmIJiKZnNY';
const RELAY_WS_URL = `${SUPABASE_BASE_URL.replace(
  'https://',
  'wss://'
)}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

export type SyncJoinStrategy = 'replace' | 'merge' | 'auto';

export interface VaultManifestItem {
  noteDbId: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  versionClock: number;
}

export function createDevicePeer(savedId?: string): PeerIdentity {
  const peerId = savedId || `mob-${generateRandomHex(4)}`;
  return {
    peerId,
    alias: 'Mobile',
    color: '#6366f1',
    deviceType: 'mobile',
    lastSeen: Date.now(),
  };
}

export function createNewRoomSession(
  mode: 'vault' | 'collab-note' = 'vault',
  targetNoteTitle?: string
): QRSyncPayload {
  const session = createSessionFromAuthToken(generateRandomHex(16));
  return {
    ...session,
    mode,
    targetNoteTitle,
  };
}

export interface QRSyncEngineCallbacks {
  onStatusChange: (status: 'disconnected' | 'connecting' | 'connected' | 'syncing') => void;
  onPeersUpdated: (peers: PeerIdentity[]) => void;
  onVaultSnapshotReceived: (
    notes: NoshNote[],
    senderPeer: PeerIdentity,
    mode: 'replace' | 'merge' | 'incremental',
    manifestTitles?: string[]
  ) => void;
  onCRDTBlockOpReceived: (op: CRDTBlockOp) => void;
  getCurrentVaultNotes: () => NoshNote[];
}

export class AnonymousQRSyncEngine {
  private ws: WebSocket | null = null;
  private session: QRSyncPayload | null = null;
  private selfPeer: PeerIdentity;
  private callbacks: QRSyncEngineCallbacks;
  private peersMap = new Map<string, PeerIdentity>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refCounter = 1;
  private lastMailboxTs = 0;
  private syncedNoteTimestamps = new Map<string, number>();
  private initialHandshakeCompleted = false;
  private isPushing = false;

  constructor(selfPeer: PeerIdentity, callbacks: QRSyncEngineCallbacks) {
    this.selfPeer = selfPeer;
    this.callbacks = callbacks;
  }

  public getSession(): QRSyncPayload | null {
    return this.session;
  }

  private getCredentials() {
    const rawToken = this.session?.authToken || this.session?.secretKey || '';
    return deriveVaultCredentials(rawToken);
  }

  public connectToSession(
    session: QRSyncPayload,
    joinStrategy: SyncJoinStrategy = 'auto'
  ): void {
    this.disconnect();
    const creds = deriveVaultCredentials(session.authToken || session.secretKey);
    this.session = {
      ...session,
      authToken: creds.authToken,
      roomId: creds.vaultDbId,
      secretKey: creds.vaultEncKey,
    };
    this.lastMailboxTs = 0;
    this.syncedNoteTimestamps.clear();
    this.initialHandshakeCompleted = false;
    this.callbacks.onStatusChange('connecting');

    const pullMode =
      joinStrategy === 'replace'
        ? 'replace'
        : joinStrategy === 'merge'
        ? 'merge'
        : 'incremental';

    // 1. Pull remote vault from Supabase according to user's chosen strategy
    this.pullEncryptedMailbox(pullMode, true).then((foundInDb) => {
      this.initialHandshakeCompleted = true;
      this.callbacks.onStatusChange('connected');

      if (joinStrategy === 'merge' || (!foundInDb && joinStrategy !== 'replace')) {
        // Upload merged notes (or initial notes if DB was empty) to Supabase
        setTimeout(() => {
          this.pushVaultSnapshot(true);
        }, 120);
      }
    });

    // 2. Poll database every 4s for incremental cross-device updates
    this.pollTimer = setInterval(() => {
      if (this.initialHandshakeCompleted) {
        this.pullEncryptedMailbox('incremental', false);
      }
    }, 4000);

    // 3. Open Realtime WebSocket on vaultDbId for instant notifications
    try {
      const ws = new WebSocket(RELAY_WS_URL);
      this.ws = ws;
      const channelTopic = `realtime:nosh-e2ee-${creds.vaultDbId}`;

      ws.onopen = () => {
        this.sendPhoenixFrame(channelTopic, 'phx_join', {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
          },
        });

        this.callbacks.onStatusChange('connected');
        this.broadcastEncrypted('peer-hello', this.selfPeer);

        this.heartbeatTimer = setInterval(() => {
          this.sendPhoenixFrame('phoenix', 'heartbeat', {});
          this.broadcastEncrypted('peer-presence', {
            ...this.selfPeer,
            lastSeen: Date.now(),
          });
          this.pruneStalePeers();
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.event === 'broadcast' && msg.payload?.payload) {
            const envelope = msg.payload.payload as EncryptedEnvelope;
            this.handleIncomingEnvelope(envelope);
          }
        } catch {
          // Ignore malformed relay frames
        }
      };

      ws.onerror = () => {
        // Keep status connected if HTTPS database polling is active
      };
    } catch {
      // WebSocket optional fallback; HTTPS database handles sync
    }
  }

  public disconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
    this.peersMap.clear();
    this.lastMailboxTs = 0;
    this.initialHandshakeCompleted = false;
    this.callbacks.onPeersUpdated([]);
    this.callbacks.onStatusChange('disconnected');
  }

  private async upsertEncryptedRow(
    rowId: string,
    writeToken: string,
    titleLabel: string,
    envelope: EncryptedEnvelope
  ): Promise<boolean> {
    const contentStr = JSON.stringify(envelope);
    if (contentStr.length > 1990000) return false;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      const updRes = await fetch(
        `${SUPABASE_BASE_URL}/rest/v1/rpc/update_shared_note`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_id: rowId,
            p_edit_token: writeToken,
            p_title: titleLabel,
            p_content: contentStr,
          }),
        }
      );
      const updated = updRes.ok ? await updRes.json() : false;
      if (!updated) {
        const pubRes = await fetch(
          `${SUPABASE_BASE_URL}/rest/v1/rpc/publish_shared_note`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              p_id: rowId,
              p_title: titleLabel,
              p_content: contentStr,
              p_edit_token: writeToken,
            }),
          }
        );
        return pubRes.ok;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async fetchEncryptedRowsByIds(
    rowIds: string[]
  ): Promise<{ id: string; content: string }[]> {
    if (!rowIds.length) return [];
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
    const results: { id: string; content: string }[] = [];
    const batchSize = 15;

    for (let i = 0; i < rowIds.length; i += batchSize) {
      const slice = rowIds.slice(i, i + batchSize);
      const inList = slice.map((id) => encodeURIComponent(id)).join(',');
      try {
        const res = await fetch(
          `${SUPABASE_BASE_URL}/rest/v1/shared_notes?id=in.(${inList})&select=id,content`,
          { headers }
        );
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows)) {
            results.push(...rows);
          }
        }
      } catch {}
    }
    return results;
  }

  public async pullEncryptedMailbox(
    mode: 'replace' | 'merge' | 'incremental' = 'incremental',
    forcePull = false
  ): Promise<boolean> {
    if (!this.session) return false;
    const creds = this.getCredentials();

    try {
      const manifestRows = await this.fetchEncryptedRowsByIds([creds.vaultDbId]);
      if (!manifestRows.length || !manifestRows[0].content) {
        return false;
      }

      const envelope = JSON.parse(manifestRows[0].content) as EncryptedEnvelope;
      if (!envelope) return false;

      this.callbacks.onStatusChange('connected');

      if (!forcePull && mode === 'incremental') {
        if (envelope.senderId === this.selfPeer.peerId) {
          return true;
        }
        if (envelope.ts && envelope.ts <= this.lastMailboxTs) {
          return true;
        }
      }

      const decrypted = decryptPayloadE2EE<{
        v?: number;
        peer?: PeerIdentity;
        manifest?: VaultManifestItem[];
        notes?: NoshNote[];
      }>(envelope, creds.vaultEncKey);

      if (!decrypted) return false;
      this.lastMailboxTs = envelope.ts || Date.now();

      if (decrypted.peer) {
        this.registerPeer(decrypted.peer);
      }

      // Per-Note Manifest Protocol (v2)
      if (Array.isArray(decrypted.manifest)) {
        const localNotes = this.callbacks.getCurrentVaultNotes().filter((n) => !n.trashed);
        const localByTitle = new Map(localNotes.map((n) => [n.title, n]));

        const noteIdsToFetch: string[] = [];
        for (const item of decrypted.manifest) {
          if (!item || !item.noteDbId || !item.title) continue;
          const localNote = localByTitle.get(item.title);
          if (
            mode === 'replace' ||
            !localNote ||
            (item.updatedAt || 0) > (localNote.updatedAt || 0)
          ) {
            noteIdsToFetch.push(item.noteDbId);
          }
        }

        const fetchedNotes: NoshNote[] = [];
        if (noteIdsToFetch.length > 0) {
          const noteRows = await this.fetchEncryptedRowsByIds(noteIdsToFetch);
          for (const r of noteRows) {
            if (!r || !r.content) continue;
            try {
              const noteEnv = JSON.parse(r.content) as EncryptedEnvelope;
              const noteData = decryptPayloadE2EE<NoshNote>(
                noteEnv,
                creds.vaultEncKey
              );
              if (noteData && noteData.title) {
                fetchedNotes.push(noteData);
                this.syncedNoteTimestamps.set(
                  r.id,
                  noteData.updatedAt || Date.now()
                );
              }
            } catch {}
          }
        }

        const manifestTitles = decrypted.manifest.map((m) => m.title);
        this.callbacks.onVaultSnapshotReceived(
          fetchedNotes,
          decrypted.peer || this.selfPeer,
          mode,
          manifestTitles
        );
        return true;
      }

      // Legacy fallback if inline notes array was present
      if (Array.isArray(decrypted.notes)) {
        this.callbacks.onVaultSnapshotReceived(
          decrypted.notes,
          decrypted.peer || this.selfPeer,
          mode,
          decrypted.notes.map((n) => n.title)
        );
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  public async pushVaultSnapshot(forceAll = false): Promise<void> {
    if (!this.session || this.isPushing) return;
    this.isPushing = true;

    try {
      const creds = this.getCredentials();
      const allNotes = this.callbacks
        .getCurrentVaultNotes()
        .filter((n) => !n.trashed);

      const manifest: VaultManifestItem[] = [];

      for (const note of allNotes) {
        const noteDbId = deriveNoteDbId(creds.authToken, note.title);
        manifest.push({
          noteDbId,
          title: note.title,
          pinned: Boolean(note.pinned),
          updatedAt: note.updatedAt,
          versionClock: note.versionClock || 1,
        });

        const prevSyncedTs = this.syncedNoteTimestamps.get(noteDbId);
        if (forceAll || prevSyncedTs !== note.updatedAt) {
          const noteEnvelope = encryptPayloadE2EE(
            note,
            creds.vaultEncKey,
            noteDbId,
            this.selfPeer.peerId,
            'vault-snapshot'
          );
          const ok = await this.upsertEncryptedRow(
            noteDbId,
            creds.vaultWriteToken,
            'nosh-note-row',
            noteEnvelope
          );
          if (ok) {
            this.syncedNoteTimestamps.set(noteDbId, note.updatedAt);
          }
        }
      }

      const manifestPayload = {
        v: 2,
        peer: this.selfPeer,
        updatedAt: Date.now(),
        manifest,
      };

      const manifestEnvelope = encryptPayloadE2EE(
        manifestPayload,
        creds.vaultEncKey,
        creds.vaultDbId,
        this.selfPeer.peerId,
        'vault-snapshot'
      );

      await this.upsertEncryptedRow(
        creds.vaultDbId,
        creds.vaultWriteToken,
        'nosh-token-vault',
        manifestEnvelope
      );
      this.callbacks.onStatusChange('connected');
      this.broadcastEncrypted('vault-snapshot', manifestPayload);
    } finally {
      this.isPushing = false;
    }
  }

  public broadcastBlockOp(op: Omit<CRDTBlockOp, 'sender'>): void {
    const fullOp: CRDTBlockOp = {
      ...op,
      sender: { ...this.selfPeer, lastSeen: Date.now() },
    };
    this.broadcastEncrypted('block-crdt-op', fullOp);
    this.pushVaultSnapshot(false);
  }

  private broadcastEncrypted(type: SyncMessageType, data: unknown): void {
    if (!this.session || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const creds = this.getCredentials();
    const envelope = encryptPayloadE2EE(
      data,
      creds.vaultEncKey,
      creds.vaultDbId,
      this.selfPeer.peerId,
      type
    );
    const channelTopic = `realtime:nosh-e2ee-${creds.vaultDbId}`;
    this.sendPhoenixFrame(channelTopic, 'broadcast', {
      type: 'broadcast',
      event: 'nosh-e2ee',
      payload: envelope,
    });
  }

  private handleIncomingEnvelope(envelope: EncryptedEnvelope): void {
    if (!this.session || envelope.senderId === this.selfPeer.peerId) {
      return;
    }
    const creds = this.getCredentials();
    const decrypted = decryptPayloadE2EE<any>(envelope, creds.vaultEncKey);
    if (!decrypted) return;

    switch (envelope.type) {
      case 'peer-hello': {
        const peer = decrypted as PeerIdentity;
        this.registerPeer(peer);
        this.broadcastEncrypted('peer-presence', this.selfPeer);
        break;
      }
      case 'peer-presence': {
        const peer = decrypted as PeerIdentity;
        this.registerPeer(peer);
        break;
      }
      case 'vault-request': {
        if (decrypted.requester) {
          this.registerPeer(decrypted.requester as PeerIdentity);
        }
        if (this.initialHandshakeCompleted) {
          this.pushVaultSnapshot(false);
        }
        break;
      }
      case 'vault-snapshot':
      case 'block-crdt-op':
      case 'note-crdt-op': {
        this.pullEncryptedMailbox('incremental', true);
        break;
      }
    }
  }

  private registerPeer(peer: PeerIdentity): void {
    if (!peer || !peer.peerId || peer.peerId === this.selfPeer.peerId) return;
    this.peersMap.set(peer.peerId, {
      ...peer,
      lastSeen: Date.now(),
    });
    this.callbacks.onPeersUpdated(Array.from(this.peersMap.values()));
  }

  private pruneStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peersMap.entries()) {
      if (now - p.lastSeen > 65000) {
        this.peersMap.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.callbacks.onPeersUpdated(Array.from(this.peersMap.values()));
    }
  }

  private sendPhoenixFrame(topic: string, event: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = {
      topic,
      event,
      payload,
      ref: String(this.refCounter++),
    };
    this.ws.send(JSON.stringify(frame));
  }
}

export function mergeNoteCRDT(local: NoshNote, incoming: NoshNote): NoshNote {
  const incomingBlocks =
    incoming.blocks && incoming.blocks.length > 0
      ? incoming.blocks
      : parseNshToBlocks(incoming.rawNsh || '', 'peer');

  if ((!incoming.blocks || incoming.blocks.length === 0) && incoming.rawNsh) {
    if ((incoming.updatedAt || 0) >= (local.updatedAt || 0) || local.rawNsh !== incoming.rawNsh) {
      return {
        ...local,
        title: incoming.title || local.title,
        blocks: incomingBlocks,
        rawNsh: incoming.rawNsh,
        tags: extractTagsFromBlocks(incomingBlocks),
        pinned: incoming.pinned ?? local.pinned,
        updatedAt: Math.max(local.updatedAt, incoming.updatedAt || Date.now()),
        versionClock: Math.max(local.versionClock || 1, incoming.versionClock || 1) + 1,
      };
    }
  }

  const blockMap = new Map<string, (typeof local.blocks)[0]>();
  const order: string[] = [];

  for (const b of local.blocks) {
    blockMap.set(b.id, b);
    order.push(b.id);
  }

  for (const incB of incomingBlocks) {
    const existing = blockMap.get(incB.id);
    if (!existing) {
      blockMap.set(incB.id, incB);
      order.push(incB.id);
    } else if (incB.updatedAt >= existing.updatedAt) {
      blockMap.set(incB.id, incB);
    }
  }

  const mergedBlocks = order.map((id) => blockMap.get(id)!).filter(Boolean);
  const rawNsh = serializeBlocksToNsh(mergedBlocks);
  const tags = extractTagsFromBlocks(mergedBlocks);

  return {
    ...local,
    title: incoming.updatedAt > local.updatedAt ? incoming.title : local.title,
    blocks: mergedBlocks,
    rawNsh,
    tags,
    pinned: incoming.updatedAt > local.updatedAt ? incoming.pinned : local.pinned,
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
    versionClock: Math.max(local.versionClock, incoming.versionClock) + 1,
  };
}
