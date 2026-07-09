import { StyleSheet } from 'react-native';
import { colors } from '@/design/system';

export const chatStyles = StyleSheet.create({
  messageBlock: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
  },
  messageMine: {
    alignSelf: 'flex-end',
  },
  bubble: {
    borderRadius: 12,
    padding: 16,
  },
  bubbleOther: {
    backgroundColor: colors.soft,
  },
  bubbleMine: {
    backgroundColor: '#F3F3F5',
  },
  bubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTime: {
    color: colors.grayIcon,
    fontSize: 12,
    marginTop: 6,
  },
  timeMine: {
    textAlign: 'right',
    color: colors.primary,
  },
  recalledBubble: {
    opacity: 0.6,
  },
  recalledText: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  reactionChipMine: {
    borderColor: colors.primary,
    backgroundColor: '#FFF0F0',
  },
  reactionChipText: {
    fontSize: 13,
    color: colors.text,
  },
  replyQuote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  replyQuoteAccent: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 14,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyQuoteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
  replyQuoteWrapper: {
    paddingBottom: 2,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  statusRowMine: {
    justifyContent: 'flex-end',
  },
  statusSpinner: {
    transform: [{ scale: 0.55 }],
  },
  statusSendingText: {
    color: colors.muted,
    fontSize: 11,
  },
  statusFailedText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
  voiceBubble: {
    flexDirection: 'column',
    minWidth: 160,
    gap: 6,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  voiceInfo: {
    flex: 1,
    gap: 4,
  },
  voiceWave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  voiceBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.grayIcon,
  },
  voiceBarActive: {
    backgroundColor: colors.primary,
  },
  voiceDuration: {
    color: colors.muted,
    fontSize: 11,
  },
  imageBubble: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  videoBubble: {
    width: 200,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
  },
  videoOverlay: {
    alignItems: 'center',
    gap: 6,
  },
  videoDuration: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  gifContainer: {
    width: 180,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.soft,
  },
  gifBubble: {
    width: '100%',
    height: '100%',
  },
  gifBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gifBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
