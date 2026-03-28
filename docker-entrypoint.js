#!/usr/bin/env node

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const env = { ...process.env }
const PERSIST_ROOT = env.PERSIST_ROOT || '/data/runtime'
const PERSISTED_DIRS = ['data', 'tokens', 'logs', 'tmp', 'config']

;(async() => {
  ensurePersistentDirs()

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
