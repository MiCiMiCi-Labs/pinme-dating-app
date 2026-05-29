import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { getMyPhotos, uploadPhoto, deletePhoto } from '../controllers/photos';
import { ALLOWED_TYPES, MAX_FILE_SIZE } from '../lib/storage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Only jpeg, png, webp are allowed`));
    }
  },
});

const router = Router();

router.use(requireAuth);

// GET  /api/v1/photos/me
router.get('/me', getMyPhotos);

// POST /api/v1/photos  (multipart/form-data, field: "photo")
router.post('/', upload.single('photo'), uploadPhoto);

// DELETE /api/v1/photos/:photoId
router.delete('/:photoId', deletePhoto);

export default router;
