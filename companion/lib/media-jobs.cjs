const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const DEFAULT_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const MIN_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_SINGLE_DOWNLOAD_BYTES = 12 * 1024 * 1024 * 1024;
const MEDIA_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac', '.mp4', '.m4v', '.webm', '.mov', '.mkv', '.ts', '.m3u8', '.gif', '.png', '.jpg', '.jpeg', '.webp']);

const PRESETS = {
  'mp4-web': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-c:a', 'aac', '-movflags', '+faststart'],
  'audio-mp3': ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  gif: ['-vf', 'fps=15,scale=960:-1:flags=lanczos'],
};

function safeName(value) {
  return path.basename(String(value || '')).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'download';
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function clampBytes(value, fallback = DEFAULT_CACHE_BYTES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_CACHE_BYTES, Math.min(parsed, 100 * 1024 * 1024 * 1024));
}

function mediaFileNameFromUrl(rawUrl, requestedName) {
  const parsed = new URL(rawUrl);
  const requested = safeName(requestedName || '');
  const urlName = safeName(decodeURIComponent(path.basename(parsed.pathname) || ''));
  let fileName = requested !== 'download' ? requested : urlName;
  let extension = path.extname(fileName).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(extension)) {
    extension = MEDIA_EXTENSIONS.has(path.extname(urlName).toLowerCase()) ? path.extname(urlName).toLowerCase() : '.mp4';
    fileName = `${path.parse(fileName).name || 'download'}${extension}`;
  }
  const urlHash = crypto.createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 12);
  return `${urlHash}-${safeName(fileName)}`;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function detectHardware(ffmpegPath) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const encoders = {
    nvidia: /\bh264_nvenc\b/.test(output),
    intel: /\bh264_qsv\b/.test(output),
    amd: /\bh264_amf\b/.test(output),
  };
  return {
    cpu: os.cpus()?.[0]?.model || 'Unknown CPU',
    logicalCores: os.cpus()?.length || 1,
    memoryBytes: os.totalmem(),
    encoders,
  };
}

function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return ['auto', 'cpu', 'nvidia', 'intel', 'amd'].includes(engine) ? engine : 'auto';
}

function chooseEngine(requested, hardware) {
  const normalized = normalizeEngine(requested);
  if (normalized !== 'auto') return normalized === 'cpu' || hardware.encoders[normalized] ? normalized : 'cpu';
  if (hardware.encoders.nvidia) return 'nvidia';
  if (hardware.encoders.intel) return 'intel';
  if (hardware.encoders.amd) return 'amd';
  return 'cpu';
}

function presetArgs(preset, engine) {
  if (preset !== 'mp4-web' || engine === 'cpu') return PRESETS[preset];
  if (engine === 'nvidia') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '22', '-c:a', 'aac', '-movflags', '+faststart'];
  if (engine === 'intel') return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '22', '-c:a', 'aac', '-movflags', '+faststart'];
  if (engine === 'amd') return ['-c:v', 'h264_amf', '-quality', 'balanced', '-qp_i', '22', '-qp_p', '22', '-c:a', 'aac', '-movflags', '+faststart'];
  return PRESETS[preset];
}

class MediaJobs {
  constructor({
    libraryPath,
    ffmpegPath = 'ffmpeg',
    maxCacheBytes = DEFAULT_CACHE_BYTES,
    downloadsEnabled = false,
    transcodeEngine = 'auto',
    onUpdate = () => {},
  }) {
    this.libraryPath = path.resolve(libraryPath);
    this.ffmpegPath = ffmpegPath;
    this.maxCacheBytes = clampBytes(maxCacheBytes);
    this.downloadsEnabled = downloadsEnabled === true;
    this.transcodeEngine = normalizeEngine(transcodeEngine);
    this.onUpdate = onUpdate;
    this.jobs = new Map();
    this.controllers = new Map();
    this.hardwareInfo = detectHardware(ffmpegPath);
    fs.mkdirSync(this.libraryPath, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.libraryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !/\.(?:part|download|cache)\.json$/.test(entry.name) && !entry.name.endsWith('.part'))
      .map((entry) => {
        const filePath = path.join(this.libraryPath, entry.name);
        const stat = fs.statSync(filePath);
        return { name: entry.name, bytes: stat.size, updatedAt: stat.mtime.toISOString(), cached: fs.existsSync(`${filePath}.cache.json`) };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  has(inputName) {
    const inputPath = path.resolve(this.libraryPath, safeName(inputName));
    return within(this.libraryPath, inputPath) && fs.existsSync(inputPath);
  }

  resolve(inputName) {
    const inputPath = path.resolve(this.libraryPath, safeName(inputName));
    if (!within(this.libraryPath, inputPath) || !fs.existsSync(inputPath)) throw new Error('Media input is outside the library');
    return inputPath;
  }

  importFile(sourcePath) {
    const source = path.resolve(sourcePath);
    const target = path.join(this.libraryPath, `${Date.now()}-${safeName(source)}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { name: path.basename(target), bytes: fs.statSync(target).size };
  }

  writeJson(name, value) {
    const fileName = safeName(name);
    if (!fileName.endsWith('.json')) throw new Error('Manifest name must end in .json');
    const target = path.resolve(this.libraryPath, fileName);
    if (!within(this.libraryPath, target)) throw new Error('Manifest target is outside the library');
    writeJsonAtomic(target, value);
    return { name: fileName, bytes: fs.statSync(target).size };
  }

  hardware() {
    return {
      ...this.hardwareInfo,
      configuredEngine: this.transcodeEngine,
      selectedEngine: chooseEngine(this.transcodeEngine, this.hardwareInfo),
    };
  }

  configure({ maxCacheBytes, downloadsEnabled, transcodeEngine } = {}) {
    this.maxCacheBytes = clampBytes(maxCacheBytes, this.maxCacheBytes);
    this.downloadsEnabled = downloadsEnabled === true;
    this.transcodeEngine = normalizeEngine(transcodeEngine || this.transcodeEngine);
    return this.cacheStatus();
  }

  cacheStatus() {
    const entries = [];
    for (const name of fs.readdirSync(this.libraryPath)) {
      if (!name.endsWith('.cache.json')) continue;
      const metaPath = path.join(this.libraryPath, name);
      const meta = readJson(metaPath, {});
      const filePath = path.join(this.libraryPath, name.slice(0, -'.cache.json'.length));
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      entries.push({
        name: path.basename(filePath),
        bytes: stat.size,
        url: meta.url,
        completedAt: meta.completedAt,
        lastAccessedAt: meta.lastAccessedAt || meta.completedAt,
      });
    }
    entries.sort((left, right) => String(right.lastAccessedAt || '').localeCompare(String(left.lastAccessedAt || '')));
    return {
      enabled: this.downloadsEnabled,
      bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      budgetBytes: this.maxCacheBytes,
      entries,
      jobs: this.snapshot().filter((job) => job.type === 'download'),
      hardware: this.hardware(),
    };
  }

  download({ url, fileName, expectedSha256, maxBytes } = {}) {
    if (!this.downloadsEnabled) throw new Error('Local relay downloads are disabled on this device');
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') throw new Error('Companion downloads require HTTPS');
    if (this.controllers.size >= 3) throw new Error('Companion download queue is full');

    const outputName = mediaFileNameFromUrl(parsed.toString(), fileName);
    const outputPath = path.join(this.libraryPath, outputName);
    const partPath = `${outputPath}.part`;
    const downloadMetaPath = `${outputPath}.download.json`;
    const cacheMetaPath = `${outputPath}.cache.json`;
    if (fs.existsSync(outputPath)) {
      if (!fs.existsSync(cacheMetaPath)) {
        throw new Error('A non-cache media file already occupies the deterministic download target');
      }
      const meta = readJson(cacheMetaPath, {});
      meta.lastAccessedAt = new Date().toISOString();
      writeJsonAtomic(cacheMetaPath, { ...meta, url: parsed.toString(), lastAccessedAt: meta.lastAccessedAt });
      return { id: null, type: 'download', outputName, status: 'completed', cached: true, bytes: fs.statSync(outputPath).size };
    }

    const id = crypto.randomUUID();
    const controller = new AbortController();
    const job = {
      id,
      type: 'download',
      outputName,
      status: 'running',
      urlHost: parsed.hostname,
      startedAt: new Date().toISOString(),
      bytes: fs.existsSync(partPath) ? fs.statSync(partPath).size : 0,
      resumed: fs.existsSync(partPath) && fs.statSync(partPath).size > 0,
    };
    this.jobs.set(id, job);
    this.controllers.set(id, controller);
    this.onUpdate(job);
    void this.runDownload(job, {
      url: parsed.toString(),
      outputPath,
      partPath,
      downloadMetaPath,
      cacheMetaPath,
      expectedSha256: String(expectedSha256 || '').toLowerCase(),
      maxBytes: Math.max(1, Math.min(Number(maxBytes) || MAX_SINGLE_DOWNLOAD_BYTES, MAX_SINGLE_DOWNLOAD_BYTES, this.maxCacheBytes)),
      signal: controller.signal,
    });
    return job;
  }

  async runDownload(job, options) {
    const existing = fs.existsSync(options.partPath) ? fs.statSync(options.partPath).size : 0;
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
    let writer = null;
    try {
      const response = await fetch(options.url, { headers, redirect: 'follow', signal: options.signal });
      if (!response.ok || !response.body) throw new Error(`Download returned ${response.status}`);
      if (new URL(response.url || options.url).protocol !== 'https:') throw new Error('Download redirected outside HTTPS');
      const append = existing > 0 && response.status === 206;
      const startingBytes = append ? existing : 0;
      const responseBytes = Number(response.headers.get('content-length') || 0);
      const totalBytes = response.status === 206
        ? Number((response.headers.get('content-range') || '').split('/').at(-1) || 0)
        : responseBytes;
      if (totalBytes > options.maxBytes) throw new Error('Download exceeds the configured per-file limit');
      if (!append && fs.existsSync(options.partPath)) fs.truncateSync(options.partPath, 0);
      writeJsonAtomic(options.downloadMetaPath, { url: options.url, outputName: job.outputName, totalBytes, updatedAt: new Date().toISOString() });
      writer = fs.createWriteStream(options.partPath, { flags: append ? 'a' : 'w' });
      job.bytes = startingBytes;
      job.totalBytes = totalBytes || null;
      let lastUpdateAt = 0;
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (job.bytes + buffer.length > options.maxBytes) throw new Error('Download exceeded the configured per-file limit');
        if (!writer.write(buffer)) await new Promise((resolve, reject) => {
          writer.once('drain', resolve);
          writer.once('error', reject);
        });
        job.bytes += buffer.length;
        if (Date.now() - lastUpdateAt >= 500) {
          lastUpdateAt = Date.now();
          this.onUpdate(job);
        }
      }
      writer.end();
      await new Promise((resolve, reject) => {
        writer.once('finish', resolve);
        writer.once('error', reject);
      });

      if (options.expectedSha256) {
        const digest = await sha256File(options.partPath);
        if (digest !== options.expectedSha256) throw new Error('Downloaded file checksum did not match');
      }
      fs.renameSync(options.partPath, options.outputPath);
      fs.rmSync(options.downloadMetaPath, { force: true });
      const completedAt = new Date().toISOString();
      writeJsonAtomic(options.cacheMetaPath, { url: options.url, completedAt, lastAccessedAt: completedAt, bytes: job.bytes });
      job.status = 'completed';
      job.finishedAt = completedAt;
      this.pruneDownloads(this.maxCacheBytes);
    } catch (error) {
      try { writer?.destroy(); } catch {}
      if (/checksum did not match/i.test(String(error?.message || error))) {
        fs.rmSync(options.partPath, { force: true });
        fs.rmSync(options.downloadMetaPath, { force: true });
      }
      job.status = options.signal.aborted ? 'cancelled' : 'failed';
      job.error = options.signal.aborted ? 'Cancelled by local operator' : error.message;
      job.finishedAt = new Date().toISOString();
    } finally {
      this.controllers.delete(job.id);
      this.onUpdate(job);
    }
  }

  cancel(jobId) {
    const controller = this.controllers.get(String(jobId));
    if (!controller) throw new Error('Active media job was not found');
    controller.abort();
    return { id: String(jobId), cancelled: true };
  }

  pruneDownloads(targetBytes = Math.floor(this.maxCacheBytes * 0.8)) {
    const status = this.cacheStatus();
    const target = Math.max(0, Math.min(Number(targetBytes) || 0, this.maxCacheBytes));
    let bytes = status.bytes;
    const removed = [];
    const oldest = [...status.entries].sort((left, right) => String(left.lastAccessedAt || '').localeCompare(String(right.lastAccessedAt || '')));
    for (const entry of oldest) {
      if (bytes <= target) break;
      const filePath = path.join(this.libraryPath, safeName(entry.name));
      if (!within(this.libraryPath, filePath)) continue;
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}.cache.json`, { force: true });
      bytes -= entry.bytes;
      removed.push({ name: entry.name, bytes: entry.bytes });
    }
    return { bytes, removed, budgetBytes: this.maxCacheBytes };
  }

  transcode(inputName, preset) {
    if (!PRESETS[preset]) throw new Error('Unsupported media preset');
    const inputPath = this.resolve(inputName);
    const extension = preset === 'audio-mp3' ? '.mp3' : preset === 'gif' ? '.gif' : '.mp4';
    const outputName = `${path.parse(inputPath).name}-${preset}-${Date.now()}${extension}`;
    const outputPath = path.join(this.libraryPath, outputName);
    const id = crypto.randomUUID();
    const engine = preset === 'mp4-web' ? chooseEngine(this.transcodeEngine, this.hardwareInfo) : 'cpu';
    const job = { id, type: 'transcode', inputName, outputName, preset, engine, status: 'running', startedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    this.onUpdate(job);
    this.spawnTranscode(job, inputPath, outputPath, engine, engine !== 'cpu');
    return job;
  }

  spawnTranscode(job, inputPath, outputPath, engine, allowCpuFallback) {
    const child = spawn(this.ffmpegPath, ['-y', '-i', inputPath, ...presetArgs(job.preset, engine), outputPath], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => {
      job.detail = String(chunk).split(/\r?\n/).filter(Boolean).at(-1) || job.detail;
      this.onUpdate(job);
    });
    child.on('error', (error) => {
      job.status = 'failed';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      this.onUpdate(job);
    });
    child.on('exit', (code) => {
      if (code !== 0 && allowCpuFallback) {
        job.detail = `${engine} encoder failed; retrying on CPU`;
        job.engine = 'cpu-fallback';
        this.onUpdate(job);
        this.spawnTranscode(job, inputPath, outputPath, 'cpu', false);
        return;
      }
      job.status = code === 0 ? 'completed' : 'failed';
      if (code !== 0 && !job.error) job.error = `FFmpeg exited with ${code}`;
      job.finishedAt = new Date().toISOString();
      this.onUpdate(job);
    });
  }

  snapshot() {
    return Array.from(this.jobs.values()).slice(-100);
  }
}

module.exports = { MediaJobs, PRESETS, mediaFileNameFromUrl, normalizeEngine };
