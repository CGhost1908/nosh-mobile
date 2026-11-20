import { EncryptedEnvelope, QRSyncPayload, SyncMessageType } from '../types/note';

export function generateRandomHex(byteLength = 16): string {
  const hexChars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < byteLength * 2; i++) {
    out += hexChars[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function utf8ToBytes(str: string): number[] {
  const encoded = encodeURIComponent(str);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      bytes.push(parseInt(encoded.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

export function bytesToUtf8(bytes: number[]): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    encoded += '%' + ('00' + b.toString(16)).slice(-2);
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.substr(i, 2), 16) || 0);
  }
  return out;
}

function mixState(seed: string, blockCounter: number): number[] {
  const s = `${seed}:${blockCounter}`;
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  let h3 = 0x1b873593;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | (c >>> 5)), 0x5bd1e995) >>> 0;
    h3 = Math.imul(h3 ^ (c + i), 0xcc9e2d51) >>> 0;
    h4 = Math.imul(h4 ^ (c * 31), 0x1b873593) >>> 0;
  }

  for (let r = 0; r < 8; r++) {
    h1 = (Math.imul(h1 ^ (h4 >>> 13), 0xc2b2ae35) + h2) >>> 0;
    h2 = (Math.imul(h2 ^ (h1 >>> 15), 0x85ebca6b) + h3) >>> 0;
    h3 = (Math.imul(h3 ^ (h2 >>> 16), 0x27d4eb2d) + h4) >>> 0;
    h4 = (Math.imul(h4 ^ (h3 >>> 11), 0x165667b1) + h1) >>> 0;
  }

  return [
    h1 & 0xff, (h1 >>> 8) & 0xff, (h1 >>> 16) & 0xff, (h1 >>> 24) & 0xff,
    h2 & 0xff, (h2 >>> 8) & 0xff, (h2 >>> 16) & 0xff, (h2 >>> 24) & 0xff,
    h3 & 0xff, (h3 >>> 8) & 0xff, (h3 >>> 16) & 0xff, (h3 >>> 24) & 0xff,
    h4 & 0xff, (h4 >>> 8) & 0xff, (h4 >>> 16) & 0xff, (h4 >>> 24) & 0xff,
  ];
}

export function computeKeyedMac(secretKey: string, iv: string, ciphertextHex: string): string {
  const macBytes = mixState(`mac:${secretKey}:${iv}:${ciphertextHex}`, ciphertextHex.length);
  return bytesToHex(macBytes);
}

export function normalizeRoomId(roomId: string): string {
  let clean = String(roomId || '').replace(/[^A-Za-z0-9]/g, '');
  if (clean.length < 12) {
    clean = ('noshroom' + clean).padEnd(14, '0');
  }
  return clean.slice(0, 48);
}

export function normalizeAuthToken(rawToken?: string | null): string {
  const clean = String(rawToken || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return clean.length >= 24 ? clean.slice(0, 64) : '';
}

export interface VaultCredentials {
  authToken: string;
  vaultDbId: string;
  vaultEncKey: string;
  vaultWriteToken: string;
}

// Identical derivation as Nosh Desktop (qr-sync.js)
export function deriveVaultCredentials(authToken: string): VaultCredentials {
  const cleanToken = normalizeAuthToken(authToken) || generateRandomHex(16);
  const vaultDbId = 'vlt' + computeKeyedMac(cleanToken, 'nosh-vault-db-id', 'v1').slice(0, 24);
  const vaultEncKey = computeKeyedMac(cleanToken, 'nosh-vault-enc-key', 'v1');
  const vaultWriteToken = computeKeyedMac(cleanToken, 'nosh-vault-write-token', 'v1');
  return {
    authToken: cleanToken,
    vaultDbId,
    vaultEncKey,
    vaultWriteToken,
  };
}

export function deriveNoteDbId(authToken: string, noteTitle: string): string {
  const cleanToken = normalizeAuthToken(authToken);
  const cleanTitle = String(noteTitle || '').trim();
  return 'nte' + computeKeyedMac(cleanToken, 'nosh-note-db-id', cleanTitle).slice(0, 24);
}

export function deriveRoomEditToken(secretKey: string, roomId: string): string {
  const cleanId = normalizeRoomId(roomId);
  return computeKeyedMac(secretKey, 'room-edit-token', cleanId);
}

export function encodeEncryptedTokenQR(authToken: string, transferKey?: string): string {
  const cleanToken = normalizeAuthToken(authToken) || generateRandomHex(16);
  const k = (transferKey || generateRandomHex(8)).replace(/[^0-9a-fA-F]/g, '').slice(0, 16);
  const plainBytes = utf8ToBytes(cleanToken);
  const cipherBytes = new Array<number>(plainBytes.length);
  let ksBlock: number[] = [];
  for (let i = 0; i < plainBytes.length; i++) {
    if (i % 16 === 0) ksBlock = mixState(`qr-token:${k}`, Math.floor(i / 16));
    cipherBytes[i] = plainBytes[i] ^ ksBlock[i % 16];
  }
  const e = bytesToHex(cipherBytes);
  const m = computeKeyedMac(k, 'qr-token-mac', e).slice(0, 16);
  return `nosh://token?e=${e}&k=${k}&m=${m}`;
}

export function decodeEncryptedTokenQR(rawInput: string): string | null {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return null;

  if (/^[0-9a-fA-F]{24,64}$/.test(trimmed)) {
    return normalizeAuthToken(trimmed);
  }

  const queryStart = trimmed.indexOf('?');
  if (queryStart === -1) return null;
  const query = trimmed.slice(queryStart + 1);
  const map: Record<string, string> = {};
  query.split('&').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq > 0) {
      map[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
    }
  });

  if (map.e && map.k && map.m) {
    const expectedMac = computeKeyedMac(map.k, 'qr-token-mac', map.e).slice(0, 16);
    if (expectedMac !== map.m) return null;
    const cipherBytes = hexToBytes(map.e);
    const plainBytes = new Array<number>(cipherBytes.length);
    let ksBlock: number[] = [];
    for (let i = 0; i < cipherBytes.length; i++) {
      if (i % 16 === 0) ksBlock = mixState(`qr-token:${map.k}`, Math.floor(i / 16));
      plainBytes[i] = cipherBytes[i] ^ ksBlock[i % 16];
    }
    const candidate = bytesToUtf8(plainBytes);
    return normalizeAuthToken(candidate) || null;
  }

  if (map.k && normalizeAuthToken(map.k)) {
    return normalizeAuthToken(map.k);
  }

  return null;
}

export function createSessionFromAuthToken(
  rawToken?: string | null,
  transferKey?: string
): QRSyncPayload {
  const creds = deriveVaultCredentials(rawToken || generateRandomHex(16));
  return {
    protocol: 'nosh-e2ee-v1',
    roomId: creds.vaultDbId,
    secretKey: creds.vaultEncKey,
    authToken: creds.authToken,
    qrTransferKey: transferKey || generateRandomHex(8),
    mode: 'vault',
  };
}

export function encryptPayloadE2EE(
  payloadObj: unknown,
  secretKey: string,
  roomId: string,
  senderId: string,
  type: SyncMessageType
): EncryptedEnvelope {
  const iv = generateRandomHex(8);
  const plainJson = JSON.stringify(payloadObj);
  const plainBytes = utf8ToBytes(plainJson);
  const cipherBytes = new Array<number>(plainBytes.length);

  let ksBlock: number[] = [];
  for (let i = 0; i < plainBytes.length; i++) {
    if (i % 16 === 0) {
      ksBlock = mixState(`${secretKey}:${iv}`, Math.floor(i / 16));
    }
    cipherBytes[i] = plainBytes[i] ^ ksBlock[i % 16];
  }

  const ciphertext = bytesToHex(cipherBytes);
  const mac = computeKeyedMac(secretKey, iv, ciphertext);

  return {
    v: 1,
    roomId: normalizeRoomId(roomId),
    senderId,
    type,
    iv,
    ciphertext,
    mac,
    ts: Date.now(),
  };
}

export function decryptPayloadE2EE<T = unknown>(
  envelope: EncryptedEnvelope,
  secretKey: string
): T | null {
  if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.mac) {
    return null;
  }

  const expectedMac = computeKeyedMac(secretKey, envelope.iv, envelope.ciphertext);
  if (expectedMac !== envelope.mac) {
    return null;
  }

  const cipherBytes = hexToBytes(envelope.ciphertext);
  const plainBytes = new Array<number>(cipherBytes.length);

  let ksBlock: number[] = [];
  for (let i = 0; i < cipherBytes.length; i++) {
    if (i % 16 === 0) {
      ksBlock = mixState(`${secretKey}:${envelope.iv}`, Math.floor(i / 16));
    }
    plainBytes[i] = cipherBytes[i] ^ ksBlock[i % 16];
  }

  try {
    const jsonStr = bytesToUtf8(plainBytes);
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

export function encodeQRSyncUri(payload: QRSyncPayload): string {
  const token = payload.authToken || payload.secretKey;
  return encodeEncryptedTokenQR(token, payload.qrTransferKey);
}

export function decodeQRSyncUri(rawQrData: string): QRSyncPayload | null {
  const decodedToken = decodeEncryptedTokenQR(rawQrData);
  if (!decodedToken) return null;
  return createSessionFromAuthToken(decodedToken);
}
