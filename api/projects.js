import { del, get, list, put } from "@vercel/blob"

const SNAPSHOT_PREFIX = "project-tracker/states/"
const KEEP_SNAPSHOTS = 12

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0")
  res.setHeader("Content-Type", "application/json; charset=utf-8")

  if (req.method === "OPTIONS") {
    res.status(204).end()
    return
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      ok: false,
      code: "BLOB_NOT_CONFIGURED",
      message: "BLOB_READ_WRITE_TOKEN is missing for this deployment."
    })
    return
  }

  if (!isAuthorized(req)) {
    res.status(401).json({
      ok: false,
      code: "AUTH_REQUIRED",
      message: "A valid project tracker sync key is required."
    })
    return
  }

  try {
    if (req.method === "GET") {
      const latest = await readLatestSnapshot()
      res.status(200).json({
        ok: true,
        authEnabled: Boolean(process.env.PROJECT_TRACKER_ACCESS_KEY),
        projects: latest ? latest.document.projects : [],
        updatedAt: latest ? latest.document.updatedAt : 0
      })
      return
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req)
      const document = {
        version: 1,
        updatedAt: Date.now(),
        projects: sanitizeProjects(body.projects)
      }

      const pathname = `${SNAPSHOT_PREFIX}${document.updatedAt}-${createId("snapshot")}.json`

      await put(pathname, JSON.stringify(document), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json; charset=utf-8"
      })

      await pruneOldSnapshots()

      res.status(200).json({
        ok: true,
        authEnabled: Boolean(process.env.PROJECT_TRACKER_ACCESS_KEY),
        projects: document.projects,
        updatedAt: document.updatedAt
      })
      return
    }

    res.status(405).json({
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      message: "Use GET or PUT."
    })
  } catch (error) {
    console.error("Project sync handler failed", error)
    res.status(500).json({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Unable to read or write project data right now."
    })
  }
}

function isAuthorized(req) {
  const expected = process.env.PROJECT_TRACKER_ACCESS_KEY
  if (!expected) {
    return true
  }

  const provided = req.headers["x-project-tracker-key"]
  return typeof provided === "string" && provided === expected
}

async function readLatestSnapshot() {
  const { blobs } = await list({
    prefix: SNAPSHOT_PREFIX,
    limit: 1000
  })

  if (!blobs.length) {
    return null
  }

  const latestBlob = blobs
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0]

  const blobResponse = await get(latestBlob.pathname, {
    access: "private",
    useCache: false
  })
  if (!blobResponse || blobResponse.statusCode !== 200 || !blobResponse.stream) {
    return null
  }

  const text = await new Response(blobResponse.stream).text()
  const parsed = JSON.parse(text)

  return {
    blob: latestBlob,
    document: {
      version: 1,
      updatedAt: toTimestamp(parsed.updatedAt) || 0,
      projects: sanitizeProjects(parsed.projects)
    }
  }
}

async function pruneOldSnapshots() {
  const { blobs } = await list({
    prefix: SNAPSHOT_PREFIX,
    limit: 1000
  })

  if (blobs.length <= KEEP_SNAPSHOTS) {
    return
  }

  const stale = blobs
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(KEEP_SNAPSHOTS)
    .map((blob) => blob.pathname)

  if (stale.length) {
    await del(stale)
  }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {}
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk))
  }

  if (!chunks.length) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sanitizeProjects(projects) {
  if (!Array.isArray(projects)) {
    return []
  }

  return projects
    .map((project, index) => sanitizeProject(project, index))
    .filter(Boolean)
    .slice(0, 500)
}

function sanitizeProject(project, index) {
  if (!project || typeof project !== "object") {
    return null
  }

  const name = String(project.name || `Project ${index + 1}`).trim().slice(0, 80)
  const notes = Array.isArray(project.notes)
    ? project.notes.map((note, noteIndex) => sanitizeNote(note, noteIndex)).filter(Boolean).slice(0, 200)
    : []

  const createdAt = toTimestamp(project.createdAt) || Date.now()
  const updatedAt = toTimestamp(project.updatedAt) || createdAt

  return {
    id: String(project.id || createId("project")),
    name: name || `Project ${index + 1}`,
    prog: clampProgress(project.prog ?? project.progress),
    notes,
    createdAt,
    updatedAt
  }
}

function sanitizeNote(note, index) {
  if (!note || typeof note !== "object") {
    return null
  }

  const text = String(note.text || note.body || "").trim().slice(0, 10000)
  if (!text) {
    return null
  }

  const createdAt = toTimestamp(note.createdAt) || Date.now() - index * 1000
  const updatedAt = toTimestamp(note.updatedAt) || createdAt

  return {
    id: String(note.id || createId("note")),
    text,
    createdAt,
    updatedAt
  }
}

function toTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function clampProgress(value) {
  const numeric = Number.parseInt(value, 10)
  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.min(100, Math.max(0, numeric))
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-6)}`
}
