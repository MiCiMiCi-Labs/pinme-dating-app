import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { blockUser, unblockUser } from '../controllers/blocks';

const router = Router();

router.use(requireAuth);

// POST   /api/v1/blocks               { blockedId }
router.post('/', blockUser);

// DELETE /api/v1/blocks/:blockedUserId
router.delete('/:blockedUserId', unblockUser);

export default router;
