import { Text, View } from 'react-native';
import { type ReplyPreview } from '@/lib/api';
import { chatStyles } from './chatStyles';
import { getReplyPreviewText } from './chatUtils';

export function ReplyQuote({ preview, maxLines = 1 }: { preview: ReplyPreview; maxLines?: number }) {
  return (
    <View style={chatStyles.replyQuote}>
      <View style={chatStyles.replyQuoteAccent} />
      <Text style={chatStyles.replyQuoteText} numberOfLines={maxLines}>
        {getReplyPreviewText(preview)}
      </Text>
    </View>
  );
}
