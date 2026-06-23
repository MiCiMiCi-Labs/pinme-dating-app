import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  getMessages,
  markMessagesRead,
  sendMessage,
  uploadImageMessage,
  uploadVideoMessage,
  uploadVoiceMessage,
} from '../controllers/messages';
import {
  ALLOWED_AUDIO_TYPES,
  ALLOWED_CHAT_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_FILE_SIZE,
  MAX_VIDEO_SIZE,
  MAX_VOICE_SIZE,
} from '../lib/storage';

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

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_CHAT_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_VIDEO_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

function withUpload(
  upload: multer.Multer,
  field: string,
  handler: (req: Request, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File too large' });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      if (err) {
        res.status(400).json({ error: err.message });
        return;
      }
      handler(req, res).catch(next);
    });
  };
}

const router = Router();

router.use(requireAuth);

// GET /api/v1/messages/:matchId?limit=50&before=2026-05-30T00:00:00.000Z
router.get('/:matchId', getMessages);

// POST /api/v1/messages/:matchId  { content, messageType?: TEXT | IMAGE | GIF }
router.post('/:matchId', sendMessage);

// POST /api/v1/messages/:matchId/voice  (multipart/form-data, field: "audio")
router.post('/:matchId/voice', withUpload(audioUpload, 'audio', uploadVoiceMessage));

// POST /api/v1/messages/:matchId/image  (multipart/form-data, field: "image")
router.post('/:matchId/image', withUpload(imageUpload, 'image', uploadImageMessage));

// POST /api/v1/messages/:matchId/video  (multipart/form-data, field: "video")
router.post('/:matchId/video', withUpload(videoUpload, 'video', uploadVideoMessage));

// POST /api/v1/messages/:matchId/read
router.post('/:matchId/read', markMessagesRead);

export default router;
