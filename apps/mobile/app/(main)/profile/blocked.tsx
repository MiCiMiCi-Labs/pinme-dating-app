import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, IconButton } from '@/design/system';
import { getBlockedUsers, unblockUser, type Block } from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/stores/toast.store';

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function BlockedUsersScreen() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const result = await getBlockedUsers(token);
      setBlocks(result.blocks);
    } catch (error) {
      Alert.alert('Blocked users error', error instanceof Error ? error.message : 'Failed to load blocked users.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmUnblock(block: Block) {
    const user = block.blocked;
    Alert.alert(
      'Unblock user?',
      user ? `${user.name} may appear in discovery again.` : 'This user may appear in discovery again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: () => handleUnblock(block),
        },
      ]
    );
  }

  async function handleUnblock(block: Block) {
    const token = await getToken();
    if (!token) return;

    setBusyId(block.blockedId);
    try {
      await unblockUser(token, block.blockedId);
      setBlocks(current => current.filter(item => item.blockedId !== block.blockedId));
      showToast('User unblocked', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to unblock user.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Blocked users</Text>
          <Text style={styles.subtitle}>People you have hidden from your app</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={blocks}
        keyExtractor={item => item.id}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Ionicons name="shield-checkmark-outline" size={34} color={colors.primary} />
                <Text style={styles.emptyTitle}>No blocked users</Text>
                <Text style={styles.emptySubtext}>Blocked profiles will appear here.</Text>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const user = item.blocked;
          const photo = user?.photos?.[0];
          const photoUrl = photo ? getDisplayPhotoUrl(photo, 'thumbnail') : '';
          const busy = busyId === item.blockedId;

          return (
            <View style={styles.row}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={22} color={colors.grayIcon} />
                </View>
              )}
              <View style={styles.userText}>
                <Text style={styles.name}>{user?.name ?? 'Blocked user'}</Text>
                <Text style={styles.meta}>{user?.city ?? 'Hidden from discovery and chat'}</Text>
              </View>
              <Pressable
                style={[styles.unblockButton, busy && styles.unblockButtonBusy]}
                disabled={busy}
                onPress={() => confirmUnblock(item)}
              >
                <Text style={styles.unblockText}>{busy ? '...' : 'Unblock'}</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 34,
  },
  row: {
    minHeight: 76,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.line,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userText: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  unblockButton: {
    borderRadius: 16,
    backgroundColor: colors.soft,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  unblockButtonBusy: {
    opacity: 0.6,
  },
  unblockText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  emptyState: {
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
