import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import type { AiPipeline } from './services/aiPipeline.js';
import type { SessionLanguage } from './services/contextManager.js';
import type { SubscriptionService } from './services/subscriptionService.js';

const MAX_VOICE_RECORDING_BYTES = 1024 * 1024;
const CARTESIA_CLONE_AUDIO_TYPES = [
  'audio/flac',
  'audio/mpeg',
  'audio/mpga',
  'audio/ogg',
  'audio/oga',
  'audio/wav',
  'audio/webm',
];

interface VoiceRoutesOptions {
  env: NodeJS.ProcessEnv;
  pipeline: AiPipeline;
  subscriptionService: SubscriptionService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLanguage(value: unknown): value is SessionLanguage {
  return value === 'es' || value === 'en';
}

function isValidVoiceUserId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function isSupportedCartesiaAudioType(value: string): boolean {
  const contentType = value.split(';', 1)[0]?.trim().toLowerCase();
  return CARTESIA_CLONE_AUDIO_TYPES.includes(contentType ?? '');
}

function getBearerToken(request: Request): string | null {
  const authorization = request.get('authorization');
  if (!authorization) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function registerVoiceRoutes(
  app: Express,
  { env, pipeline, subscriptionService }: VoiceRoutesOptions,
): void {
  const jsonParser = express.json({ limit: '100kb' });
  const audioParser = express.raw({
    type: 'audio/*',
    limit: MAX_VOICE_RECORDING_BYTES,
  });

  const authenticateVoiceUser = async (
    request: Request,
    response: Response,
    userId: string,
  ): Promise<boolean> => {
    if (!subscriptionService.isPersistent) {
      return true;
    }

    const user = await subscriptionService.authenticateAudioUser(
      getBearerToken(request),
    );
    if (!user) {
      response.status(401).json({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Sign in before changing your voice.',
        },
      });
      return false;
    }
    if (user.id !== userId) {
      response.status(403).json({
        error: {
          code: 'VOICE_USER_MISMATCH',
          message: 'You can only change the voice on your own account.',
        },
      });
      return false;
    }
    return true;
  };

  app.get('/api/voice', async (request: Request, response: Response) => {
    const userId = request.query.userId;
    if (!isValidVoiceUserId(userId)) {
      response.status(400).json({
        error: {
          code: 'INVALID_USER_ID',
          message: 'Provide a valid userId query parameter.',
        },
      });
      return;
    }
    if (!(await authenticateVoiceUser(request, response, userId))) {
      return;
    }

    try {
      const voiceId = await subscriptionService.getCartesiaVoiceId(userId);
      const clonedVoiceId =
        await subscriptionService.getClonedCartesiaVoiceId(userId);
      const maleVoiceId = env.CARTESIA_VOICE_MALE_ID?.trim();
      const femaleVoiceId = env.CARTESIA_VOICE_FEMALE_ID?.trim();
      const voiceType =
        voiceId && voiceId === maleVoiceId
          ? 'male'
          : voiceId && voiceId === femaleVoiceId
            ? 'female'
            : voiceId && voiceId === clonedVoiceId
              ? 'cloned'
              : null;
      response.status(200).json({
        voiceId,
        voiceType,
        hasClonedVoice: Boolean(clonedVoiceId),
      });
    } catch {
      response.status(503).json({
        error: {
          code: 'VOICE_PROFILE_READ_FAILED',
          message: 'The saved voice could not be loaded.',
        },
      });
    }
  });

  app.post(
    '/api/voice/select',
    (request, response, next) => {
      jsonParser(request, response, (error: unknown) => {
        if (error) {
          const isTooLarge =
            isRecord(error) && typeof error.status === 'number' && error.status === 413;
          response.status(isTooLarge ? 413 : 400).json({
            error: {
              code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
              message: isTooLarge
                ? 'Voice selection payload exceeds the 100 KB limit.'
                : 'Request body must be valid JSON.',
            },
          });
          return;
        }
        next();
      });
    },
    async (request: Request, response: Response) => {
      const input = request.body;
      const userId = isRecord(input) ? input.userId : undefined;
      const voice = isRecord(input) ? input.voice : undefined;
      if (
        !isValidVoiceUserId(userId) ||
        (voice !== 'male' && voice !== 'female' && voice !== 'cloned')
      ) {
        response.status(422).json({
          error: {
            code: 'INVALID_VOICE_SELECTION',
            message: 'Provide a userId and select male, female, or cloned.',
          },
        });
        return;
      }
      if (!(await authenticateVoiceUser(request, response, userId))) {
        return;
      }

      let voiceId: string | null;
      if (voice === 'cloned') {
        try {
          voiceId = await subscriptionService.getClonedCartesiaVoiceId(userId);
        } catch {
          response.status(503).json({
            error: {
              code: 'VOICE_PROFILE_READ_FAILED',
              message: 'The saved cloned voice could not be loaded.',
            },
          });
          return;
        }
        if (!voiceId) {
          response.status(404).json({
            error: {
              code: 'CLONED_VOICE_NOT_FOUND',
              message: 'Record a voice clone before selecting it.',
            },
          });
          return;
        }
      } else {
        const configuredVoiceId =
          voice === 'male'
            ? env.CARTESIA_VOICE_MALE_ID?.trim()
            : env.CARTESIA_VOICE_FEMALE_ID?.trim();
        if (!configuredVoiceId) {
          response.status(503).json({
            error: {
              code: 'VOICE_NOT_CONFIGURED',
              message: `The ${voice} Cartesia voice is not configured.`,
            },
          });
          return;
        }
        voiceId = configuredVoiceId;
      }

      try {
        await subscriptionService.activateCartesiaVoiceId(userId, voiceId);
      } catch {
        response.status(503).json({
          error: {
            code: 'VOICE_PROFILE_SAVE_FAILED',
            message: 'The selected voice could not be saved.',
          },
        });
        return;
      }
      response.status(200).json({
        voiceId,
        voiceType: voice,
        status: 'active',
      });
    },
  );

  app.post(
    '/api/voice/clone',
    (request, response, next) => {
      audioParser(request, response, (error: unknown) => {
        if (error) {
          const isTooLarge =
            isRecord(error) && typeof error.status === 'number' && error.status === 413;
          response.status(isTooLarge ? 413 : 400).json({
            error: {
              code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_AUDIO',
              message: isTooLarge
                ? 'Voice recording exceeds the 1 MB limit.'
                : 'Voice recording must be valid audio.',
            },
          });
          return;
        }
        next();
      });
    },
    async (request: Request, response: Response) => {
      const userId = request.query.userId;
      const language = request.query.language;
      const audioMimeType = request.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
      if (
        !isValidVoiceUserId(userId) ||
        !isLanguage(language) ||
        !isSupportedCartesiaAudioType(audioMimeType) ||
        !Buffer.isBuffer(request.body) ||
        request.body.length === 0
      ) {
        response.status(422).json({
          error: {
            code: 'INVALID_VOICE_RECORDING',
            message:
              'Provide a non-empty supported audio recording, userId, and language.',
          },
        });
        return;
      }
      if (!(await authenticateVoiceUser(request, response, userId))) {
        return;
      }

      let voiceId: string;
      const isSandbox = !env.CARTESIA_API_KEY?.trim();
      if (isSandbox) {
        voiceId = `sandbox-${randomUUID()}`;
      } else {
        if (!pipeline.cloneVoice) {
          response.status(503).json({
            error: {
              code: 'VOICE_CLONING_UNAVAILABLE',
              message: 'Cartesia voice cloning is not available on this server.',
            },
          });
          return;
        }
        try {
          voiceId = await pipeline.cloneVoice(
            request.body,
            audioMimeType,
            `BridgeTalk voice ${userId.slice(0, 8)}`,
            language,
          );
        } catch {
          response.status(502).json({
            error: {
              code: 'VOICE_CLONE_FAILED',
              message: 'Cartesia could not create the voice clone.',
            },
          });
          return;
        }
      }

      try {
        await subscriptionService.saveCartesiaVoiceId(userId, voiceId);
      } catch {
        response.status(503).json({
          error: {
            code: 'VOICE_PROFILE_SAVE_FAILED',
            message: 'The cloned voice could not be saved to your profile.',
          },
        });
        return;
      }
      response.status(200).json({
        voiceId,
        voiceType: 'cloned',
        status: isSandbox ? 'sandbox' : 'active',
      });
    },
  );
}
