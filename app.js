const STORAGE_KEY = "techionik_project_notes_v3"
const LEGACY_STORAGE_KEY = "pt_v2"
const ACCESS_KEY_STORAGE_KEY = "techionik_project_tracker_access_key"
const CLOUD_ENDPOINT = "/api/projects"
const SYNC_DEBOUNCE_MS = 700
const POLL_INTERVAL_MS = 10000

const state = {
  projects: [],
  search: "",
  filter: "all",
  sort: "updated",
  modal: {
    open: false,
    mode: "create",
    projectId: null
  },
  noteEditor: null,
  sync: {
    accessKey: "",
    initialized: false,
    dirty: false,
    saveTimer: null,
    pollTimer: null,
    lastRemoteUpdatedAt: 0,
    syncing: false,
    setupMissing: false,
    authEnabled: false,
    status: "loading",
    message: "Connecting cloud sync..."
  }
}

const els = {
  grid: document.getElementById("projectGrid"),
  search: document.getElementById("searchInput"),
  sort: document.getElementById("sortSelect"),
  filterRow: document.getElementById("filterRow"),
  launchCreateBtn: document.getElementById("launchCreateBtn"),
  jumpToGridBtn: document.getElementById("jumpToGridBtn"),
  quickCreateBtn: document.getElementById("quickCreateBtn"),
  resultsTitle: document.getElementById("resultsTitle"),
  resultsMeta: document.getElementById("resultsMeta"),
  syncStatus: document.getElementById("syncStatus"),
  heroProjects: document.getElementById("heroProjects"),
  heroNotes: document.getElementById("heroNotes"),
  statTotal: document.getElementById("statTotal"),
  statActive: document.getElementById("statActive"),
  statDone: document.getElementById("statDone"),
  statAverage: document.getElementById("statAverage"),
  modal: document.getElementById("projectModal"),
  modalEyebrow: document.getElementById("modalEyebrow"),
  modalTitle: document.getElementById("modalTitle"),
  modalDescription: document.getElementById("modalDescription"),
  projectNameInput: document.getElementById("projectNameInput"),
  projectProgressInput: document.getElementById("projectProgressInput"),
  projectProgressReadout: document.getElementById("projectProgressReadout"),
  cancelModalBtn: document.getElementById("cancelModalBtn"),
  saveProjectBtn: document.getElementById("saveProjectBtn")
}

/* INIT */
state.projects = loadProjects()
state.sync.accessKey = readStoredAccessKey()

render()
attachEventListeners()
bootstrapCloudSync()

/* EVENTS */
function attachEventListeners() {
  els.launchCreateBtn.addEventListener("click", () => openProjectModal("create"))
  els.quickCreateBtn.addEventListener("click", () => openProjectModal("create"))
  els.jumpToGridBtn.addEventListener("click", () => {
    els.grid.scrollIntoView({ behavior: "smooth", block: "start" })
  })

  els.search.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase()
    render()
  })

  els.sort.addEventListener("change", (event) => {
    state.sort = event.target.value
    render()
  })

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]")
    if (!button) {
      return
    }

    state.filter = button.dataset.filter
    render()
  })

  els.grid.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]")
    if (!actionTarget) {
      return
    }

    const action = actionTarget.dataset.action
    const projectId = actionTarget.dataset.projectId
    const noteId = actionTarget.dataset.noteId || null

    if (action === "open-create-modal") {
      openProjectModal("create")
      return
    }

    if (!projectId) {
      return
    }

    switch (action) {
      case "edit-project":
        openProjectModal("edit", projectId)
        break
      case "delete-project":
        deleteProject(projectId)
        break
      case "start-create-note":
        startNoteEditor(projectId)
        break
      case "edit-note":
        startNoteEditor(projectId, noteId)
        break
      case "delete-note":
        deleteNote(projectId, noteId)
        break
      case "cancel-note":
        cancelNoteEditor()
        break
      case "save-note":
        saveCurrentNote()
        break
      default:
        break
    }
  })

  els.grid.addEventListener("input", (event) => {
    const slider = event.target.closest("[data-progress-input]")
    if (slider) {
      updateProgressPreview(slider.closest(".project-card"), slider.value)
      return
    }

    const noteInput = event.target.closest("[data-note-input]")
    if (noteInput && state.noteEditor) {
      state.noteEditor.text = noteInput.value
    }
  })

  els.grid.addEventListener("change", (event) => {
    const slider = event.target.closest("[data-progress-input]")
    if (!slider) {
      return
    }

    updateProjectProgress(slider.dataset.projectId, slider.value)
  })

  els.modal.addEventListener("click", (event) => {
    if (event.target === els.modal) {
      closeProjectModal()
    }
  })

  els.projectProgressInput.addEventListener("input", () => {
    els.projectProgressReadout.textContent = `${clampProgress(els.projectProgressInput.value)}%`
  })

  els.cancelModalBtn.addEventListener("click", closeProjectModal)
  els.saveProjectBtn.addEventListener("click", saveProjectFromModal)

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.modal.open) {
        closeProjectModal()
        return
      }

      if (state.noteEditor) {
        cancelNoteEditor()
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && state.noteEditor) {
      saveCurrentNote()
    }
  })

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.sync.initialized) {
      refreshFromCloud({ silent: true })
    }
  })

  window.addEventListener("online", () => {
    setSyncStatus("loading", "Back online. Reconnecting cloud sync...")
    bootstrapCloudSync({ forceRefresh: true })
  })

  window.addEventListener("offline", () => {
    setSyncStatus("local", "Offline. Changes are cached on this device until you reconnect.")
  })
}
/* RENDER */
function render() {
  renderFilters()
  renderStats()
  renderProjects()
  renderSyncStatus()
}

function renderFilters() {
  const buttons = els.filterRow.querySelectorAll("[data-filter]")
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter)
  })
  els.sort.value = state.sort
}

function renderStats() {
  const totalProjects = state.projects.length
  const activeProjects = state.projects.filter((project) => project.prog > 0 && project.prog < 100).length
  const doneProjects = state.projects.filter((project) => project.prog === 100).length
  const totalNotes = state.projects.reduce((sum, project) => sum + project.notes.length, 0)
  const avgProgress = totalProjects
    ? Math.round(state.projects.reduce((sum, project) => sum + project.prog, 0) / totalProjects)
    : 0

  els.heroProjects.textContent = totalProjects
  els.heroNotes.textContent = totalNotes
  els.statTotal.textContent = totalProjects
  els.statActive.textContent = activeProjects
  els.statDone.textContent = doneProjects
  els.statAverage.textContent = `${avgProgress}%`
}

function renderProjects() {
  const visibleProjects = getVisibleProjects()
  const totalNotes = visibleProjects.reduce((sum, project) => sum + project.notes.length, 0)

  els.resultsTitle.textContent = `${visibleProjects.length} project${visibleProjects.length === 1 ? "" : "s"} shown`
  els.resultsMeta.textContent =
    visibleProjects.length === state.projects.length
      ? `Tracking ${totalNotes} note${totalNotes === 1 ? "" : "s"} across the full workspace.`
      : `Filtered view with ${totalNotes} matching note${totalNotes === 1 ? "" : "s"}.`

  if (!state.projects.length) {
    els.grid.innerHTML = `
      <article class="empty-state">
        <strong>Start with your first project</strong>
        <p>Create a project card, then keep adding notes, progress updates, and edits as the work moves forward.</p>
        <button class="btn-primary" type="button" data-action="open-create-modal">Create Project</button>
      </article>
    `
    return
  }

  if (!visibleProjects.length) {
    els.grid.innerHTML = `
      <article class="empty-state">
        <strong>No projects match this view</strong>
        <p>Try a different search, switch the filter, or create a new project that fits what you are tracking.</p>
        <button class="btn-primary" type="button" data-action="open-create-modal">Create Project</button>
      </article>
    `
    return
  }

  els.grid.innerHTML = visibleProjects.map((project, index) => renderProjectCard(project, index)).join("")
}

function renderProjectCard(project, index) {
  const status = getStatus(project.prog)
  const noteCount = project.notes.length
  const activeEditor = state.noteEditor && state.noteEditor.projectId === project.id ? state.noteEditor : null
  const noteEditorMarkup = activeEditor ? renderNoteEditor(project) : ""
  const notesMarkup = noteCount
    ? project.notes
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter((note) => !(activeEditor && activeEditor.mode === "edit" && activeEditor.noteId === note.id))
        .map((note, noteIndex) => renderNoteCard(project.id, note, noteIndex))
        .join("")
    : '<div class="note-empty">No notes yet. Add one to capture links, next steps, or reminders.</div>'

  return `
    <article class="project-card" style="animation-delay:${index * 0.04}s; --status-color:${status.color}; --status-bg:${status.bg};">
      <div class="project-top">
        <div class="project-title-wrap">
          <div class="project-label">Project</div>
          <h2 class="project-title">${escapeHtml(project.name)}</h2>
          <p class="project-subline">${formatRelative(project.updatedAt)}</p>
        </div>
        <div class="project-actions">
          <button class="btn-small" type="button" data-action="edit-project" data-project-id="${project.id}">Edit</button>
          <button class="btn-small btn-small-danger" type="button" data-action="delete-project" data-project-id="${project.id}">Delete</button>
        </div>
      </div>

      <div class="project-meta">
        <div class="status-pill">
          <span class="status-dot"></span>
          <span>${status.label}</span>
        </div>
        <p class="project-note-count">${noteCount} note${noteCount === 1 ? "" : "s"}</p>
      </div>

      <div class="progress-block">
        <div class="progress-head">
          <div>
            <p class="progress-title">Progress</p>
          </div>
          <strong class="progress-value" data-progress-value>${project.prog}%</strong>
        </div>
        <div class="progress-track">
          <div class="progress-fill" data-progress-fill style="width:${project.prog}%"></div>
        </div>
        <input class="progress-slider" type="range" min="0" max="100" value="${project.prog}" data-progress-input data-project-id="${project.id}" />
      </div>

      <section class="notes-section">
        <div class="notes-head">
          <p class="notes-title">Project Notes</p>
          <button class="btn-ghost" type="button" data-action="start-create-note" data-project-id="${project.id}">Add note</button>
        </div>
        ${noteEditorMarkup}
        <div class="notes-list">${notesMarkup}</div>
      </section>
    </article>
  `
}

function renderNoteCard(projectId, note, index) {
  return `
    <article class="note-card">
      <div class="note-card-head">
        <div class="note-meta">Note ${index + 1} | ${formatDate(note.updatedAt)}</div>
        <div class="note-actions">
          <button class="btn-small" type="button" data-action="edit-note" data-project-id="${projectId}" data-note-id="${note.id}">Edit</button>
          <button class="btn-small btn-small-danger" type="button" data-action="delete-note" data-project-id="${projectId}" data-note-id="${note.id}">Remove</button>
        </div>
      </div>
      <p class="note-text">${formatNoteText(note.text)}</p>
    </article>
  `
}

function renderNoteEditor(project) {
  const editor = state.noteEditor
  const title = editor.mode === "edit" ? "Edit note" : `New note for ${project.name}`
  const buttonLabel = editor.mode === "edit" ? "Save changes" : "Save note"

  return `
    <div class="note-editor">
      <div class="note-editor-head">
        <span>${escapeHtml(title)}</span>
        <span class="note-meta">Ctrl/Cmd + Enter to save</span>
      </div>
      <textarea data-note-input placeholder="Add context, links, reminders, or next steps">${escapeHtml(editor.text)}</textarea>
      <div class="note-editor-actions">
        <button class="btn-ghost" type="button" data-action="cancel-note" data-project-id="${project.id}">Cancel</button>
        <button class="btn-primary" type="button" data-action="save-note" data-project-id="${project.id}">${buttonLabel}</button>
      </div>
    </div>
  `
}

function renderSyncStatus() {
  els.syncStatus.dataset.state = state.sync.status
  els.syncStatus.textContent = state.sync.message
}
/* CLOUD */
async function bootstrapCloudSync(options = {}) {
  if (!navigator.onLine) {
    setSyncStatus("local", "Offline. Changes are cached on this device until you reconnect.")
    return
  }

  try {
    setSyncStatus("loading", "Connecting cloud sync...")
    const payload = await fetchCloudDocument({ interactive: true, forceRefresh: options.forceRefresh })
    if (!payload) {
      return
    }

    state.sync.initialized = true
    state.sync.lastRemoteUpdatedAt = Number(payload.updatedAt || 0)
    state.sync.authEnabled = Boolean(payload.authEnabled)

    const remoteProjects = normalizeProjects(payload.projects)
    const localNewest = getProjectsNewestTimestamp(state.projects)
    const remoteNewest = getProjectsNewestTimestamp(remoteProjects)

    if (remoteProjects.length && remoteNewest >= localNewest) {
      state.projects = remoteProjects
      cacheProjects()
      render()
      setSyncStatus("synced", "Cloud sync connected. Shared data is loading across your devices.")
    } else if (!remoteProjects.length && state.projects.length) {
      await saveCloudSnapshot({ reason: "seed" })
    } else if (state.projects.length && localNewest > remoteNewest) {
      await saveCloudSnapshot({ reason: "push-local" })
    } else {
      setSyncStatus("synced", "Cloud sync connected. Changes will appear on every device.")
    }

    startCloudPolling()
  } catch (error) {
    console.error("Cloud sync bootstrap failed", error)
    if (!state.sync.setupMissing) {
      setSyncStatus("error", "Cloud sync failed. Changes are still saved on this device.")
    }
  }
}

async function fetchCloudDocument({ interactive = false } = {}) {
  const result = await requestCloud("GET")
  if (!result) {
    return null
  }

  if (result.status === 401) {
    if (!interactive) {
      setSyncStatus("locked", "Enter the shared sync key on this device to load cloud data.")
      return null
    }

    const hasKey = await promptForAccessKey({ force: true })
    if (!hasKey) {
      return null
    }

    return fetchCloudDocument({ interactive: false })
  }

  if (result.status === 503 && result.payload && result.payload.code === "BLOB_NOT_CONFIGURED") {
    state.sync.setupMissing = true
    setSyncStatus("local", "Cloud sync needs Vercel Blob setup. Data is only on this device for now.")
    return null
  }

  if (result.status >= 400) {
    throw new Error(result.payload && result.payload.message ? result.payload.message : "Unable to load cloud data")
  }

  return result.payload
}

async function saveCloudSnapshot({ reason = "update", retry = false } = {}) {
  if (!navigator.onLine) {
    setSyncStatus("local", "Offline. Changes are cached on this device until you reconnect.")
    return false
  }

  if (state.sync.setupMissing) {
    return false
  }

  state.sync.syncing = true
  setSyncStatus("saving", reason === "seed" ? "Uploading your existing projects to cloud sync..." : "Saving to cloud...")

  const result = await requestCloud("PUT", {
    projects: state.projects,
    updatedAt: Date.now()
  })

  state.sync.syncing = false

  if (!result) {
    setSyncStatus("error", "Cloud sync is unreachable. Changes are still cached on this device.")
    return false
  }

  if (result.status === 401 && !retry) {
    const hasKey = await promptForAccessKey({ force: true })
    if (!hasKey) {
      return false
    }

    return saveCloudSnapshot({ reason, retry: true })
  }

  if (result.status === 503 && result.payload && result.payload.code === "BLOB_NOT_CONFIGURED") {
    state.sync.setupMissing = true
    setSyncStatus("local", "Cloud sync needs Vercel Blob setup. Data is only on this device for now.")
    return false
  }

  if (result.status >= 400) {
    setSyncStatus("error", "Cloud sync failed. Changes are still cached on this device.")
    return false
  }

  state.sync.dirty = false
  state.sync.lastRemoteUpdatedAt = Number(result.payload.updatedAt || Date.now())
  state.sync.authEnabled = Boolean(result.payload.authEnabled)
  setSyncStatus("synced", "All changes are synced to cloud and available on your other devices.")
  return true
}

function startCloudPolling() {
  if (state.sync.pollTimer) {
    return
  }

  state.sync.pollTimer = window.setInterval(() => {
    refreshFromCloud({ silent: true })
  }, POLL_INTERVAL_MS)
}

async function refreshFromCloud({ silent = false } = {}) {
  if (!state.sync.initialized || state.sync.syncing || state.sync.dirty || !navigator.onLine) {
    return
  }

  try {
    const payload = await fetchCloudDocument({ interactive: false })
    if (!payload) {
      return
    }

    const remoteUpdatedAt = Number(payload.updatedAt || 0)
    if (remoteUpdatedAt <= state.sync.lastRemoteUpdatedAt) {
      if (!silent) {
        setSyncStatus("synced", "All changes are synced to cloud and available on your other devices.")
      }
      return
    }

    state.projects = normalizeProjects(payload.projects)
    state.sync.lastRemoteUpdatedAt = remoteUpdatedAt
    cacheProjects()
    render()
    setSyncStatus("synced", "Loaded the latest cloud changes from another device.")
  } catch (error) {
    console.error("Cloud refresh failed", error)
    if (!silent) {
      setSyncStatus("error", "Cloud refresh failed. Local cached data is still available.")
    }
  }
}

function scheduleCloudSave() {
  state.sync.dirty = true

  if (state.sync.saveTimer) {
    window.clearTimeout(state.sync.saveTimer)
  }

  if (!state.sync.initialized) {
    return
  }

  state.sync.saveTimer = window.setTimeout(() => {
    saveCloudSnapshot()
  }, SYNC_DEBOUNCE_MS)
}

async function promptForAccessKey({ force = false } = {}) {
  if (state.sync.accessKey && !force) {
    return true
  }

  const value = window.prompt(
    "Enter the shared sync key for this board. Use the same key on desktop and mobile.",
    state.sync.accessKey || ""
  )

  if (!value || !value.trim()) {
    clearStoredAccessKey()
    setSyncStatus("locked", "Cloud sync is locked until you enter the shared sync key.")
    return false
  }

  state.sync.accessKey = value.trim()
  localStorage.setItem(ACCESS_KEY_STORAGE_KEY, state.sync.accessKey)
  return true
}

function clearStoredAccessKey() {
  state.sync.accessKey = ""
  localStorage.removeItem(ACCESS_KEY_STORAGE_KEY)
}

async function requestCloud(method, body) {
  try {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-store"
    }

    if (body) {
      headers["Content-Type"] = "application/json"
    }

    if (state.sync.accessKey) {
      headers["x-project-tracker-key"] = state.sync.accessKey
    }

    const response = await fetch(CLOUD_ENDPOINT, {
      method,
      headers,
      cache: "no-store",
      body: body ? JSON.stringify(body) : undefined
    })

    let payload = null
    try {
      payload = await response.json()
    } catch (error) {
      payload = null
    }

    if (response.status === 401) {
      clearStoredAccessKey()
    }

    return {
      status: response.status,
      payload
    }
  } catch (error) {
    console.error(`Cloud ${method} request failed`, error)
    return null
  }
}

function setSyncStatus(status, message) {
  state.sync.status = status
  state.sync.message = message
  renderSyncStatus()
}
/* ACTIONS */
function openProjectModal(mode, projectId = null) {
  state.modal.open = true
  state.modal.mode = mode
  state.modal.projectId = projectId

  if (mode === "edit") {
    const project = findProject(projectId)
    if (!project) {
      return
    }

    els.modalEyebrow.textContent = "Edit project"
    els.modalTitle.textContent = "Update project details"
    els.modalDescription.textContent = "Rename the project or move its progress without touching the notes."
    els.saveProjectBtn.textContent = "Save project"
    els.projectNameInput.value = project.name
    els.projectProgressInput.value = project.prog
  } else {
    els.modalEyebrow.textContent = "New project"
    els.modalTitle.textContent = "Set up a project"
    els.modalDescription.textContent = "Start with a name and current progress, then add notes inside the card."
    els.saveProjectBtn.textContent = "Create project"
    els.projectNameInput.value = ""
    els.projectProgressInput.value = 0
  }

  els.projectProgressReadout.textContent = `${clampProgress(els.projectProgressInput.value)}%`
  els.modal.hidden = false
  document.body.classList.add("modal-open")
  window.setTimeout(() => {
    els.projectNameInput.focus()
    els.projectNameInput.select()
  }, 20)
}

function closeProjectModal() {
  state.modal.open = false
  state.modal.projectId = null
  els.modal.hidden = true
  document.body.classList.remove("modal-open")
}

function saveProjectFromModal() {
  const name = els.projectNameInput.value.trim()
  const progress = clampProgress(els.projectProgressInput.value)

  if (!name) {
    els.projectNameInput.focus()
    return
  }

  if (state.modal.mode === "edit") {
    const project = findProject(state.modal.projectId)
    if (!project) {
      closeProjectModal()
      return
    }

    project.name = name
    project.prog = progress
    project.updatedAt = Date.now()
  } else {
    const now = Date.now()
    state.projects.unshift({
      id: createId("project"),
      name,
      prog: progress,
      notes: [],
      createdAt: now,
      updatedAt: now
    })
  }

  persist()
  closeProjectModal()
  render()
}

function deleteProject(projectId) {
  const project = findProject(projectId)
  if (!project) {
    return
  }

  const confirmed = window.confirm(`Delete "${project.name}" and all of its notes?`)
  if (!confirmed) {
    return
  }

  state.projects = state.projects.filter((item) => item.id !== projectId)
  if (state.noteEditor && state.noteEditor.projectId === projectId) {
    state.noteEditor = null
  }

  persist()
  render()
}

function startNoteEditor(projectId, noteId = null) {
  const project = findProject(projectId)
  if (!project) {
    return
  }

  if (noteId) {
    const note = project.notes.find((item) => item.id === noteId)
    if (!note) {
      return
    }

    state.noteEditor = {
      mode: "edit",
      projectId,
      noteId,
      text: note.text
    }
  } else {
    state.noteEditor = {
      mode: "create",
      projectId,
      noteId: null,
      text: ""
    }
  }

  render()
  const textarea = els.grid.querySelector("[data-note-input]")
  if (textarea) {
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }
}

function cancelNoteEditor() {
  state.noteEditor = null
  render()
}

function saveCurrentNote() {
  if (!state.noteEditor) {
    return
  }

  const text = state.noteEditor.text.trim()
  if (!text) {
    const textarea = els.grid.querySelector("[data-note-input]")
    if (textarea) {
      textarea.focus()
    }
    return
  }

  const project = findProject(state.noteEditor.projectId)
  if (!project) {
    state.noteEditor = null
    return
  }

  const now = Date.now()

  if (state.noteEditor.mode === "edit") {
    const note = project.notes.find((item) => item.id === state.noteEditor.noteId)
    if (!note) {
      state.noteEditor = null
      render()
      return
    }

    note.text = text
    note.updatedAt = now
  } else {
    project.notes.unshift({
      id: createId("note"),
      text,
      createdAt: now,
      updatedAt: now
    })
  }

  project.updatedAt = now
  state.noteEditor = null
  persist()
  render()
}

function deleteNote(projectId, noteId) {
  const project = findProject(projectId)
  if (!project || !noteId) {
    return
  }

  const note = project.notes.find((item) => item.id === noteId)
  if (!note) {
    return
  }

  const confirmed = window.confirm("Delete this note?")
  if (!confirmed) {
    return
  }

  project.notes = project.notes.filter((item) => item.id !== noteId)
  project.updatedAt = Date.now()

  if (state.noteEditor && state.noteEditor.noteId === noteId) {
    state.noteEditor = null
  }

  persist()
  render()
}

function updateProjectProgress(projectId, value) {
  const project = findProject(projectId)
  if (!project) {
    return
  }

  project.prog = clampProgress(value)
  project.updatedAt = Date.now()
  persist()
  render()
}

function updateProgressPreview(card, value) {
  if (!card) {
    return
  }

  const progress = clampProgress(value)
  const status = getStatus(progress)
  const fill = card.querySelector("[data-progress-fill]")
  const readout = card.querySelector("[data-progress-value]")
  const pill = card.querySelector(".status-pill")

  if (fill) {
    fill.style.width = `${progress}%`
    fill.style.background = status.color
  }

  if (readout) {
    readout.textContent = `${progress}%`
  }

  if (pill) {
    pill.style.background = status.bg
    pill.style.color = status.color
    pill.lastElementChild.textContent = status.label
  }

  card.style.setProperty("--status-color", status.color)
  card.style.setProperty("--status-bg", status.bg)
}

function getVisibleProjects() {
  const matchesFilter = (project) => {
    if (state.filter === "planning") {
      return project.prog === 0
    }

    if (state.filter === "active") {
      return project.prog > 0 && project.prog < 100
    }

    if (state.filter === "done") {
      return project.prog === 100
    }

    return true
  }

  const matchesSearch = (project) => {
    if (!state.search) {
      return true
    }

    const haystack = [project.name, ...project.notes.map((note) => note.text)].join(" ").toLowerCase()
    return haystack.includes(state.search)
  }

  const sorted = state.projects
    .filter((project) => matchesFilter(project) && matchesSearch(project))
    .slice()

  sorted.sort((a, b) => {
    switch (state.sort) {
      case "progress-high":
        return b.prog - a.prog || b.updatedAt - a.updatedAt
      case "progress-low":
        return a.prog - b.prog || b.updatedAt - a.updatedAt
      case "notes":
        return b.notes.length - a.notes.length || b.updatedAt - a.updatedAt
      case "name":
        return a.name.localeCompare(b.name)
      case "updated":
      default:
        return b.updatedAt - a.updatedAt
    }
  })

  return sorted
}

function findProject(projectId) {
  return state.projects.find((project) => project.id === projectId) || null
}

function getStatus(progress) {
  if (progress === 100) {
    return {
      label: "Done",
      color: "#9bf16b",
      bg: "rgba(155, 241, 107, 0.14)"
    }
  }

  if (progress > 0) {
    return {
      label: "Active",
      color: "#74b8ff",
      bg: "rgba(116, 184, 255, 0.14)"
    }
  }

  return {
    label: "Planning",
    color: "#ffb15f",
    bg: "rgba(255, 177, 95, 0.14)"
  }
}
/* LOCAL */
function persist() {
  cacheProjects()
  scheduleCloudSave()
}

function cacheProjects() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects))
  } catch (error) {
    console.error("Unable to persist local cache", error)
  }
}

function loadProjects() {
  const primary = safeRead(STORAGE_KEY)
  const legacy = primary || safeRead(LEGACY_STORAGE_KEY) || []
  if (!Array.isArray(legacy)) {
    return []
  }

  const normalized = normalizeProjects(legacy)

  if (!primary) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch (error) {
      console.error("Unable to migrate legacy projects", error)
    }
  }

  return normalized
}

function normalizeProjects(projects) {
  if (!Array.isArray(projects)) {
    return []
  }

  return projects.map((project, index) => normalizeProject(project, index)).filter(Boolean)
}

function safeRead(key) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch (error) {
    console.error(`Unable to read ${key}`, error)
    return null
  }
}

function readStoredAccessKey() {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE_KEY) || ""
  } catch (error) {
    return ""
  }
}

function normalizeProject(project, index) {
  if (!project || typeof project !== "object") {
    return null
  }

  const name = String(project.name || `Project ${index + 1}`).trim()
  const notesSource = Array.isArray(project.notes) ? project.notes : []
  const legacyNote = typeof project.note === "string" ? project.note.trim() : ""
  const notes = notesSource.length
    ? notesSource.map((note, noteIndex) => normalizeNote(note, noteIndex)).filter(Boolean)
    : legacyNote
      ? [normalizeNote({ text: legacyNote, createdAt: project.createdAt, updatedAt: project.updatedAt }, 0)]
      : []

  const createdAt = toTimestamp(project.createdAt) || Date.now() - index * 60000
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

function normalizeNote(note, index) {
  if (typeof note === "string") {
    note = { text: note }
  }

  if (!note || typeof note !== "object") {
    return null
  }

  const text = String(note.text || note.body || "").trim()
  if (!text) {
    return null
  }

  const createdAt = toTimestamp(note.createdAt) || Date.now() - index * 30000
  const updatedAt = toTimestamp(note.updatedAt) || createdAt

  return {
    id: String(note.id || createId("note")),
    text,
    createdAt,
    updatedAt
  }
}

/* UTILS */
function getProjectsNewestTimestamp(projects) {
  return projects.reduce((latest, project) => {
    const noteLatest = project.notes.reduce((noteMax, note) => Math.max(noteMax, note.updatedAt), 0)
    return Math.max(latest, project.updatedAt || 0, noteLatest)
  }, 0)
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

function formatRelative(timestamp) {
  const diff = Date.now() - timestamp

  if (diff < 60000) {
    return "Updated just now"
  }

  if (diff < 3600000) {
    const mins = Math.max(1, Math.floor(diff / 60000))
    return `Updated ${mins} min ago`
  }

  if (diff < 86400000) {
    const hours = Math.max(1, Math.floor(diff / 3600000))
    return `Updated ${hours} hr ago`
  }

  const days = Math.max(1, Math.floor(diff / 86400000))
  return `Updated ${days} day${days === 1 ? "" : "s"} ago`
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp)
}

function formatNoteText(text) {
  return escapeHtml(text).replace(/\n/g, "<br>")
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
