import { Router } from 'express';
import { getMySubscription, redeemPromoCode } from '../controllers/subscriptions';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/me', getMySubscription);
router.post('/redeem-code', redeemPromoCode);

export default router;
