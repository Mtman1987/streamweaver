#!/usr/bin/env node

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const env = { ...process.env }
const PERSIST_ROOT = env.PERSIST_ROOT || '/data/runtime'
const PERSISTED_DIRS = ['logs', 'tmp', 'config', 'tokens', 'actions', 'commands', 'data', 'MasterStats']

;(async() => {
  ensurePersistentDirs()
  seedRuntimeSnapshot()
  seedTenantDiscordConfig()

  if (process.argv.slice(-2).join(' ') === 'node server.js') {
    await exec(`node ${path.join('scripts', 'bootstrap-runtime.js')}`)
  }

  await exec(process.argv.slice(2).join(' '))
})()

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}

function ensurePersistentDirs() {
  fs.mkdirSync(PERSIST_ROOT, { recursive: true })
  fs.mkdirSync(path.join(PERSIST_ROOT, 'global'), { recursive: true })
  fs.mkdirSync(path.join(PERSIST_ROOT, 'global', 'pokemon-users'), { recursive: true })
  fs.mkdirSync(path.join(PERSIST_ROOT, 'global', 'MasterStats'), { recursive: true })
  fs.mkdirSync(path.join(PERSIST_ROOT, 'tenants'), { recursive: true })

  for (const dir of PERSISTED_DIRS) {
    const appPath = path.join(process.cwd(), dir)
    const persistentPath = path.join(PERSIST_ROOT, dir)

    fs.mkdirSync(persistentPath, { recursive: true })

    if (fs.existsSync(appPath) && !fs.lstatSync(appPath).isSymbolicLink()) {
      seedPersistentDir(appPath, persistentPath)
      fs.rmSync(appPath, { recursive: true, force: true })
    }

    if (!fs.existsSync(appPath)) {
      fs.symlinkSync(persistentPath, appPath, 'junction')
    }
  }
}

function seedRuntimeSnapshot() {
  const bundledRuntimeRoot = path.join(process.cwd(), 'data', 'runtime')
  const bundledGlobalRoot = path.join(bundledRuntimeRoot, 'global')
  const bundledTenantsRoot = path.join(bundledRuntimeRoot, 'tenants')
  const persistentGlobalRoot = path.join(PERSIST_ROOT, 'global')
  const persistentTenantsRoot = path.join(PERSIST_ROOT, 'tenants')

  if (fs.existsSync(bundledGlobalRoot)) {
    seedPersistentDir(bundledGlobalRoot, persistentGlobalRoot)
  }

  if (fs.existsSync(bundledTenantsRoot)) {
    seedPersistentDir(bundledTenantsRoot, persistentTenantsRoot)
  }
}

function seedTenantDiscordConfig() {
  const tenantId = '94371378'
  const tenantTokensDir = path.join(PERSIST_ROOT, 'tenants', tenantId, 'tokens')
  fs.mkdirSync(tenantTokensDir, { recursive: true })

  // Seed discord-channels.json with guildId so Discord messages route to this tenant
  const discordPath = path.join(tenantTokensDir, 'discord-channels.json')
  if (!fs.existsSync(discordPath)) {
    fs.writeFileSync(discordPath, JSON.stringify({
      logChannelId: '1341946492696526858',
      aiChatChannelId: '',
      shoutoutChannelId: '',
      guildId: '1240832965865635881',
      discordBridgeEnabled: true
    }, null, 2))
    console.log('[entrypoint] Seeded discord-channels.json for tenant', tenantId)
  } else {
    // Ensure guildId is set even if file exists
    try {
      const existing = JSON.parse(fs.readFileSync(discordPath, 'utf-8'))
      if (!existing.guildId) {
        existing.guildId = '1240832965865635881'
        fs.writeFileSync(discordPath, JSON.stringify(existing, null, 2))
        console.log('[entrypoint] Added guildId to existing discord-channels.json')
      }
    } catch {}
  }

  // Seed user-config.json so bot name resolves to "Athena"
  const configPath = path.join(tenantTokensDir, 'user-config.json')
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      TWITCH_BROADCASTER_USERNAME: 'mtman1987',
      AI_PROVIDER: 'edenai',
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'athena,hey athena,annie,athenabot87',
      TTS_PROVIDER: 'edenai',
      TTS_VOICE: 'edenai:openai:FEMALE'
    }, null, 2))
    console.log('[entrypoint] Seeded user-config.json for tenant', tenantId)
  }
}

function seedPersistentDir(sourceDir, persistentDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(persistentDir, entry.name)

    if (fs.existsSync(targetPath)) continue

    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true })
      seedPersistentDir(sourcePath, targetPath)
      continue
    }

    fs.copyFileSync(sourcePath, targetPath)
  }
}
