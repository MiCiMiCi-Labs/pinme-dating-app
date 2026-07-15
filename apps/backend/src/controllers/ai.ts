import { Request, Response } from 'express';
import { z } from 'zod';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';
import { hasBlockBetween } from '../lib/safety';

const replySuggestionsSchema = z
  .object({
    matchId: z.string().uuid(),
    tone: z.enum(['warm', 'playful', 'curious']).default('warm'),
  })
  .strict();

const toneGuides = {
  warm: {
    label: 'Warm',
    instruction: 'Kind, emotionally attentive, relaxed, and sincere. Avoid sounding too intense.',
  },
  playful: {
    label: 'Playful',
    instruction: 'Light, charming, and gently teasing. Avoid sexual, pushy, or overly confident language.',
  },
  curious: {
    label: 'Curious',
    instruction: 'Thoughtful and question-led. Ask a natural follow-up that helps the conversation continue.',
  },
} as const;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

function compactProfile(user: {
  name: string;
  birthday: Date;
  bio: string | null;
  city: string | null;
  profile: {
    jobTitle: string | null;
    education: string | null;
    relationshipGoal: string | null;
    interests: string[];
    prompt1Question: string | null;
    prompt1: string | null;
    prompt2Question: string | null;
    prompt2: string | null;
    prompt3Question: string | null;
    prompt3: string | null;
  } | null;
}) {
  const profile = user.profile;
  const prompts = [
    profile?.prompt1Question && profile.prompt1 ? `${profile.prompt1Question}: ${profile.prompt1}` : null,
    profile?.prompt2Question && profile.prompt2 ? `${profile.prompt2Question}: ${profile.prompt2}` : null,
    profile?.prompt3Question && profile.prompt3 ? `${profile.prompt3Question}: ${profile.prompt3}` : null,
  ].filter(Boolean);

  return {
    name: user.name,
    age: calculateAge(user.birthday),
    city: user.city,
    bio: user.bio,
    jobTitle: profile?.jobTitle ?? null,
    education: profile?.education ?? null,
    relationshipGoal: profile?.relationshipGoal ?? null,
    interests: profile?.interests?.slice(0, 8) ?? [],
    prompts,
  };
}

function parseSuggestions(raw: string): string[] {
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  const json = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;

  try {
    const parsed = JSON.parse(json) as { suggestions?: unknown };
    if (!Array.isArray(parsed.suggestions)) return [];

    return parsed.suggestions
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateReplySuggestions(req: Request, res: Response) {
  try {
    const parsedBody = replySuggestionsSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        error: 'Invalid AI reply request',
        details: parsedBody.error.flatten().fieldErrors,
      });
      return;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'AI reply assistant is not configured' });
      return;
    }

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: parsedBody.data.matchId },
      include: {
        user1: {
          include: {
            profile: true,
          },
        },
        user2: {
          include: {
            profile: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 16,
          include: {
            sender: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.user1Id !== dbUserId && match.user2Id !== dbUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (match.unmatchedAt) {
      res.status(409).json({ error: 'Cannot generate replies for an unmatched chat' });
      return;
    }

    const otherUserId = match.user1Id === dbUserId ? match.user2Id : match.user1Id;
    if (await hasBlockBetween(dbUserId, otherUserId)) {
      res.status(403).json({ error: 'Cannot generate replies for this chat' });
      return;
    }

    const me = match.user1Id === dbUserId ? match.user1 : match.user2;
    const other = match.user1Id === dbUserId ? match.user2 : match.user1;
    const toneGuide = toneGuides[parsedBody.data.tone];
    const recentMessages = match.messages
      .reverse()
      .map(message => ({
        from: message.senderId === null
          ? 'system'
          : message.senderId === dbUserId
            ? 'me'
            : other.name,
        type: message.messageType,
        content: message.content,
      }));

    const model = process.env.GROQ_MODEL ?? 'qwen/qwen3-32b';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              'You are a dating app reply assistant. Write respectful, natural, short reply suggestions that sound human. Do not be manipulative, sexual, pushy, or overconfident. Do not include reasoning. Return only valid JSON: {"suggestions":["...", "...", "..."]}.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              tone: {
                value: parsedBody.data.tone,
                label: toneGuide.label,
                instruction: toneGuide.instruction,
              },
              myProfile: compactProfile(me),
              theirProfile: compactProfile(other),
              recentMessages,
              rules: [
                'Generate exactly 3 options.',
                'Each option should be one sentence or two short sentences.',
                'Prefer asking a light follow-up question if it fits.',
                'Do not mention that AI wrote the message.',
              ],
            }),
          },
        ],
      }),
    });

    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;

    if (!response.ok) {
      console.error('[generateReplySuggestions] Groq error:', data?.error?.message ?? response.statusText);
      res.status(502).json({ error: 'Failed to generate reply suggestions' });
      return;
    }

    const content = data?.choices?.[0]?.message?.content;
    const suggestions = content ? parseSuggestions(content) : [];

    if (suggestions.length === 0) {
      res.status(502).json({ error: 'AI returned no usable suggestions' });
      return;
    }

    res.json({ suggestions });
  } catch (err) {
    console.error('[generateReplySuggestions] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
