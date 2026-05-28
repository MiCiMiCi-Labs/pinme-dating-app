import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/me', requireAuth, (req, res) => {
  return res.json({
    user: req.authUser,
  });
});

export default router;
