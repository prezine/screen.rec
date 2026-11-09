import { describe, expect, it } from 'vitest'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { entitledPlan, readEntitlement } from './entitlement'
import { createPrivateKey, sign } from 'node:crypto'

/** Same format the Toom API signs with (toon-api: src/crypto.ts signEntitlement). */
function signEntitlement(payload: Record<string, unknown>, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), createPrivateKey(privateKeyPem)).toString('base64url')}`
}
import { clampExport, LIMITS, priceLabel } from '@shared/account'

const pair = (): { publicKey: string; privateKey: string } =>
  generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

describe('entitlements (server-signed, checked offline)', () => {
  const { publicKey, privateKey } = pair()
  const now = Math.floor(Date.now() / 1000)
  const key = createPublicKey(publicKey)
  const token = signEntitlement({ sub: 'u1', email: 'a@b.co', plan: 'pro', iat: now, exp: now + 3600 }, privateKey)

  it('reads a token signed by the API', () => {
    expect(readEntitlement(token, key)?.plan).toBe('pro')
    expect(entitledPlan(token, key, 'u1')).toBe('pro')
  })
  it('rejects another user, expiry, tampering and other keys', () => {
    expect(entitledPlan(token, key, 'u2')).toBe('free')
    expect(entitledPlan(token, key, 'u1', (now + 3601) * 1000)).toBe('free')
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'u1', plan: 'pro', exp: now + 9e6 })).toString('base64url')
    expect(readEntitlement(`${forged}.${sig}`, key)).toBeNull()
    expect(readEntitlement(`${body}.${sig}.x`, key)).toBeNull()
    expect(readEntitlement(token, createPublicKey(pair().publicKey))).toBeNull()
    expect(readEntitlement('garbage', key)).toBeNull()
    expect(readEntitlement(token, null)).toBeNull()
  })
})

describe('plan limits', () => {
  it('clamps exports on Free', () => {
    expect(clampExport({ resolution: 2160, fps: 60, quality: 'high' }, 'free')).toEqual({
      resolution: 720,
      fps: 30,
      quality: 'high'
    })
    expect(clampExport({ resolution: 2160, fps: 60 }, 'pro')).toEqual({ resolution: 2160, fps: 60 })
    expect(LIMITS.free.watermark).toBe(true)
    expect(LIMITS.pro.maxRecordingSeconds).toBeNull()
  })
  it('formats prices', () => {
    expect(priceLabel({ id: 'pro-month', interval: 'month', amount: '12.00', currency: 'USD', trialDays: 7 })).toBe(
      '$12/mo'
    )
    expect(priceLabel({ id: 'pro-year', interval: 'year', amount: '95.50', currency: 'USD', trialDays: 0 })).toBe(
      '$95.50/yr'
    )
  })
})
