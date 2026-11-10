// This computer's ID for the Toom API: a SHA-256 of its hardware UUID, so the raw ID never leaves
// the machine. The API uses it for one-trial-per-person rules (see toom-api/src/devices.ts).
//
//   macOS    IOPlatformUUID (the logic board's UUID; survives reinstalls and new accounts)
//   Windows  the SMBIOS system UUID, else MachineGuid from the registry
//   Linux    /etc/machine-id
//
// If none can be read, a random ID is kept in Toom's data folder, which is weaker (deleting the
// folder makes a new one) but still better than nothing.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out)))
  )

const clean = (v: string | undefined | null): string | null => {
  const s = (v ?? '').trim().toLowerCase()
  // all-zero / all-F UUIDs come from boards that don't set one
  if (!s || /^[0f-]+$/.test(s) || s.length < 8) return null
  return s
}

async function hardwareUuid(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const out = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
    return clean(/"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1])
  }
  if (process.platform === 'win32') {
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID'
    ])
    const smbios = clean(ps)
    if (smbios) return smbios
    const reg = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
    return clean(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(reg)?.[1])
  }
  for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    const id = clean(await fs.readFile(f, 'utf8').catch(() => ''))
    if (id) return id
  }
  return null
}

async function fallbackId(): Promise<string> {
  const file = join(app.getPath('userData'), 'device-id')
  const saved = (await fs.readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f-]{36}$/.test(saved)) return saved
  const id = randomUUID()
  await fs.writeFile(file, id, { mode: 0o600 }).catch(() => undefined)
  return id
}

let cached: Promise<string> | null = null

/** 64 hex characters, the same on every launch of this computer. */
export function deviceId(): Promise<string> {
  cached ??= (async () => {
    const raw = (await hardwareUuid()) ?? `fallback:${await fallbackId()}`
    return createHash('sha256').update(`toom-device-v1|${process.platform}|${raw}`).digest('hex')
  })()
  return cached
}
