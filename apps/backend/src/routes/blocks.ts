import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { blockUser, getBlockedUsers, unblockUser } from '../controllers/blocks';

const router = Router();

router.use(requireAuth);

// GET    /api/v1/blocks
router.get('/', getBlockedUsers);

// POST   /api/v1/blocks               { blockedId }
router.post('/', blockUser);

// DELETE /api/v1/blocks/:blockedUserId
router.delete('/:blockedUserId', unblockUser);

export default router;
