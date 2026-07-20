import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '@/design/system';

type SettingsItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  helper: string;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onManagePhotos: () => void;
  onBlockedUsers: () => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
  showOnlineStatus: boolean;
  onToggleShowOnlineStatus: (value: boolean) => void;
};

export const ProfileSettingsSheet = React.memo(function ProfileSettingsSheet({
  visible,
  onClose,
  onManagePhotos,
  onBlockedUsers,
  onLogout,
  onDeleteAccount,
  showOnlineStatus,
  onToggleShowOnlineStatus,
}: Props) {
  const items: SettingsItem[] = [
    {
      icon: 'images-outline',
      label: 'Manage photos',
      helper: 'Add, delete, and choose your primary photo.',
      onPress: onManagePhotos,
    },
    {
      icon: 'ban-outline',
      label: 'Blocked users',
      helper: 'Review people you have blocked.',
      onPress: onBlockedUsers,
    },
    {
      icon: 'log-out-outline',
      label: 'Log out',
      helper: 'Sign out of this account.',
      destructive: true,
      onPress: onLogout,
    },
    {
      icon: 'trash-outline',
      label: 'Delete account',
      helper: 'Permanently delete your account and all your data.',
      destructive: true,
      onPress: onDeleteAccount,
    },
  ];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Settings</Text>
              <Text style={styles.subtitle}>Account and privacy controls</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.list}>
            <View style={styles.item}>
              <View style={styles.itemIcon}>
                <Ionicons
                  name={showOnlineStatus ? 'radio-button-on-outline' : 'eye-off-outline'}
                  size={20}
                  color={colors.text}
                />
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemLabel}>Show online status</Text>
                <Text style={styles.itemHelper}>
                  {showOnlineStatus
                    ? 'Matches can see when you are online.'
                    : "You're invisible — no one sees you as online."}
                </Text>
              </View>
              <Switch
                value={showOnlineStatus}
                onValueChange={onToggleShowOnlineStatus}
                trackColor={{ false: '#E4E4EA', true: '#F5B8C1' }}
                thumbColor={showOnlineStatus ? colors.primary : '#FFFFFF'}
              />
            </View>
            {items.map(item => (
              <Pressable
                key={item.label}
                style={styles.item}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                <View style={[styles.itemIcon, item.destructive && styles.itemIconDanger]}>
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={item.destructive ? colors.primary : colors.text}
                  />
                </View>
                <View style={styles.itemText}>
                  <Text style={[styles.itemLabel, item.destructive && styles.itemLabelDanger]}>
                    {item.label}
                  </Text>
                  <Text style={styles.itemHelper}>{item.helper}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.grayIcon} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16,17,22,0.42)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 34,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.line,
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  list: {
    gap: 10,
  },
  item: {
    minHeight: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F7',
  },
  itemIconDanger: {
    backgroundColor: '#FFF0F2',
  },
  itemText: {
    flex: 1,
  },
  itemLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  itemLabelDanger: {
    color: colors.primary,
  },
  itemHelper: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
});
