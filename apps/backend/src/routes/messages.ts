import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  getMessages,
  markMessagesRead,
  sendMessage,
  uploadVoiceMessage,
} from '../controllers/messages';
import { ALLOWED_AUDIO_TYPES, MAX_VOICE_SIZE } from '../lib/storage';

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AUDIO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

const router = Router();

router.use(requireAuth);

// GET /api/v1/messages/:matchId?limit=50&before=2026-05-30T00:00:00.000Z
router.get('/:matchId', getMessages);

// POST /api/v1/messages/:matchId  { content, messageType?: TEXT | IMAGE | GIF }
router.post('/:matchId', sendMessage);

// POST /api/v1/messages/:matchId/voice  (multipart/form-data, field: "audio")
router.post('/:matchId/voice', audioUpload.single('audio'), uploadVoiceMessage);

// POST /api/v1/messages/:matchId/read
router.post('/:matchId/read', markMessagesRead);

export default router;
