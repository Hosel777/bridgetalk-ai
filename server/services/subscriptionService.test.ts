import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSubscriptionService,
  type SubscriptionProfile,
} from './subscriptionService.js';

const starterProfile: SubscriptionProfile = {
  id: 'user-123',
  email: 'candidate@example.com',
  plan: 'free_trial',
  paddle_customer_id: null,
  paddle_subscription_id: null,
  cartesia_voice_id: null,
  cartesia_cloned_voice_id: null,
  minutes_used: 0,
  minutes_limit: 15,
};

test('uses the in-memory free-trial profile when Supabase is not configured', async () => {
  const service = createSubscriptionService({ env: {} });

  assert.equal(service.isPersistent, false);
  assert.equal(await service.canUseAudioStream('demo-local'), true);
  assert.deepEqual(await service.getProfile('demo-local'), {
    ...starterProfile,
    id: 'demo-local',
    email: '',
  });
});

test('rounds each started session minute up and blocks at the configured limit', async () => {
  const service = createSubscriptionService({
    env: {},
    initialProfiles: [starterProfile],
  });

  await service.recordConsumedMinutes('user-123', 61);

  assert.equal((await service.getProfile('user-123'))?.minutes_used, 2);
  assert.equal(await service.canUseAudioStream('user-123'), true);

  await service.recordConsumedMinutes('user-123', 13 * 60);

  assert.equal((await service.getProfile('user-123'))?.minutes_used, 15);
  assert.equal(await service.canUseAudioStream('user-123'), false);
});

test('activates Pro only when the signed Paddle email matches the profile', async () => {
  const service = createSubscriptionService({
    env: {},
    initialProfiles: [starterProfile],
  });

  const mismatchedEmailResult = await service.activateProForPaddle({
    userId: 'user-123',
    email: 'attacker@example.com',
    customerId: 'ctm_123',
    subscriptionId: 'sub_123',
  });
  assert.equal(mismatchedEmailResult, false);
  assert.equal((await service.getProfile('user-123'))?.plan, 'free_trial');

  const activated = await service.activateProForPaddle({
    userId: 'user-123',
    email: 'CANDIDATE@example.com',
    customerId: 'ctm_123',
    subscriptionId: 'sub_123',
  });
  const profile = await service.getProfile('user-123');

  assert.equal(activated, true);
  assert.equal(profile?.plan, 'pro');
  assert.equal(profile?.minutes_limit, 900);
  assert.equal(profile?.paddle_customer_id, 'ctm_123');
  assert.equal(profile?.paddle_subscription_id, 'sub_123');
});

test('allows an activated subscription without email only for its previously linked Paddle customer', async () => {
  const service = createSubscriptionService({
    env: {},
    initialProfiles: [
      {
        ...starterProfile,
        paddle_customer_id: 'ctm_123',
      },
    ],
  });

  const matchingCustomer = await service.activateProForPaddle({
    userId: 'user-123',
    email: null,
    customerId: 'ctm_123',
    subscriptionId: 'sub_456',
  });
  const differentCustomer = await service.activateProForPaddle({
    userId: 'user-123',
    email: null,
    customerId: 'ctm_attacker',
    subscriptionId: 'sub_789',
  });

  assert.equal(matchingCustomer, true);
  assert.equal(differentCustomer, false);
  assert.equal(
    (await service.getProfile('user-123'))?.paddle_subscription_id,
    'sub_456',
  );
});

test('stores and retrieves a Cartesia voice ID in the in-memory profile', async () => {
  const service = createSubscriptionService({
    env: {},
    initialProfiles: [starterProfile],
  });

  assert.equal(await service.getCartesiaVoiceId('user-123'), null);
  await service.saveCartesiaVoiceId('user-123', 'cloned-voice-id');

  assert.equal(
    await service.getCartesiaVoiceId('user-123'),
    'cloned-voice-id',
  );
  assert.equal(
    (await service.getProfile('user-123'))?.cartesia_voice_id,
    'cloned-voice-id',
  );
  await service.activateCartesiaVoiceId('user-123', 'male-voice-id');

  assert.equal(await service.getCartesiaVoiceId('user-123'), 'male-voice-id');
  assert.equal(
    await service.getClonedCartesiaVoiceId('user-123'),
    'cloned-voice-id',
  );
});
