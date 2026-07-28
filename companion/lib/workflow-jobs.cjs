const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = Object.freeze({
  'test.echo': {
    title: 'Harmless relay test',
    description: 'Returns bounded text without touching files, OBS, audio, or external processes.',
    requiresConfirmation: false
  },
  'audio.jingle.play': {
    title: 'Play approved local jingle',
    description: 'Restarts a named OBS media input with an existing file from the Companion library.',
    requiresConfirmation: true
  },
  'song.render.request': {
    title: 'Approve a creative render brief',
    description: 'Stores a reviewed engine-neutral song brief for manual or future allowlisted rendering.',
    requiresConfirmation: true
  }
});

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function safeName(value) {
  return path.basename(text(value, 240)).replace(/[^a-z0-9 ._()[\]-]+/gi, '-');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateWorkflowPayload(workflowId, value) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (workflowId === 'test.echo') {
    return { message: text(payload.message || 'Companion workflow test passed', 200) };
  }
  if (workflowId === 'audio.jingle.play') {
    const mediaName = safeName(payload.mediaName);
    const obsInputName = text(payload.obsInputName, 120);
    if (!mediaName || !obsInputName) throw new Error('mediaName and obsInputName are required');
    return { mediaName, obsInputName, title: text(payload.title || mediaName, 120) };
  }
  if (workflowId === 'song.render.request') {
    const title = text(payload.title, 120);
    const brief = text(payload.brief, 4000);
    if (!title || !brief) throw new Error('title and brief are required');
    return {
      title,
      brief,
      engine: text(payload.engine || 'unassigned', 80),
      voice: text(payload.voice, 80),
      language: text(payload.language, 40),
      genre: text(payload.genre, 80),
      lyrics: text(payload.lyrics, 12_000),
      projectFile: safeName(payload.projectFile),
      outputName: safeName(payload.outputName || `${title}.wav`)
    };
  }
  throw new Error('Workflow is not allowlisted');
}

class WorkflowJobs {
  constructor({ rootPath, mediaJobs, playObsMedia, onUpdate = () => {} }) {
    this.rootPath = path.resolve(rootPath);
    this.statePath = path.join(this.rootPath, 'workflow-jobs.json');
    this.mediaJobs = mediaJobs;
    this.playObsMedia = playObsMedia;
    this.onUpdate = onUpdate;
    fs.mkdirSync(this.rootPath, { recursive: true });
    this.jobs = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(-200) : [];
    } catch {
      return [];
    }
  }

  write() {
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.jobs.slice(-200), null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.statePath);
  }

  update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.write();
    this.onUpdate(clone(job));
    return clone(job);
  }

  catalog() {
    return Object.entries(WORKFLOWS).map(([id, definition]) => ({ id, ...definition }));
  }

  snapshot() {
    let changed = false;
    for (const job of this.jobs) {
      if (job.status !== 'waiting_for_renderer' || !job.payload?.outputName) continue;
      if (!this.mediaJobs.has(job.payload.outputName)) continue;
      Object.assign(job, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        result: { ...(job.result || {}), outputName: job.payload.outputName, rendered: true }
      });
      changed = true;
    }
    if (changed) this.write();
    return clone(this.jobs.slice(-200));
  }

  createReviewRequest(workflowId, payload, source = 'local') {
    const definition = WORKFLOWS[workflowId];
    if (!definition) throw new Error('Workflow is not allowlisted');
    const normalized = validateWorkflowPayload(workflowId, payload);
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      workflowId,
      title: definition.title,
      source: text(source, 80) || 'local',
      payload: normalized,
      status: definition.requiresConfirmation ? 'awaiting_review' : 'approved',
      createdAt: now,
      updatedAt: now
    };
    this.jobs.push(job);
    this.write();
    this.onUpdate(clone(job));
    return clone(job);
  }

  async review(jobId, approved) {
    const job = this.jobs.find((entry) => entry.id === jobId);
    if (!job) throw new Error('Workflow job was not found');
    if (job.status !== 'awaiting_review') throw new Error('Workflow job is not awaiting review');
    if (!approved) return this.update(job, { status: 'rejected', completedAt: new Date().toISOString() });
    this.update(job, { status: 'approved', reviewedAt: new Date().toISOString() });
    return this.executeExisting(job);
  }

  async run(workflowId, payload, source = 'relay') {
    const job = this.createReviewRequest(workflowId, payload, source);
    if (job.status === 'awaiting_review') return job;
    const stored = this.jobs.find((entry) => entry.id === job.id);
    return this.executeExisting(stored);
  }

  async runApproved(workflowId, payload, source = 'relay') {
    const created = this.createReviewRequest(workflowId, payload, source);
    const job = this.jobs.find((entry) => entry.id === created.id);
    if (job.status === 'awaiting_review') {
      this.update(job, { status: 'approved', reviewedAt: new Date().toISOString(), reviewSource: 'relay-confirmation' });
    }
    return this.executeExisting(job);
  }

  async executeExisting(job) {
    if (!job) throw new Error('Workflow job was not found');
    this.update(job, { status: 'running', startedAt: new Date().toISOString() });
    try {
      let result;
      let terminalStatus = 'completed';
      if (job.workflowId === 'test.echo') {
        result = { echoed: job.payload.message, touchedLocalState: false };
      } else if (job.workflowId === 'audio.jingle.play') {
        if (!this.mediaJobs.has(job.payload.mediaName)) throw new Error('The approved jingle is not in the local media library');
        result = await this.playObsMedia(job.payload);
      } else if (job.workflowId === 'song.render.request') {
        terminalStatus = 'waiting_for_renderer';
        const manifestName = `creative-job-${job.id}.json`;
        this.mediaJobs.writeJson(manifestName, {
          schemaVersion: 1,
          jobId: job.id,
          workflowId: job.workflowId,
          title: job.payload.title,
          engine: job.payload.engine,
          voice: job.payload.voice,
          language: job.payload.language,
          genre: job.payload.genre,
          brief: job.payload.brief,
          lyrics: job.payload.lyrics,
          projectFile: job.payload.projectFile || null,
          outputName: job.payload.outputName,
          approvedAt: job.reviewedAt || new Date().toISOString()
        });
        result = {
          readyForRender: true,
          renderer: job.payload.engine,
          projectFile: job.payload.projectFile || null,
          outputName: job.payload.outputName,
          manifestName,
          note: 'A reviewed manifest was written to the approved media library. A local renderer may produce outputName; no arbitrary command was executed.'
        };
      } else {
        throw new Error('Workflow is not allowlisted');
      }
      return this.update(job, {
        status: terminalStatus,
        result,
        completedAt: terminalStatus === 'completed' ? new Date().toISOString() : undefined
      });
    } catch (error) {
      this.update(job, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Workflow failed',
        completedAt: new Date().toISOString()
      });
      throw error;
    }
  }
}

module.exports = { WorkflowJobs, WORKFLOWS, validateWorkflowPayload };
