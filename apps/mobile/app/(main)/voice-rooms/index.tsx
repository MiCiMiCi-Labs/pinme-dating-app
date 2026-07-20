import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, IconButton, photos, ProfileThumb } from '@/design/system';
import {
  createVoiceRoom,
  getVoiceRooms,
  getVoiceRoomTags,
  type VoiceRoom,
} from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { $voiceRoom, markVoiceRoomRefreshHandled } from '@/stores/voiceRoom.store';

function getOwnerPhoto(room: VoiceRoom) {
  const primary = room.owner.photos.find(photo => photo.isPrimary) ?? room.owner.photos[0];
  return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : photos.redhead;
}

export default function VoiceRoomsScreen() {
const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const tagsRef = useRef<string[]>([]);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadRooms = useCallback(async ({
    showSpinner = true,
    search = query,
    tag = activeTag,
    cursor = null,
    append = false,
  }: {
    showSpinner?: boolean;
    search?: string;
    tag?: string | null;
    cursor?: string | null;
    append?: boolean;
  } = {}) => {
    if (append) {
      setLoadingMore(true);
    } else if (showSpinner && !hasLoadedRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setRooms([]);
        return;
      }

      const [roomsResponse, tagsResponse] = await Promise.all([
        getVoiceRooms(session.access_token, {
          search,
          tag,
          cursor,
          limit: 20,
        }),
        tagsRef.current.length ? Promise.resolve({ tags: tagsRef.current }) : getVoiceRoomTags(session.access_token),
      ]);
      setRooms(current => {
        if (!append) return roomsResponse.rooms;

        const roomMap = new Map(current.map(room => [room.id, room]));
        roomsResponse.rooms.forEach(room => roomMap.set(room.id, room));
        return Array.from(roomMap.values());
      });
      setNextCursor(roomsResponse.nextCursor);
      setHasMore(roomsResponse.hasMore);
      tagsRef.current = tagsResponse.tags;
      setTags(tagsResponse.tags);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice rooms');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [activeTag, query]);

  useFocusEffect(
    useCallback(() => {
      loadRooms({ showSpinner: !hasLoadedRef.current });
    }, [loadRooms])
  );

  useEffect(() => {
    if (!hasLoadedRef.current) return;

    const timer = setTimeout(() => {
      loadRooms({ showSpinner: false, search: query, tag: activeTag });
    }, 350);

    return () => clearTimeout(timer);
  }, [activeTag, loadRooms, query]);

  useEffect(() => {
    const unsubscribe = $voiceRoom.subscribe((voiceRoom) => {
      if (!voiceRoom.voiceRoomNeedsRefresh) return;
      loadRooms({ showSpinner: false });
      markVoiceRoomRefreshHandled();
    });

    return unsubscribe;
  }, [loadRooms]);

  const canCreate = roomName.trim().length >= 2 && selectedTags.length > 0;

  const toggleTag = (tag: string) => {
    setSelectedTags(current => {
      if (current.includes(tag)) return current.filter(item => item !== tag);
      if (current.length >= 3) return current;
      return [...current, tag];
    });
  };

  const handleCreate = async () => {
    if (!canCreate || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { room } = await createVoiceRoom(session.access_token, {
        name: roomName.trim(),
        tags: selectedTags,
      });

      setCreateOpen(false);
      setRoomName('');
      setSelectedTags([]);
      setRooms(current => [room, ...current.filter(item => item.id !== room.id)]);
      router.push({ pathname: '/(main)/voice-rooms/[roomId]', params: { roomId: room.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setSubmitting(false);
    }
  };

  const roomRows = useMemo(() => rooms, [rooms]);

  const loadMoreRooms = () => {
    if (!hasMore || !nextCursor || loadingMore || loading) return;
    loadRooms({
      showSpinner: false,
      search: query,
      tag: activeTag,
      cursor: nextCursor,
      append: true,
    });
  };

  const handleRoomsScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    if (distanceFromBottom < 260) {
      loadMoreRooms();
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={handleRoomsScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadRooms({ showSpinner: false });
            }}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Voice Rooms</Text>
            <Text style={styles.subtitle}>Find a room by name or ID</Text>
          </View>
          <IconButton icon="add" onPress={() => setCreateOpen(true)} />
        </View>

        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={colors.grayIcon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => loadRooms({ showSpinner: false, search: query, tag: activeTag })}
            placeholder="Search by room name or ID"
            placeholderTextColor={colors.grayIcon}
            style={styles.searchInput}
            returnKeyType="search"
          />
          <Pressable onPress={() => loadRooms({ showSpinner: false, search: query, tag: activeTag })} hitSlop={8}>
            <Ionicons name="arrow-forward-circle" size={24} color={colors.primary} />
          </Pressable>
        </View>

        {tags.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterTags}
          >
            <Pressable
              style={[styles.filterTag, activeTag === null && styles.filterTagActive]}
              onPress={() => setActiveTag(null)}
            >
              <Text style={[styles.filterTagText, activeTag === null && styles.filterTagTextActive]}>
                All
              </Text>
            </Pressable>
            {tags.map(tag => {
              const selected = activeTag === tag;
              return (
                <Pressable
                  key={tag}
                  style={[styles.filterTag, selected && styles.filterTagActive]}
                  onPress={() => setActiveTag(selected ? null : tag)}
                >
                  <Text style={[styles.filterTagText, selected && styles.filterTagTextActive]}>
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : roomRows.length ? (
          <View style={styles.grid}>
            {roomRows.map(room => (
              <Pressable
                key={room.id}
                style={styles.roomCard}
                onPress={() => router.push({ pathname: '/(main)/voice-rooms/[roomId]', params: { roomId: room.id } })}
              >
                <View style={styles.cardTop}>
                  <ProfileThumb uri={getOwnerPhoto(room)} size={44} />
                  <Text style={styles.countText}>{room.participantCount} online</Text>
                </View>
                <View style={styles.tagCover}>
                  {room.tags.slice(0, 3).map(tag => (
                    <Text key={`${room.id}-${tag}`} style={styles.coverTag} numberOfLines={1}>{tag}</Text>
                  ))}
                </View>
                <Text style={styles.roomName} numberOfLines={2}>{room.name}</Text>
                <Text style={styles.roomId} numberOfLines={1}>ID {room.id.slice(0, 8)}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>No voice rooms yet</Text>
            <Text style={styles.emptyCopy}>Create a room and invite people to talk.</Text>
          </View>
        )}

        {loadingMore ? (
          <View style={styles.loadingMore}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.loadingMoreText}>Loading more rooms...</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.createSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Create voice room</Text>
              <Pressable onPress={() => setCreateOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.grayIcon} />
              </Pressable>
            </View>

            <TextInput
              value={roomName}
              onChangeText={setRoomName}
              placeholder="Room name"
              placeholderTextColor={colors.grayIcon}
              style={styles.nameInput}
              maxLength={40}
            />

            <Text style={styles.tagHint}>Choose 1-3 tags</Text>
            <ScrollView contentContainerStyle={styles.tagPicker} showsVerticalScrollIndicator={false}>
              {tags.map(tag => {
                const selected = selectedTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={[styles.tagOption, selected && styles.tagOptionActive]}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={[styles.tagOptionText, selected && styles.tagOptionTextActive]} numberOfLines={1}>
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              style={[styles.createButton, (!canCreate || submitting) && styles.buttonDisabled]}
              onPress={handleCreate}
              disabled={!canCreate || submitting}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.createButtonText}>Create room</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  search: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 24,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  filterTags: {
    gap: 8,
    paddingTop: 14,
    paddingRight: 8,
  },
  filterTag: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTagActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF0F3',
  },
  filterTagText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  filterTagTextActive: {
    color: colors.primary,
  },
  errorText: {
    color: colors.primary,
    fontSize: 13,
    marginTop: 12,
  },
  centerState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 22,
  },
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  loadingMoreText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  roomCard: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    justifyContent: 'space-between',
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  tagCover: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  coverTag: {
    minWidth: 58,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFF0F3',
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 8,
    textAlign: 'center',
  },
  roomName: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  roomId: {
    color: colors.grayIcon,
    fontSize: 11,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17,24,39,0.36)',
  },
  createSheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 34,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  nameInput: {
    height: 54,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  tagHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  tagPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 18,
  },
  tagOption: {
    minWidth: 86,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tagOptionActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF0F3',
  },
  tagOptionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  tagOptionTextActive: {
    color: colors.primary,
  },
  createButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
});
