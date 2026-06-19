import {
  RekognitionClient,
  DetectModerationLabelsCommand,
  DetectFacesCommand,
  type ModerationLabel,
} from '@aws-sdk/client-rekognition';

const client = new RekognitionClient({
  region: process.env.AWS_REGION ?? 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Labels that warrant rejection at ≥75% confidence
const BLOCKED_LABELS = new Set([
  'Explicit Nudity',
  'Nudity',
  'Graphic Male Nudity',
  'Graphic Female Nudity',
  'Sexual Activity',
  'Illustrated Explicit Nudity',
  'Adult Toys',
  'Violence',
  'Graphic Violence Or Gore',
  'Physical Violence',
  'Weapon Violence',
  'Weapons',
  'Self Injury',
]);

const MODERATION_THRESHOLD = 75;
const FACE_CONFIDENCE_THRESHOLD = 90;
const QUALITY_MIN = 20;

export async function checkContentModeration(
  buffer: Buffer,
): Promise<{ passed: boolean; blockedLabel?: string }> {
  try {
    const result = await client.send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: buffer },
        MinConfidence: MODERATION_THRESHOLD,
      }),
    );
    const blocked = (result.ModerationLabels ?? []).find((label: ModerationLabel) =>
      BLOCKED_LABELS.has(label.Name ?? ''),
    );
    if (blocked) return { passed: false, blockedLabel: blocked.Name };
    return { passed: true };
  } catch (err) {
    console.error('[rekognition] checkContentModeration error:', err);
    return { passed: false, blockedLabel: 'service_error' };
  }
}

export async function verifyFacePhoto(
  buffer: Buffer,
): Promise<{ passed: boolean; reason?: string }> {
  const moderation = await checkContentModeration(buffer);
  if (!moderation.passed) {
    return {
      passed: false,
      reason: moderation.blockedLabel === 'service_error' ? 'service_error' : 'content_policy',
    };
  }

  try {
    const result = await client.send(
      new DetectFacesCommand({
        Image: { Bytes: buffer },
        Attributes: ['ALL'],
      }),
    );
    const faces = result.FaceDetails ?? [];

    if (faces.length === 0) return { passed: false, reason: 'no_face' };

    const face = faces[0];
    if ((face.Confidence ?? 0) < FACE_CONFIDENCE_THRESHOLD) {
      return { passed: false, reason: 'low_confidence' };
    }

    const q = face.Quality;
    if (
      q &&
      ((q.Sharpness ?? 100) < QUALITY_MIN || (q.Brightness ?? 100) < QUALITY_MIN)
    ) {
      return { passed: false, reason: 'low_quality' };
    }

    return { passed: true };
  } catch (err) {
    console.error('[rekognition] verifyFacePhoto DetectFaces error:', err);
    return { passed: false, reason: 'service_error' };
  }
}
