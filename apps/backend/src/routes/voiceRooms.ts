import { Router } from 'express';
import {
  closeVoiceRoom,
  createVoiceRoom,
  getVoiceRoom,
  getVoiceRoomTags,
  joinVoiceRoom,
  leaveVoiceRoom,
  listVoiceRooms,
  muteVoiceRoomParticipant,
} from '../controllers/voiceRooms';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/tags', getVoiceRoomTags);
router.get('/', listVoiceRooms);
router.post('/', createVoiceRoom);
router.get('/:roomId', getVoiceRoom);
router.post('/:roomId/join', joinVoiceRoom);
router.post('/:roomId/leave', leaveVoiceRoom);
router.post('/:roomId/close', closeVoiceRoom);
router.patch('/:roomId/mute', muteVoiceRoomParticipant);

export default router;
