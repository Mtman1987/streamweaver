const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PRESETS = {
  'mp4-web': ['-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-c:a', 'aac', '-movflags', '+faststart'],
  'audio-mp3': ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  gif: ['-vf', 'fps=15,scale=960:-1:flags=lanczos']
};

function safeName(value) {
  return path.basename(String(value || '')).replace(/[^a-z0-9._-]+/gi, '-');
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

class MediaJobs {
  constructor({ libraryPath, ffmpegPath = 'ffmpeg', onUpdate = () => {} }) {
    this.libraryPath = path.resolve(libraryPath);
    this.ffmpegPath = ffmpegPath;
    this.onUpdate = onUpdate;
    this.jobs = new Map();
    fs.mkdirSync(this.libraryPath, { recursive: true });
  }

  list() {
    return fs.readdirSync(this.libraryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(this.libraryPath, entry.name);
        const stat = fs.statSync(filePath);
        return { name: entry.name, bytes: stat.size, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  importFile(sourcePath) {
    const source = path.resolve(sourcePath);
    const target = path.join(this.libraryPath, `${Date.now()}-${safeName(source)}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { name: path.basename(target), bytes: fs.statSync(target).size };
  }

  transcode(inputName, preset) {
    if (!PRESETS[preset]) throw new Error('Unsupported media preset');
    const inputPath = path.resolve(this.libraryPath, safeName(inputName));
    if (!within(this.libraryPath, inputPath) || !fs.existsSync(inputPath)) throw new Error('Media input is outside the library');
    const extension = preset === 'audio-mp3' ? '.mp3' : preset === 'gif' ? '.gif' : '.mp4';
    const outputName = `${path.parse(inputPath).name}-${preset}-${Date.now()}${extension}`;
    const outputPath = path.join(this.libraryPath, outputName);
    const id = crypto.randomUUID();
    const job = { id, type: 'transcode', inputName, outputName, preset, status: 'running', startedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    this.onUpdate(job);

    const child = spawn(this.ffmpegPath, ['-y', '-i', inputPath, ...PRESETS[preset], outputPath], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
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
      job.status = code === 0 ? 'completed' : 'failed';
      if (code !== 0 && !job.error) job.error = `FFmpeg exited with ${code}`;
      job.finishedAt = new Date().toISOString();
      this.onUpdate(job);
    });
    return job;
  }

  snapshot() {
    return Array.from(this.jobs.values()).slice(-100);
  }
}

module.exports = { MediaJobs, PRESETS };
