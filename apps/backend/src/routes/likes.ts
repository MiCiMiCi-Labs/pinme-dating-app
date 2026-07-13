import { Router } from 'express';
import { getLikesList, getLikesPreview } from '../controllers/likes';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/me/preview', getLikesPreview);
router.get('/me', getLikesList);

export default router;
