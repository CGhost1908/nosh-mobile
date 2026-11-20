import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeTokens } from '../theme/colors';
import { QRSyncPayload } from '../types/note';
import { decodeQRSyncUri, encodeQRSyncUri } from '../utils/cryptoE2EE';
import { QRMatrixSvg } from '../components/QRMatrixSvg';
import { SolarIcon } from '../components/SolarIcon';

interface QRScannerModalProps {
  visible: boolean;
  theme: ThemeTokens;
  activeSession: QRSyncPayload | null;
  activeNoteTitle?: string;
  connectedCount: number;
  syncStatus: 'disconnected' | 'connecting' | 'connected' | 'syncing';
  onClose: () => void;
  onScanOrJoinSession: (
    payload: QRSyncPayload,
    joinStrategy: 'replace' | 'merge'
  ) => void;
  onCreateNewSession: (mode: 'vault' | 'collab-note', targetNote?: string) => QRSyncPayload;
  onDisconnectSession: () => void;
  onTriggerManualSync: () => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  visible,
  theme,
  activeSession,
  activeNoteTitle,
  connectedCount,
  syncStatus,
  onClose,
  onScanOrJoinSession,
  onCreateNewSession,
  onDisconnectSession,
  onTriggerManualSync,
}) => {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'scan' | 'generate'>('scan');
  const [permission, requestPermission] = useCameraPermissions();
  const [manualInput, setManualInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [scannedLock, setScannedLock] = useState(false);
  const [pendingSession, setPendingSession] = useState<QRSyncPayload | null>(null);

  useEffect(() => {
    if (visible) {
      setScannedLock(false);
      setScanError(null);
      setPendingSession(null);
    }
  }, [visible]);

  const triggerHaptic = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scannedLock || pendingSession) return;
    const decoded = decodeQRSyncUri(data);
    if (!decoded) {
      setScanError('Invalid QR code. Please scan a Nosh QR Sync code.');
      return;
    }
    setScannedLock(true);
    setScanError(null);
    triggerHaptic();
    setPendingSession(decoded);
  };

  const handleManualConnect = () => {
    const decoded = decodeQRSyncUri(manualInput);
    if (!decoded) {
      setScanError('Invalid token link. Expected "nosh://token?..."');
      return;
    }
    setScanError(null);
    triggerHaptic();
    setPendingSession(decoded);
  };

  const handleConfirmSyncChoice = (strategy: 'replace' | 'merge') => {
    if (!pendingSession) return;
    triggerHaptic();
    const target = pendingSession;
    setPendingSession(null);
    setManualInput('');
    onScanOrJoinSession(target, strategy);
    onClose();
  };

  const currentQrUri = activeSession ? encodeQRSyncUri(activeSession) : '';
  const rawToken = activeSession?.authToken || activeSession?.secretKey || '';
  const maskedToken =
    rawToken.length >= 12
      ? `${rawToken.slice(0, 6)}••••${rawToken.slice(-6)}`
      : '••••••';

  const handleCopyUri = async () => {
    if (!currentQrUri) return;
    await Clipboard.setStringAsync(currentQrUri);
    triggerHaptic();
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1800);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropDismiss} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.bgModal,
              borderColor: theme.borderMedium,
              paddingBottom: Math.max(insets.bottom, 20) + 8,
            },
          ]}
        >
          {/* Native Mobile Sheet Handle */}
          <View style={styles.handleWrap}>
            <View style={[styles.handleBar, { backgroundColor: theme.borderMedium }]} />
          </View>

          {/* Sheet Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.iconBadge, { backgroundColor: theme.accentSubtle }]}>
                <SolarIcon name="solar:qr-code-bold-duotone" size={21} color={theme.accent} />
              </View>
              <View>
                <Text style={[styles.title, { color: theme.textPrimary }]}>
                  QR Sync
                </Text>
                <Text style={[styles.subtitle, { color: theme.textMuted }]}>
                  End-to-End Encrypted · Zero Account
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeCircle, { backgroundColor: theme.bgSurface }]}
            >
              <SolarIcon name="solar:close-circle-linear" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Segmented Pill Control */}
          <View
            style={[
              styles.segmentedControl,
              {
                backgroundColor: theme.bgSurface,
                borderColor: theme.borderSubtle,
              },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                tab === 'scan' && { backgroundColor: theme.accent },
              ]}
              onPress={() => setTab('scan')}
              activeOpacity={0.85}
            >
              <SolarIcon
                name="solar:scanner-linear"
                size={16}
                color={tab === 'scan' ? '#fff' : theme.textSecondary}
              />
              <Text
                style={[
                  styles.segmentText,
                  { color: tab === 'scan' ? '#fff' : theme.textSecondary },
                ]}
              >
                Scan QR
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.segmentBtn,
                tab === 'generate' && { backgroundColor: theme.accent },
              ]}
              onPress={() => {
                setTab('generate');
                if (!activeSession) {
                  onCreateNewSession('vault');
                }
              }}
              activeOpacity={0.85}
            >
              <SolarIcon
                name="solar:qr-code-linear"
                size={16}
                color={tab === 'generate' ? '#fff' : theme.textSecondary}
              />
              <Text
                style={[
                  styles.segmentText,
                  { color: tab === 'generate' ? '#fff' : theme.textSecondary },
                ]}
              >
                My QR Code
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Active Connection Pill Banner */}
            {activeSession ? (
              <View
                style={[
                  styles.statusCard,
                  {
                    backgroundColor: theme.bgSurface,
                    borderColor:
                      syncStatus === 'connected' ? theme.success : theme.borderMedium,
                  },
                ]}
              >
                <View style={styles.statusLeft}>
                  <View
                    style={[
                      styles.statusDot,
                      {
                        backgroundColor:
                          syncStatus === 'connected' ? theme.success : theme.warning,
                      },
                    ]}
                  />
                  <View>
                    <Text style={[styles.statusTitle, { color: theme.textPrimary }]}>
                      {syncStatus === 'connected'
                        ? 'Encrypted Token Vault Active'
                        : 'Connecting Token Vault...'}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12, fontFamily: 'monospace' }}>
                      Token: {maskedToken}
                    </Text>
                  </View>
                </View>

                <View style={styles.statusRightActions}>
                  <TouchableOpacity
                    style={[
                      styles.pillActionBtn,
                      { backgroundColor: theme.accentSubtle },
                    ]}
                    onPress={() => {
                      triggerHaptic();
                      onTriggerManualSync();
                    }}
                  >
                    <SolarIcon name="solar:restart-linear" size={15} color={theme.accent} />
                    <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>
                      Sync
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.iconActionBtn,
                      { backgroundColor: theme.dangerSubtle },
                    ]}
                    onPress={onDisconnectSession}
                  >
                    <SolarIcon name="solar:power-linear" size={15} color={theme.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {tab === 'scan' ? (
              pendingSession ? (
                <View
                  style={[
                    styles.permissionCard,
                    {
                      backgroundColor: theme.bgSurface,
                      borderColor: theme.accentBorder,
                      alignItems: 'stretch',
                      gap: 14,
                    },
                  ]}
                >
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <View
                      style={[
                        styles.permIconCircle,
                        { backgroundColor: theme.accentSubtle },
                      ]}
                    >
                      <SolarIcon
                        name="solar:qr-code-bold-duotone"
                        size={28}
                        color={theme.accent}
                      />
                    </View>
                    <Text style={[styles.permTitle, { color: theme.textPrimary }]}>
                      Desktop Token Detected
                    </Text>
                    <Text style={[styles.permDesc, { color: theme.textSecondary }]}>
                      How would you like to sync your notes with the scanned Desktop vault?
                    </Text>
                  </View>

                  {/* Option 1: Continue with Desktop Vault (Replace) */}
                  <TouchableOpacity
                    style={[
                      styles.statusCard,
                      {
                        backgroundColor: theme.accentSubtle,
                        borderColor: theme.accent,
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                      },
                    ]}
                    onPress={() => handleConfirmSyncChoice('replace')}
                    activeOpacity={0.85}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <SolarIcon
                        name="solar:cloud-upload-linear"
                        size={18}
                        color={theme.accent}
                      />
                      <Text
                        style={{
                          color: theme.textPrimary,
                          fontSize: 15,
                          fontWeight: '800',
                        }}
                      >
                        Continue with Desktop Vault
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: theme.textSecondary,
                        fontSize: 12.5,
                        lineHeight: 18,
                      }}
                    >
                      Load only the files from the computer. Replaces local phone notes so both devices show the exact same Desktop files.
                    </Text>
                  </TouchableOpacity>

                  {/* Option 2: Merge Both Devices */}
                  <TouchableOpacity
                    style={[
                      styles.statusCard,
                      {
                        backgroundColor: theme.bgElevated,
                        borderColor: theme.borderMedium,
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 6,
                      },
                    ]}
                    onPress={() => handleConfirmSyncChoice('merge')}
                    activeOpacity={0.85}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <SolarIcon
                        name="solar:folder-with-files-linear"
                        size={18}
                        color={theme.textPrimary}
                      />
                      <Text
                        style={{
                          color: theme.textPrimary,
                          fontSize: 15,
                          fontWeight: '800',
                        }}
                      >
                        Merge Both Devices
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: theme.textSecondary,
                        fontSize: 12.5,
                        lineHeight: 18,
                      }}
                    >
                      Combine your local phone notes and your computer notes together so both devices keep all files from both sides.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      alignItems: 'center',
                      paddingVertical: 10,
                    }}
                    onPress={() => {
                      setPendingSession(null);
                      setScannedLock(false);
                    }}
                  >
                    <Text
                      style={{
                        color: theme.textMuted,
                        fontSize: 13,
                        fontWeight: '700',
                      }}
                    >
                      Cancel & Scan Again
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
              <View style={styles.section}>
                {!permission ? (
                  <View style={styles.loadingWrap}>
                    <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                      Requesting camera access...
                    </Text>
                  </View>
                ) : !permission.granted ? (
                  <View
                    style={[
                      styles.permissionCard,
                      {
                        backgroundColor: theme.bgSurface,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.permIconCircle,
                        { backgroundColor: theme.accentSubtle },
                      ]}
                    >
                      <SolarIcon name="solar:camera-linear" size={28} color={theme.accent} />
                    </View>
                    <Text style={[styles.permTitle, { color: theme.textPrimary }]}>
                      Enable Camera to Scan QR
                    </Text>
                    <Text style={[styles.permDesc, { color: theme.textSecondary }]}>
                      Point your camera at the QR code shown in Nosh Desktop to pair and sync your notes instantly.
                    </Text>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
                      onPress={requestPermission}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.primaryBtnText}>Allow Camera Access</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.cameraContainer}>
                    <CameraView
                      style={styles.camera}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={scannedLock ? undefined : handleBarCodeScanned}
                    />
                    <View style={styles.cameraOverlay} pointerEvents="none">
                      <View
                        style={[
                          styles.scanReticle,
                          { borderColor: theme.accent },
                        ]}
                      />
                      <View style={styles.cameraHintPill}>
                        <Text style={styles.cameraHintText}>
                          Align Desktop QR code inside frame
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {scanError ? (
                  <View
                    style={[
                      styles.errorBanner,
                      { backgroundColor: theme.dangerSubtle },
                    ]}
                  >
                    <SolarIcon name="solar:danger-triangle-linear" size={16} color={theme.danger} />
                    <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>
                      {scanError}
                    </Text>
                  </View>
                ) : null}

                {/* Manual Paste Box */}
                <View style={styles.manualGroup}>
                  <Text style={[styles.inputLabel, { color: theme.textMuted }]}>
                    OR PASTE ENCRYPTED TOKEN LINK
                  </Text>
                  <View style={styles.manualRow}>
                    <TextInput
                      value={manualInput}
                      onChangeText={setManualInput}
                      placeholder="nosh://token?e=...&k=...&m=..."
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[
                        styles.manualInput,
                        {
                          backgroundColor: theme.bgSurface,
                          color: theme.textPrimary,
                          borderColor: theme.borderSubtle,
                        },
                      ]}
                    />
                    <TouchableOpacity
                      style={[styles.joinBtn, { backgroundColor: theme.accent }]}
                      onPress={handleManualConnect}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.joinBtnText}>Load</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              )
            ) : (
              <View style={styles.section}>
                {activeSession ? (
                  <View
                    style={[
                      styles.qrDisplayCard,
                      {
                        backgroundColor: theme.bgSurface,
                        borderColor: theme.borderSubtle,
                      },
                    ]}
                  >
                    <View style={styles.qrWhiteFrame}>
                      <QRMatrixSvg value={currentQrUri} size={220} />
                    </View>
                    <Text style={[styles.qrCaption, { color: theme.textSecondary }]}>
                      Scan this encrypted token QR on another device to share your vault without any account.
                    </Text>
                    <View style={styles.qrActionRow}>
                      <TouchableOpacity
                        style={[
                          styles.actionButtonLarge,
                          {
                            backgroundColor: copiedUri
                              ? theme.successSubtle
                              : theme.accent,
                          },
                        ]}
                        onPress={handleCopyUri}
                        activeOpacity={0.85}
                      >
                        <SolarIcon
                          name={copiedUri ? 'solar:check-circle-bold' : 'solar:copy-linear'}
                          size={18}
                          color={copiedUri ? theme.success : '#fff'}
                        />
                        <Text
                          style={{
                            color: copiedUri ? theme.success : '#fff',
                            fontSize: 14,
                            fontWeight: '700',
                          }}
                        >
                          {copiedUri ? 'Link Copied' : 'Copy Pairing Link'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.refreshButtonLarge,
                          {
                            backgroundColor: theme.bgElevated,
                            borderColor: theme.borderMedium,
                          },
                        ]}
                        onPress={() => {
                          triggerHaptic();
                          onCreateNewSession('vault', activeNoteTitle);
                        }}
                        activeOpacity={0.85}
                      >
                        <SolarIcon
                          name="solar:restart-linear"
                          size={18}
                          color={theme.textPrimary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    maxHeight: '88%',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 16,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: 16,
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  permissionCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  permIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  permTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  permDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  primaryBtn: {
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  cameraContainer: {
    height: 270,
    borderRadius: 22,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanReticle: {
    width: 185,
    height: 185,
    borderWidth: 2.5,
    borderRadius: 24,
  },
  cameraHintPill: {
    position: 'absolute',
    bottom: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  cameraHintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  manualGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginLeft: 4,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  joinBtn: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: 14,
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  qrDisplayCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 14,
  },
  qrWhiteFrame: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  qrCaption: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  qrActionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  actionButtonLarge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  refreshButtonLarge: {
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
  },
});
