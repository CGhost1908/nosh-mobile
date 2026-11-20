import React, { useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  getLanguageMeta,
  SUPPORTED_LANGUAGES,
  ThemeTokens,
} from '../theme/colors';
import { NoteBlock } from '../types/note';
import { SolarIcon } from './SolarIcon';

interface CodeBlockCardProps {
  block: NoteBlock;
  theme: ThemeTokens;
  onChangeCode: (text: string) => void;
  onChangeLanguage: (langLabel: string) => void;
  onToggleWrap: () => void;
  onDelete: () => void;
  onFocusBlock?: () => void;
}

export const CodeBlockCard: React.FC<CodeBlockCardProps> = ({
  block,
  theme,
  onChangeCode,
  onChangeLanguage,
  onToggleWrap,
  onDelete,
  onFocusBlock,
}) => {
  const [copied, setCopied] = useState(false);
  const [langModalOpen, setLangModalOpen] = useState(false);

  const langMeta = getLanguageMeta(block.language);
  const lines = (block.content || '').split('\n');

  const handleCopy = async () => {
    await Clipboard.setStringAsync(block.content || '');
    try {
      Haptics.selectionAsync();
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View
      style={[
        styles.wrapper,
        {
          backgroundColor: theme.bgCode,
          borderColor: theme.borderMedium,
        },
      ]}
    >
      {/* Mobile-friendly Code Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.bgSurface,
            borderBottomColor: theme.borderSubtle,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <View style={styles.dotsRow}>
            <View style={[styles.dot, { backgroundColor: '#ff5f56' }]} />
            <View style={[styles.dot, { backgroundColor: '#ffbd2e' }]} />
            <View style={[styles.dot, { backgroundColor: '#27c93f' }]} />
          </View>

          <TouchableOpacity
            style={[
              styles.langPill,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.borderSubtle,
              },
            ]}
            onPress={() => setLangModalOpen(true)}
            activeOpacity={0.75}
          >
            <SolarIcon name={langMeta.icon} size={14} color={langMeta.color} />
            <Text style={[styles.langText, { color: theme.textPrimary }]}>
              {langMeta.label}
            </Text>
            <SolarIcon
              name="solar:alt-arrow-down-linear"
              size={13}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: block.wrap ? theme.accentSubtle : theme.bgElevated,
                borderColor: block.wrap ? theme.accentBorder : theme.borderSubtle,
              },
            ]}
            onPress={onToggleWrap}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.actionText,
                { color: block.wrap ? theme.accent : theme.textSecondary },
              ]}
            >
              Wrap
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: copied ? theme.successSubtle : theme.bgElevated,
                borderColor: theme.borderSubtle,
              },
            ]}
            onPress={handleCopy}
            activeOpacity={0.75}
          >
            <SolarIcon
              name={copied ? 'solar:check-circle-bold' : 'solar:copy-linear'}
              size={13}
              color={copied ? theme.success : theme.textSecondary}
            />
            <Text
              style={[
                styles.actionText,
                { color: copied ? theme.success : theme.textSecondary },
              ]}
            >
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.iconBtn,
              {
                backgroundColor: theme.dangerSubtle,
              },
            ]}
            onPress={onDelete}
            activeOpacity={0.75}
          >
            <SolarIcon
              name="solar:trash-bin-trash-linear"
              size={14}
              color={theme.danger}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Code Body with Line Numbers */}
      <View style={styles.bodyRow}>
        <View
          style={[
            styles.gutter,
            {
              borderRightColor: theme.borderSubtle,
              backgroundColor: 'rgba(255,255,255,0.015)',
            },
          ]}
        >
          {lines.map((_, idx) => (
            <Text key={idx} style={[styles.lineNum, { color: theme.textMuted }]}>
              {idx + 1}
            </Text>
          ))}
        </View>

        <ScrollView
          horizontal={!block.wrap}
          showsHorizontalScrollIndicator={!block.wrap}
          contentContainerStyle={styles.codeScrollContent}
        >
          <TextInput
            value={block.content}
            onChangeText={onChangeCode}
            onFocus={onFocusBlock}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder={`// Write ${langMeta.label} code...`}
            placeholderTextColor={theme.textMuted}
            style={[
              styles.codeInput,
              {
                color: theme.textPrimary,
                minWidth: block.wrap ? '100%' : 280,
              },
            ]}
          />
        </ScrollView>
      </View>

      {/* Bottom Sheet Language Picker Modal */}
      <Modal
        visible={langModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLangModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setLangModalOpen(false)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: theme.bgModal,
                borderColor: theme.borderMedium,
              },
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handleBar, { backgroundColor: theme.borderMedium }]} />
            </View>
            <View style={styles.sheetHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                Code Language
              </Text>
              <TouchableOpacity
                onPress={() => setLangModalOpen(false)}
                style={[styles.closeCircle, { backgroundColor: theme.bgSurface }]}
              >
                <SolarIcon
                  name="solar:close-circle-linear"
                  size={18}
                  color={theme.textSecondary}
                />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.langGrid}>
                {SUPPORTED_LANGUAGES.map((item) => {
                  const selected =
                    item.label.toLowerCase() === langMeta.label.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.langOption,
                        {
                          backgroundColor: selected
                            ? theme.accentSubtle
                            : theme.bgSurface,
                          borderColor: selected
                            ? theme.accent
                            : theme.borderSubtle,
                        },
                      ]}
                      onPress={() => {
                        onChangeLanguage(item.label);
                        setLangModalOpen(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <SolarIcon
                        name={item.icon}
                        size={16}
                        color={item.color}
                      />
                      <Text
                        style={[
                          styles.langOptionText,
                          {
                            color: selected ? theme.accent : theme.textPrimary,
                            fontWeight: selected ? '700' : '600',
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  langDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  langText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyRow: {
    flexDirection: 'row',
    minHeight: 84,
  },
  gutter: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    alignItems: 'flex-end',
  },
  lineNum: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 21,
  },
  codeScrollContent: {
    flexGrow: 1,
  },
  codeInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'monospace',
    fontSize: 13.5,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingBottom: 32,
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  closeCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 4,
  },
  langOption: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  langOptionText: {
    fontSize: 13.5,
  },
});
