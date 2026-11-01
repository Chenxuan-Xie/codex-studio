/* global fetch, localStorage */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    bootstrap: null,
    projects: [],
    project: null,
    threads: [],
    plannerId: null,
    selectedCodex: new Set(),
    dshSessions: [],
    dshWorkers: [],
    dshSeq: 0,
    apiWorkers: [],
    apiSeq: 0,
    plannerCreateOpen: false,
    plannerTab: "codex",
    plannerKind: "codex",
    plannerDshId: null,
    codexCreateOpen: false,
    dshCreateOpen: false,
    goal: "",
    maxRounds: 5,
    view: "setup",
    run: null,
    pollTimer: null,
    projectFilter: "",
    tab: "codex",
  };

  const STATUS_LABEL = {
    running: "运行中",
    starting: "启动中",
    planning: "Planner 规划中",
    executing: "Worker 执行中",
    review: "等待 Planner 验收",
    paused: "已暂停",
    stopping: "停止中",
    stopped: "已停止",
    done: "已完成",
    blocked: "需要决策",
    failed: "失败",
    error: "错误",
    queued: "排队中",
    completed: "完成",
    interrupted: "已中断",
    inProgress: "执行中",
    "no turns": "无回合",
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function short(value, n = 90) {
    const s = String(value || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function fmtDate(value) {
    if (!value) return "-";
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return String(value);
    }
  }

  function fmtMs(ms) {
    if (!ms) return "-";
    try {
      return new Date(Number(ms)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return "-";
    }
  }

  function statusLabel(value) {
    return STATUS_LABEL[value] || value || "-";
  }

  function statusClass(value) {
    if (["done", "completed"].includes(value)) return "good";
    if (["running", "planning", "executing", "review", "starting"].includes(value)) return "accent";
    if (["failed", "error", "interrupted"].includes(value)) return "bad";
    if (["paused", "queued", "stopping"].includes(value)) return "warn";
    return "";
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
    }
    return data;
  }

  function setServer(ok, text) {
    const dot = $("#serverDot");
    dot.className = "status-dot " + (ok ? "good" : "bad");
    $("#serverLabel").textContent = text || (ok ? "本地已连接" : "连接失败");
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
    localStorage.setItem("codex-studio-theme", theme);
  }

  function openSettings() {
    const cfg = (state.bootstrap && state.bootstrap.config) || {};
    const models = (cfg.codex_models || []).join(" · ") || "-";
    const body = $("#settingsBody");
    body.innerHTML = `
      <div class="setting-row"><span class="setting-key">Codex home</span><span class="setting-value">${esc(cfg.codex_home || "-")}</span></div>
      <div class="setting-row"><span class="setting-key">数据目录</span><span class="setting-value">${esc(cfg.data_dir || "-")}</span></div>
      <div class="setting-row"><span class="setting-key">Codex 模型</span><span class="setting-value">${esc(models)}</span></div>
      <div class="setting-row"><span class="setting-key">Effort</span><span class="setting-value">${esc((cfg.reasoning_efforts || []).join(" · ") || "-")}</span></div>
      <div class="setting-row"><span class="setting-key">DSH profile</span><span class="setting-value">${esc(cfg.dsh_profile || "-")}</span></div>
      <p class="setting-note">路径和模型来自本地 config.json。修改 config.json 后重启应用即可生效。桌面版会把 Python 后端和静态页面一起打包，运行时不会打开浏览器。</p>`;
    $("#settingsModal").hidden = false;
  }

  function closeSettings() {
    $("#settingsModal").hidden = true;
  }

  async function boot() {
    applyTheme(localStorage.getItem("codex-studio-theme") || "light");
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "api") state.tab = "api";
    if (params.get("tab") === "dsh") state.tab = "dsh";
    $("#themeBtn").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    $("#refreshBtn").addEventListener("click", () => loadBootstrap(false));
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#closeSettings").addEventListener("click", closeSettings);
    $("#settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") closeSettings(); });
    $("#backToSetup").addEventListener("click", showSetup);
    $("#projectSearch").addEventListener("input", (e) => {
      state.projectFilter = e.target.value.toLowerCase();
      renderProjects();
    });
    try {
      await loadBootstrap(true);
      if (params.get("run")) {
        await openRun(params.get("run"), false);
      }
    } catch (err) {
      setServer(false, "无法连接");
      toast(err.message);
      $("#main").innerHTML = `<div class="empty-state"><div class="empty-mark">CS</div><h1>无法连接本地服务</h1><p>${esc(err.message)}<br>请确认 <code>server.py</code> 正在运行。</p></div>`;
    }
  }

  async function loadBootstrap(pickDefault) {
    const data = await api("/api/bootstrap");
    state.bootstrap = data;
    state.projects = data.projects || [];
    $("#projectCount").textContent = state.projects.length;
    $("#codexHome").textContent = data.config.codex_home;
    $("#dataDir").textContent = data.config.data_dir;
    setServer(true, "本地已连接");
    renderProjects();
    renderRuns(data.runs || []);
    if (pickDefault && !state.project) {
      const preferred = state.projects.find((p) => p.name.includes("AI+6G")) || state.projects[0];
      if (preferred) {
        await selectProject(preferred.id || preferred.path);
      } else {
        renderSetup();
      }
    } else if (!state.project) {
      renderSetup();
    }
    if (state.run && state.view === "run") {
      await openRun(state.run.id, false);
    }
  }

  async function selectProject(ref) {
    const project = state.projects.find((p) => p.id === ref || p.path === ref);
    if (!project) return;
    state.project = project;
    state.threads = [];
    state.plannerId = null;
    state.selectedCodex = new Set();
    state.plannerKind = "codex";
    state.plannerDshId = null;
    state.plannerTab = "codex";
    state.plannerCreateOpen = false;
    state.codexCreateOpen = false;
    state.dshCreateOpen = false;
    state.dshSessions = [];
    state.dshWorkers = [];
    state.dshSeq = 0;
    state.apiWorkers = [];
    state.apiSeq = 0;
    state.goal = "";
    state.maxRounds = 5;
    state.run = null;
    state.view = "setup";
    stopPolling();
    $("#topProject").textContent = project.name || project.path;
    renderProjects();
    renderProjectLoading();
    try {
      const projectRef = project.id || project.path;
      const [data, dsh] = await Promise.all([
        api("/api/threads?project=" + encodeURIComponent(projectRef)),
        api("/api/dsh-sessions?project=" + encodeURIComponent(projectRef)).catch(() => ({ sessions: [] })),
      ]);
      state.threads = data.threads || [];
      state.dshSessions = dsh.sessions || [];
      // Require an explicit Planner choice. Never silently make a failed or
      // unrelated conversation the planner just because it is most recent.
      state.plannerId = null;
      renderSetup();
      updateInspector();
    } catch (err) {
      toast(err.message);
      renderSetup();
    }
  }

  function renderProjects() {
    const list = $("#projectList");
    const filter = state.projectFilter;
    const projects = state.projects.filter((p) => {
      const blob = `${p.name} ${p.path}`.toLowerCase();
      return !filter || blob.includes(filter);
    });
    if (!projects.length) {
      list.innerHTML = `<div class="empty-mini">没有匹配项目</div>`;
      return;
    }
    list.innerHTML = projects.map((p) => {
      const active = state.project && (state.project.id === p.id || state.project.path === p.path);
      const count = p.count || 0;
      return `<button class="project-item ${active ? "active" : ""}" data-project="${esc(p.id || p.path)}">
        <div class="project-avatar">${esc((p.name || "?").slice(0, 1).toUpperCase())}</div>
        <div class="project-main">
          <div class="project-name">${esc(p.name || p.path)}</div>
          <div class="project-path">${esc(p.path)}</div>
          <div class="project-meta">${count} 个对话 · ${esc(fmtMs(p.updated_at_ms))}</div>
        </div>
      </button>`;
    }).join("");
    $$("[data-project]", list).forEach((el) => {
      el.addEventListener("click", () => selectProject(el.dataset.project));
    });
  }

  function renderRuns(runs) {
    const box = $("#runList");
    if (!runs || !runs.length) {
      box.innerHTML = `<div class="empty-mini" style="padding-left:10px">还没有运行</div>`;
      return;
    }
    box.innerHTML = runs.map((r) => `<button class="run-item ${state.run && state.run.id === r.id ? "active" : ""}" data-run="${esc(r.id)}">
      <div class="run-item-title">${esc(short(r.goal || "未命名运行", 42))}</div>
      <div class="run-item-meta"><span class="badge ${statusClass(r.status)}">${esc(statusLabel(r.status))}</span><span>R${esc(r.round || 0)}</span><span>${esc(fmtDate(r.updated_at))}</span></div>
    </button>`).join("");
    $$("[data-run]", box).forEach((el) => el.addEventListener("click", () => openRun(el.dataset.run)));
  }

  function renderProjectLoading() {
    $("#main").innerHTML = `<div class="empty-state"><div class="empty-mark">CS</div><h1>读取项目对话...</h1><p>正在从 Codex 本地数据库读取当前项目。</p></div>`;
  }

  function plannerThread() {
    return state.threads.find((t) => t.id === state.plannerId) || null;
  }

  function plannerSelection() {
    if (state.plannerKind === "dsh" && state.plannerDshId) {
      const s = state.dshSessions.find((x) => x.session_id === state.plannerDshId);
      return s ? { kind: "dsh", session: s, title: s.title, model: s.model, cwd: s.cwd } : null;
    }
    const t = plannerThread();
    return t ? { kind: "codex", thread: t, title: t.name || t.title, model: t.model, cwd: t.cwd } : null;
  }

  function workerThreads() {
    return state.threads.filter((t) => t.id !== state.plannerId);
  }

  function apiModel() {
    return (state.bootstrap && state.bootstrap.models) || [];
  }

  function selectedApiModel(id) {
    return apiModel().find((m) => m.id === id) || null;
  }

  function nextWorkerName() {
    const used = new Set([
      ...state.threads.map((t) => (t.name || "").toLowerCase()),
      ...state.dshSessions.map((s) => (s.title || "").toLowerCase()),
      ...state.dshWorkers.map((w) => (w.name || "").toLowerCase()),
    ]);
    let i = 1;
    while (used.has(`worker${i}`)) i += 1;
    return `worker${i}`;
  }

  function optionsHtml(values, selected) {
    return values.map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
  }

  function effortOptions(selected = "high") {
    const values = (state.bootstrap && state.bootstrap.config && state.bootstrap.config.reasoning_efforts) || ["low", "medium", "high", "max"];
    return optionsHtml(values, selected);
  }

  function codexModelOptions(selected) {
    const values = (state.bootstrap && state.bootstrap.config && state.bootstrap.config.codex_models) || ["gpt-6.1-sol"];
    return optionsHtml(values, selected || values[0]);
  }

  function dshModelOptions(selected) {
    return apiModel().map((m) => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}</option>`).join("");
  }

  function createForm(kind, role, name, modelControl, prompt) {
    const isPlanner = role === "planner";
    return `<div class="create-form">
      <div class="form-title">${isPlanner ? "新建 Planner 对话" : "新建 Worker 对话"}</div>
      <div class="form-sub">先创建并命名这个对话；初始化 prompt 会作为它的第一条消息。</div>
      <div class="form-grid">
        <label class="field"><span>名称</span><input id="createName" value="${esc(name)}"></label>
        <label class="field"><span>模型</span>${modelControl}</label>
        <label class="field"><span>Effort</span><select id="createEffort">${effortOptions("high")}</select></label>
      </div>
      <label class="field full"><span>初始化 Prompt</span><textarea id="createPrompt" rows="4">${esc(prompt)}</textarea></label>
      <div class="form-actions"><button class="secondary-btn" data-cancel-create="${kind}">取消</button><button class="primary-btn" data-create-kind="${kind}" data-create-role="${role}">创建并使用</button></div>
    </div>`;
  }

  async function reloadThreads() {
    if (!state.project) return;
    const projectRef = state.project.id || state.project.path;
    const data = await api("/api/threads?project=" + encodeURIComponent(projectRef));
    state.threads = data.threads || [];
  }

  async function reloadDshSessions() {
    if (!state.project) return;
    const projectRef = state.project.id || state.project.path;
    const data = await api("/api/dsh-sessions?project=" + encodeURIComponent(projectRef));
    state.dshSessions = data.sessions || [];
  }

  async function createConversation(kind, role) {
    const name = ($("#createName") && $("#createName").value || "").trim();
    const prompt = ($("#createPrompt") && $("#createPrompt").value || "").trim();
    const effort = ($("#createEffort") && $("#createEffort").value) || "high";
    if (!name) return toast("给这个对话起一个名字");
    let payload = {
      kind,
      role,
      project_id: state.project.id || "",
      project_path: state.project.path,
      name,
      effort,
      init_prompt: prompt,
    };
    if (kind === "codex") {
      payload.model = ($("#createModel") && $("#createModel").value) || "gpt-6.1-sol";
    } else {
      payload.model_id = ($("#createModel") && $("#createModel").value) || "";
    }
    const btn = $(`[data-create-kind="${kind}"][data-create-role="${role}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "创建中..."; }
    try {
      const conv = await api("/api/conversations", { method: "POST", body: JSON.stringify(payload) });
      if (kind === "codex") {
        await reloadThreads();
        if (role === "planner") {
          state.plannerId = conv.thread_id || conv.id;
          state.plannerKind = "codex";
          state.plannerDshId = null;
          state.plannerTab = "codex";
          state.plannerCreateOpen = false;
        } else {
          state.selectedCodex.add(conv.thread_id || conv.id);
          state.codexCreateOpen = false;
        }
      } else {
        await reloadDshSessions();
        if (role === "planner") {
          state.plannerKind = "dsh";
          state.plannerDshId = conv.session_id || conv.id;
          state.plannerId = null;
          state.plannerTab = "dsh";
          state.plannerCreateOpen = false;
        } else {
          state.dshWorkers.push({
            key: `dsh-${Date.now()}`,
            name: conv.name || name,
            session_id: conv.session_id || conv.id,
            title: conv.name || name,
            cwd: conv.cwd,
            provider: conv.provider,
            model: conv.model,
          });
          state.dshCreateOpen = false;
        }
      }
      toast(`已创建对话：${conv.name || name}`);
      renderSetup();
    } catch (err) {
      toast(err.message);
      if (btn) { btn.disabled = false; btn.textContent = "创建并使用"; }
    }
  }

  function renderSetup() {
    state.view = "setup";
    const p = state.project;
    if (!p) {
      $("#main").innerHTML = `<div class="empty-state"><div class="empty-mark">CS</div><h1>选择一个项目</h1><p>从左侧选择项目，或先添加一个 Codex 项目。</p></div>`;
      return;
    }
    $("#topProject").textContent = p.name || p.path;
    const planner = plannerSelection();
    const threads = state.threads;
    const selectedExisting = workerThreads().filter((t) => state.selectedCodex.has(t.id));
    const apiCards = apiModel().map((m) => `<div class="api-card">
      <div class="api-main">
        <div class="api-name">${esc(m.name)}</div>
        <div class="api-meta">${esc(m.provider)} / ${esc(m.model)}</div>
        <div class="api-strengths">${esc((m.strengths || []).join(" · "))}</div>
      </div>
      <button class="api-add" data-add-api="${esc(m.id)}">添加</button>
    </div>`).join("");
    const dshCards = state.dshSessions.map((s) => `<div class="api-card">
      <div class="api-main">
        <div class="api-name" title="${esc(s.title)}">${esc(short(s.title, 62))}</div>
        <div class="api-meta">${esc(s.provider || "DSH")} / ${esc(s.model || "默认模型")} · ${esc(s.turns || 0)} 轮</div>
        <div class="api-strengths" title="${esc(s.cwd)}">${esc(short(s.cwd, 70))}</div>
      </div>
      <button class="api-add" data-add-dsh="${esc(s.session_id)}">添加</button>
    </div>`).join("");
    const selectedDsh = state.dshWorkers.map((w) => `<div class="worker-chip" data-dsh-key="${esc(w.key)}">
      <span>${esc(w.name)} · ${esc(short(w.title, 28))}</span>
      <button data-remove-dsh="${esc(w.key)}" title="移除">×</button>
    </div>`).join("");
    const existingHtml = workerThreads().map((t) => {
      const selected = state.selectedCodex.has(t.id);
      const status = statusLabel(t.status);
      return `<button class="thread-card ${selected ? "selected" : ""}" data-worker="${esc(t.id)}">
        <span class="checkbox"></span>
        <span class="thread-body">
          <span class="thread-title" title="${esc(t.title || t.name)}">${esc(t.name || t.title)}</span>
          <span class="thread-meta"><span class="badge mono">${esc(t.model || "model")}</span><span class="badge ${statusClass(t.status)}">${esc(status)}</span><span class="badge">${esc(t.id.slice(0, 8))}</span></span>
          ${t.last_text ? `<span class="thread-preview">${esc(short(t.last_text, 120))}</span>` : ""}
        </span>
      </button>`;
    }).join("") || `<div class="empty-mini">这个项目没有可选的执行对话。</div>`;
    const plannerHtml = threads.map((t) => {
      const selected = t.id === state.plannerId;
      return `<button class="thread-card ${selected ? "selected" : ""} ${t.status === "inProgress" ? "disabled" : ""}" data-planner="${esc(t.id)}">
        <span class="radio"></span>
        <span class="thread-body">
          <span class="thread-title" title="${esc(t.title || t.name)}">${esc(t.name || t.title)}</span>
          <span class="thread-meta"><span class="badge mono">${esc(t.model || "model")}</span><span class="badge ${statusClass(t.status)}">${esc(statusLabel(t.status))}</span><span class="badge">${esc(t.id.slice(0, 8))}</span></span>
          ${t.last_text ? `<span class="thread-preview">${esc(short(t.last_text, 120))}</span>` : ""}
        </span>
      </button>`;
    }).join("") || `<div class="empty-mini">没有找到顶层对话。</div>`;
    const dshPlannerHtml = state.dshSessions.map((s) => {
      const selected = state.plannerKind === "dsh" && state.plannerDshId === s.session_id;
      return `<button class="thread-card ${selected ? "selected" : ""}" data-planner-dsh="${esc(s.session_id)}">
        <span class="radio"></span>
        <span class="thread-body">
          <span class="thread-title" title="${esc(s.title)}">${esc(short(s.title, 62))}</span>
          <span class="thread-meta"><span class="badge mono">${esc(s.model || "DSH 默认")}</span><span class="badge">${esc(s.provider || "DSH")}</span><span class="badge">${esc(s.turns || 0)} 轮</span></span>
          <span class="thread-preview">${esc(short(s.cwd, 100))}</span>
        </span>
      </button>`;
    }).join("") || `<div class="empty-mini">这个项目没有可用的 DSH 对话。</div>`;
    const selectedApi = state.apiWorkers.map((w) => {
      const m = selectedApiModel(w.model_id);
      return `<div class="worker-chip" data-api-key="${esc(w.key)}">
        <span>${esc(w.name)} · ${esc(m ? m.name : w.model_id)}</span>
        <button data-remove-api="${esc(w.key)}" title="移除">×</button>
      </div>`;
    }).join("");
    const existingNames = selectedExisting.map((t, i) => `<div class="worker-chip">codex-${String(i + 1).padStart(2, "0")} · ${esc(short(t.name || t.title, 28))}</div>`).join("");
    const apiWorktreeRows = state.apiWorkers.map((w) => `<label class="worker-option-row"><input type="checkbox" data-worktree="${esc(w.key)}" ${w.use_worktree ? "checked" : ""}> ${esc(w.name)} 使用独立 worktree（项目必须 clean）</label>`).join("");

    $("#main").innerHTML = `
      <div class="setup-head">
        <div>
          <div class="setup-eyebrow">Workspace</div>
          <h1 class="setup-title">准备一次运行</h1>
          <p class="setup-sub">选择或新建 Planner 与 Worker，然后描述目标。Codex 与 DSH 都可以作为 Planner 或 Worker；新建对话时指定模型、effort 和初始化 Prompt。</p>
        </div>
        <div class="project-chip"><span>▣</span><span>${esc(p.path)}</span></div>
      </div>
      <div class="section">
        <div class="section-head">
          <div class="section-title-wrap"><div class="step-num">1</div><div><div class="section-title">选择 Planner 对话</div><div class="section-sub">选择现有对话，或新建一个带模型与 effort 的 Planner。</div></div></div>
          <div class="head-actions">
            ${planner ? `<span class="badge mono">${esc(planner.model || "默认模型")}</span>` : ""}
            <button class="secondary-btn" id="openPlannerCreate">${state.plannerCreateOpen ? "取消新建" : "＋ 新建对话"}</button>
          </div>
        </div>
        <div class="section-body">
          <div class="tabs planner-tabs">
            <button class="tab ${state.plannerTab === "codex" ? "active" : ""}" data-planner-tab="codex">Codex 对话</button>
            <button class="tab ${state.plannerTab === "dsh" ? "active" : ""}" data-planner-tab="dsh">DSH 对话</button>
          </div>
          ${state.plannerCreateOpen ? (state.plannerTab === "dsh"
            ? createForm("dsh", "planner", "planner", `<select id="createModel">${dshModelOptions("workbuddy-deepseek")}</select>`, "你是 Codex Studio 的统筹 Planner。你负责验收交付、规划下一轮任务、给 Worker 明确验收标准。先只确认角色并回复 READY，不要执行项目任务。")
            : createForm("codex", "planner", "planner", `<select id="createModel">${codexModelOptions("gpt-6.1-sol")}</select>`, "你是 Codex Studio 的统筹 Planner。你负责验收交付、规划下一轮任务、给 Worker 明确验收标准。先只确认角色并回复 READY，不要执行项目任务。")) : ""}
          <div class="thread-list">${state.plannerTab === "dsh" ? dshPlannerHtml : plannerHtml}</div>
        </div>
      </div>
      <div class="section">
        <div class="section-head">
          <div class="section-title-wrap"><div class="step-num">2</div><div><div class="section-title">配置 Worker</div><div class="section-sub">复用 Codex 对话，或选择 DeepSeek Harness 里的现有对话。</div></div></div>
          <div class="tabs">
            <button class="tab ${state.tab === "codex" ? "active" : ""}" data-tab="codex">Codex 对话</button>
            <button class="tab ${state.tab === "dsh" ? "active" : ""}" data-tab="dsh">DSH 对话</button>
            <button class="tab ${state.tab === "api" ? "active" : ""}" data-tab="api">API 直连</button>
          </div>
        </div>
        <div class="section-body">
          <div class="tab-panel ${state.tab === "codex" ? "active" : ""}" id="tabCodex">
            <div class="worker-tab-tools"><span>选择现有 Codex 对话，或者新建一个 workerX。</span><button class="secondary-btn" id="openCodexCreate">${state.codexCreateOpen ? "取消新建" : "＋ 新建 Codex 对话"}</button></div>
            ${state.codexCreateOpen ? createForm("codex", "worker", nextWorkerName(), `<select id="createModel">${codexModelOptions("gpt-6.1-sol")}</select>`, `你是 ${nextWorkerName()}，负责执行 Codex Studio 分配的任务。先只确认角色并回复 READY，不要执行项目任务。`) : ""}
            <div class="thread-list">${existingHtml}</div>
            ${selectedExisting.length ? `<div class="selected-workers">${existingNames}</div>` : ""}
          </div>
          <div class="tab-panel ${state.tab === "dsh" ? "active" : ""}" id="tabDsh">
            <div class="notice info">DSH Worker 会继续你选中的 DeepSeek Harness 原会话，不会新建一次性 headless 会话。若该对话正在 DSH 客户端里执行，ACP 会提示被占用。</div>
            <div class="worker-tab-tools"><span>选择现有 DSH 对话，或者新建一个 workerX。</span><button class="secondary-btn" id="openDshCreate">${state.dshCreateOpen ? "取消新建" : "＋ 新建 DSH 对话"}</button></div>
            ${state.dshCreateOpen ? createForm("dsh", "worker", nextWorkerName(), `<select id="createModel">${dshModelOptions("workbuddy-deepseek")}</select>`, `你是 ${nextWorkerName()}，负责执行 Codex Studio 分配的任务。先只确认角色并回复 READY，不要执行项目任务。`) : ""}
            <div class="api-grid">${dshCards || '<div class="empty-mini">这个项目没有找到 DSH 对话。</div>'}</div>
            ${state.dshWorkers.length ? `<div class="selected-workers">${selectedDsh}</div>` : ""}
          </div>
          <div class="tab-panel ${state.tab === "api" ? "active" : ""}" id="tabApi">
            <div class="notice info">API 直连是一次性 Worker，默认在项目目录运行；多个会串行，避免互相覆盖。需要并行时给每个 Worker 勾选独立 worktree（项目必须 clean）。</div>
            <div class="api-grid">${apiCards || '<div class="empty-mini">没有配置 API 模型。</div>'}</div>
            ${state.apiWorkers.length ? `<div class="selected-workers">${selectedApi}${existingNames}</div>${apiWorktreeRows}` : (existingNames ? `<div class="selected-workers">${existingNames}</div>` : "")}
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-head">
          <div class="section-title-wrap"><div class="step-num">3</div><div><div class="section-title">告诉 Planner 要做什么</div><div class="section-sub">自然语言描述目标即可；Planner 会决定下一轮任务。</div></div></div>
        </div>
        <div class="section-body">
          ${planner && planner.kind === "codex" && planner.thread.status === "failed" ? `<div class="notice">这个 Planner 的上一次回合失败了。若原因是额度不足，请先在 Codex 里切换账号或换一个对话。</div>` : ""}
          <div class="goal-wrap"><textarea id="goalInput" class="goal-input" placeholder="例如：先只读检查项目当前进度，验收 B/C/D 的交付；如果还有下一轮工作，给合适的 Worker 分配任务，并说明验收标准。">${esc(state.goal)}</textarea></div>
          <div class="goal-foot">
            <div class="advanced">最多 <input id="maxRounds" class="mini-input" type="number" min="1" max="20" value="${esc(state.maxRounds)}"> 轮 · 一个 Worker 每轮一个 task</div>
            <button id="startBtn" class="primary-btn" ${!planner || !(selectedExisting.length || state.dshWorkers.length || state.apiWorkers.length) ? "disabled" : ""}>开始运行 →</button>
          </div>
        </div>
      </div>`;
    bindSetup();
    updateInspector();
    renderRuns((state.bootstrap && state.bootstrap.runs) || []);
  }

  function bindSetup() {
    const openPlanner = $("#openPlannerCreate");
    if (openPlanner) openPlanner.addEventListener("click", () => {
      state.plannerCreateOpen = !state.plannerCreateOpen;
      state.codexCreateOpen = false;
      state.dshCreateOpen = false;
      renderSetup();
    });
    const openCodex = $("#openCodexCreate");
    if (openCodex) openCodex.addEventListener("click", () => {
      state.codexCreateOpen = !state.codexCreateOpen;
      state.plannerCreateOpen = false;
      state.dshCreateOpen = false;
      state.tab = "codex";
      renderSetup();
    });
    const openDsh = $("#openDshCreate");
    if (openDsh) openDsh.addEventListener("click", () => {
      state.dshCreateOpen = !state.dshCreateOpen;
      state.plannerCreateOpen = false;
      state.codexCreateOpen = false;
      state.tab = "dsh";
      renderSetup();
    });
    $$("[data-cancel-create]").forEach((el) => el.addEventListener("click", () => {
      const k = el.dataset.cancelCreate;
      if (k === "codex") {
        state.plannerCreateOpen = false;
        state.codexCreateOpen = false;
      } else if (state.plannerCreateOpen) {
        state.plannerCreateOpen = false;
      } else {
        state.dshCreateOpen = false;
      }
      renderSetup();
    }));
    $$("[data-create-kind]").forEach((el) => el.addEventListener("click", () => {
      createConversation(el.dataset.createKind, el.dataset.createRole);
    }));
    $$("[data-planner]").forEach((el) => el.addEventListener("click", () => {
      if (el.classList.contains("disabled")) {
        toast("这个对话仍在执行中，先等它结束");
        return;
      }
      state.plannerId = el.dataset.planner;
      state.plannerKind = "codex";
      state.plannerDshId = null;
      state.plannerTab = "codex";
      state.selectedCodex.delete(state.plannerId);
      renderSetup();
    }));
    $$("[data-planner-dsh]").forEach((el) => el.addEventListener("click", () => {
      state.plannerDshId = el.dataset.plannerDsh;
      state.plannerKind = "dsh";
      state.plannerTab = "dsh";
      state.plannerId = null;
      renderSetup();
      updateInspector();
    }));
    $$("[data-planner-tab]").forEach((el) => el.addEventListener("click", () => {
      state.plannerTab = el.dataset.plannerTab;
      renderSetup();
    }));
    $$("[data-worker]").forEach((el) => el.addEventListener("click", () => {
      const id = el.dataset.worker;
      if (state.selectedCodex.has(id)) state.selectedCodex.delete(id);
      else state.selectedCodex.add(id);
      renderSetup();
    }));
    $$("[data-add-api]").forEach((el) => el.addEventListener("click", () => {
      const m = selectedApiModel(el.dataset.addApi);
      if (!m) return;
      state.apiSeq += 1;
      state.apiWorkers.push({
        key: `api-${Date.now()}-${state.apiSeq}`,
        name: `api-${state.apiSeq}`,
        model_id: m.id,
        use_worktree: false,
      });
      state.tab = "api";
      renderSetup();
    }));
    $$("[data-add-dsh]").forEach((el) => el.addEventListener("click", () => {
      const session = state.dshSessions.find((s) => s.session_id === el.dataset.addDsh);
      if (!session) return;
      if (state.dshWorkers.some((w) => w.session_id === session.session_id)) {
        toast("这个 DSH 对话已经添加");
        return;
      }
      state.dshSeq += 1;
      state.dshWorkers.push({
        key: `dsh-${Date.now()}-${state.dshSeq}`,
        name: `dsh-${state.dshSeq}`,
        session_id: session.session_id,
        title: session.title,
        cwd: session.cwd,
        provider: session.provider,
        model: session.model,
      });
      state.tab = "dsh";
      renderSetup();
    }));
    $$("[data-remove-dsh]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.dshWorkers = state.dshWorkers.filter((w) => w.key !== el.dataset.removeDsh);
      renderSetup();
    }));
    $$("[data-remove-api]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.apiWorkers = state.apiWorkers.filter((w) => w.key !== el.dataset.removeApi);
      renderSetup();
    }));
    $$("[data-worktree]").forEach((el) => el.addEventListener("change", () => {
      const w = state.apiWorkers.find((x) => x.key === el.dataset.worktree);
      if (w) w.use_worktree = el.checked;
      updateInspector();
    }));
    $$("[data-tab]").forEach((el) => el.addEventListener("click", () => {
      state.tab = el.dataset.tab;
      renderSetup();
    }));
    const goal = $("#goalInput");
    if (goal) goal.addEventListener("input", () => { state.goal = goal.value; });
    const rounds = $("#maxRounds");
    if (rounds) rounds.addEventListener("change", () => { state.maxRounds = Number(rounds.value) || 5; });
    const start = $("#startBtn");
    if (start) start.addEventListener("click", startRun);
  }

  async function startRun() {
    const planner = plannerSelection();
    if (!planner) return toast("先选择一个 Planner 对话");
    const existing = workerThreads().filter((t) => state.selectedCodex.has(t.id));
    if (!existing.length && !state.dshWorkers.length && !state.apiWorkers.length) return toast("至少配置一个 Worker");
    const goal = ($("#goalInput") && $("#goalInput").value || state.goal || "").trim();
    if (!goal) return toast("告诉 Planner 这次要做什么");
    const workers = [];
    existing.forEach((t, i) => workers.push({
      name: `codex-${String(i + 1).padStart(2, "0")}`,
      kind: "codex",
      thread_id: t.id,
      timeout_minutes: 60,
    }));
    state.dshWorkers.forEach((w) => workers.push({
      name: w.name,
      kind: "dsh",
      session_id: w.session_id,
      timeout_minutes: 60,
    }));
    state.apiWorkers.forEach((w) => workers.push({
      name: w.name,
      kind: "api",
      model_id: w.model_id,
      use_worktree: !!w.use_worktree,
      timeout_minutes: 60,
    }));
    const btn = $("#startBtn");
    if (btn) { btn.disabled = true; btn.textContent = "启动中..."; }
    try {
      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          project_id: state.project.id || "",
          project_path: state.project.path,
          planner_kind: planner.kind,
          planner_thread_id: planner.kind === "codex" ? planner.thread.id : "",
          planner_session_id: planner.kind === "dsh" ? planner.session.session_id : "",
          goal,
          workers,
          max_rounds: state.maxRounds || 5,
        }),
      });
      state.run = run;
      state.view = "run";
      if (state.bootstrap) {
        state.bootstrap.runs = [run].concat(state.bootstrap.runs || []).slice(0, 30);
      }
      showRun(run);
      startPolling(run.id);
    } catch (err) {
      toast(err.message);
      if (btn) { btn.disabled = false; btn.textContent = "开始运行 →"; }
    }
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function startPolling(id) {
    stopPolling();
    state.pollTimer = setInterval(async () => {
      try {
        const run = await api("/api/runs/" + encodeURIComponent(id));
        state.run = run;
        showRun(run, false);
        if (["done", "blocked", "failed", "stopped", "paused"].includes(run.status)) {
          stopPolling();
        }
      } catch (err) {
        // Keep polling through transient errors, but don't spam.
      }
    }, 1800);
  }

  async function openRun(id, notify = true) {
    try {
      const run = await api("/api/runs/" + encodeURIComponent(id));
      state.run = run;
      state.view = "run";
      showRun(run);
      if (!["done", "blocked", "failed", "stopped", "paused"].includes(run.status)) startPolling(id);
    } catch (err) {
      if (notify) toast(err.message);
    }
  }

  function taskStatusLabel(t) {
    if (t.status === "completed") return "完成";
    if (t.status === "done") return "完成";
    if (t.status === "blocked") return "需要决策";
    if (t.status === "failed") return "失败";
    if (t.status === "running") return "执行中";
    if (t.status === "queued") return "排队中";
    return t.status || "未知";
  }

  function showRun(run, scroll = true) {
    state.run = run;
    if (state.bootstrap && state.bootstrap.runs) {
      const item = state.bootstrap.runs.find((r) => r.id === run.id);
      if (item) {
        item.status = run.status;
        item.phase = run.phase;
        item.round = run.round;
        item.updated_at = run.updated_at;
        item.goal = run.goal;
      } else {
        state.bootstrap.runs.unshift({
          id: run.id,
          created_at: run.created_at,
          updated_at: run.updated_at,
          status: run.status,
          phase: run.phase,
          round: run.round,
          goal: run.goal,
          project_path: run.project_path,
        });
      }
    }
    const p = state.project || { path: run.project_path, name: (run.project_path || "").split("\\").pop() };
    if (p) {
      state.project = state.project || { path: run.project_path, name: p.name };
      $("#topProject").textContent = p.name || p.path;
    }
    const planner = state.threads.find((t) => t.id === run.planner_thread_id);
    const tasks = run.tasks || [];
    const rounds = [...new Set(tasks.map((t) => t.round))].sort((a, b) => a - b);
    const taskHtml = rounds.map((r) => `<div class="round-label">第 ${r} 轮</div>${tasks.filter((t) => t.round === r).map((t) => `
      <div class="task-card">
        <div class="task-head">
          <span class="status-dot ${t.status === "done" || t.status === "completed" ? "good" : t.status === "failed" ? "bad" : t.status === "running" ? "warn" : ""}"></span>
          <span class="task-worker">${esc(t.worker)}</span>
          <span class="task-id">${esc(t.task_id)}</span>
          <span class="badge">${esc(t.difficulty || "medium")}</span>
          <span style="margin-left:auto" class="badge ${statusClass(t.status)}">${esc(taskStatusLabel(t))}</span>
        </div>
        <div class="task-body">
          <div class="task-prompt">${esc(t.prompt)}</div>
          ${t.text ? `<div class="task-result">${esc(short(t.text, 2200))}</div>` : ""}
          ${t.error ? `<div class="task-result" style="color:var(--bad)">${esc(t.error)}</div>` : ""}
        </div>
      </div>`).join("")}`).join("") || `<div class="empty-mini">还没有任务。Planner 正在规划。</div>`;
    const plannerHtml = (run.planner_messages || []).map((m, i) => `<details class="planner-msg" ${i === (run.planner_messages || []).length - 1 ? "open" : ""}>
      <summary><span class="badge accent">R${esc(m.round)}</span><span>Planner ${m.status === "waiting" ? "等待回复" : "回复"}</span><span style="margin-left:auto;color:var(--muted-2)">${esc(fmtDate(m.ts))}</span></summary>
      <div class="msg-body">${esc(m.answer || "等待 Planner 回复...")}</div>
    </details>`).join("") || `<div class="empty-mini">等待 Planner 产生第一条计划。</div>`;
    const events = (run.events || []).slice(-50).reverse();
    const eventHtml = events.map((e) => `<div class="event-row ${e.kind === "error" ? "bad" : e.kind === "paused" || e.kind === "task_finished" ? "warn" : "good"}">
      <span class="event-time">${esc((e.ts || "").slice(11, 16))}</span><span class="event-dot"></span><span>${esc(e.message || e.kind)}</span>
    </div>`).join("") || `<div class="empty-mini">还没有事件。</div>`;
    const canStop = !["done", "blocked", "failed", "stopped", "paused"].includes(run.status);
    const canContinue = ["done", "blocked", "failed", "stopped"].includes(run.status);
    const continueHtml = canContinue ? `<div class="continue-panel">
      <div class="continue-head"><div><div class="panel-title">继续这个记录，并给 Planner 指令</div><div class="panel-sub">沿用同一个 Planner 和 Worker 池；Planner 会看到这条追加要求。</div></div><span class="badge">R${esc(run.round || 0)}</span></div>
      <textarea id="continueGoal" class="goal-input" placeholder="例如：前面的规划是……；codex-01/codex-03 已经在执行，不要重复启动；请把 X 交给 Y，完成后回来验收。"></textarea>
      <div class="continue-foot"><span>追加 <input id="continueRounds" class="mini-input" type="number" min="1" max="20" value="2"> 轮</span><button id="continueRunBtn" class="primary-btn">追加运行</button></div>
    </div>` : "";
    const noteHtml = run.status === "running" || run.status === "paused" ? `<div class="continue-panel note-panel">
      <div class="continue-head"><div><div class="panel-title">给 Planner 留话</div><div class="panel-sub">不会打断正在执行的 Worker；Planner 处理下一轮时会看到。</div></div><span class="badge">Queued note</span></div>
      <textarea id="plannerNote" class="goal-input" placeholder="例如：前面的规划是……；两个任务已经在执行，请把 X 交给 Y，不要重复启动。"></textarea>
      <div class="continue-foot"><span>${esc((run.planner_notes || []).length)} 条待读</span><button id="addPlannerNote" class="secondary-btn">留给 Planner</button></div>
    </div>` : "";
    const latestRound = Math.max(0, ...(run.tasks || []).map((t) => Number(t.round) || 0));
    const interruptedTasks = (run.tasks || []).filter((t) => Number(t.round) === latestRound && ["failed", "blocked", "stopped", "interrupted"].includes(t.status));
    const resumeHtml = interruptedTasks.length && !["running", "stopping", "paused"].includes(run.status) ? `<div class="continue-panel resume-panel">
      <div class="continue-head"><div><div class="panel-title">恢复中断的任务</div><div class="panel-sub">只重跑失败、阻塞或停止的任务，不碰已完成的对话；完成后交给 Planner 检查。</div></div><span class="badge">${interruptedTasks.length} 个中断</span></div>
      <div class="resume-note">已发出的任务会发送续跑指令：“前面因为额度问题中断，现在继续前面的任务。”；完全没有发出的任务会重发原始提示词，不会错误地续跑空对话。</div>
      <div class="continue-foot"><span>${interruptedTasks.map((t) => esc(t.worker)).join(" · ")}</span><button id="resumeInterruptedBtn" class="primary-btn">恢复中断任务</button></div>
    </div>` : "";
    $("#main").innerHTML = `
      <div class="run-head">
        <div>
          <div class="setup-eyebrow">Run record</div>
          <div class="run-title">${esc(run.goal || "未命名运行")}</div>
          <div class="run-goal">${esc(run.project_path || "")}</div>
        </div>
        <div class="run-actions">
          <span class="status-pill ${statusClass(run.status)}">${esc(statusLabel(run.status))}</span>
          ${run.status === "paused" ? `<button class="secondary-btn" id="resumeRun">切换账号后继续</button>` : ""}
          ${canContinue ? `<button class="secondary-btn" id="continueFocus">继续记录</button>` : ""}
          ${canStop ? `<button class="secondary-btn danger-btn" id="stopRun">停止</button>` : ""}
          <button class="secondary-btn" id="newRun">新建运行</button>
        </div>
      </div>
      <div class="run-meta-grid">
        <div class="meta-card"><div class="meta-label">Planner</div><div class="meta-value mono">${esc(run.planner_model || "thread 默认")}</div></div>
        <div class="meta-card"><div class="meta-label">Worker</div><div class="meta-value">${esc((run.workers || []).length)} 个</div></div>
        <div class="meta-card"><div class="meta-label">轮次</div><div class="meta-value">${esc(run.round || 0)} / ${esc(run.max_rounds || 0)}</div></div>
        <div class="meta-card"><div class="meta-label">Run ID</div><div class="meta-value mono">${esc(run.id || "-")}</div></div>
      </div>
      ${run.error ? `<div class="notice">${esc(run.error)}</div>` : ""}
      ${continueHtml}
      ${noteHtml}
      ${resumeHtml}
      <div class="run-columns">
        <div>
          <div class="panel" style="margin-bottom:15px">
            <div class="panel-head"><div><div class="panel-title">Planner 对话</div><div class="panel-sub">同一个 Codex thread；模型由该对话决定。</div></div><span class="badge mono">${esc(run.planner_thread_id ? run.planner_thread_id.slice(0, 8) : "")}</span></div>
            <div class="panel-body">${plannerHtml}</div>
          </div>
          <div class="panel">
            <div class="panel-head"><div><div class="panel-title">任务</div><div class="panel-sub">Worker 由 Planner 按可用池选择。</div></div><span class="badge">${tasks.length}</span></div>
            <div class="panel-body"><div class="task-list">${taskHtml}</div></div>
          </div>
        </div>
        <div>
          <div class="panel">
            <div class="panel-head"><div><div class="panel-title">运行事件</div><div class="panel-sub">最近 50 条</div></div></div>
            <div class="panel-body"><div class="event-list">${eventHtml}</div></div>
          </div>
          <div class="panel" style="margin-top:15px">
            <div class="panel-head"><div><div class="panel-title">Worker 池</div><div class="panel-sub">本轮可用</div></div></div>
            <div class="panel-body">
              ${(run.workers || []).map((w) => `<div class="info-row"><span class="k">${esc(w.name)}</span><span class="v">${esc(w.kind === "api" ? `${w.provider}/${w.model}` : w.kind === "dsh" ? `DSH · ${w.title || w.session_id}` : w.model || "Codex")}</span></div>`).join("") || '<div class="empty-mini">没有 Worker</div>'}
            </div>
          </div>
        </div>
      </div>`;
    $("#stopRun")?.addEventListener("click", async () => {
      try {
        await api(`/api/runs/${encodeURIComponent(run.id)}/stop`, { method: "POST", body: "{}" });
        toast("已请求停止；当前 Worker 结束后停止。");
      } catch (err) { toast(err.message); }
    });
    $("#resumeRun")?.addEventListener("click", async () => {
      try {
        const next = await api(`/api/runs/${encodeURIComponent(run.id)}/resume`, { method: "POST", body: "{}" });
        state.run = next;
        toast("已继续；Planner 会重新读取同一 thread。");
        showRun(next);
        startPolling(next.id);
      } catch (err) { toast(err.message); }
    });
    $("#resumeInterruptedBtn")?.addEventListener("click", async () => {
      const btn = $("#resumeInterruptedBtn");
      if (btn) { btn.disabled = true; btn.textContent = "恢复中..."; }
      try {
        const next = await api(`/api/runs/${encodeURIComponent(run.id)}/resume-interrupted`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        state.run = next;
        toast("已开始恢复中断任务；已完成的对话不会重跑。");
        showRun(next, false);
      } catch (err) {
        toast(err.message);
        if (btn) { btn.disabled = false; btn.textContent = "恢复中断任务"; }
      }
    });
    $("#addPlannerNote")?.addEventListener("click", async () => {
      const text = ($("#plannerNote")?.value || "").trim();
      if (!text) return toast("写下要留给 Planner 的话");
      const btn = $("#addPlannerNote");
      if (btn) { btn.disabled = true; btn.textContent = "提交中..."; }
      try {
        const next = await api(`/api/runs/${encodeURIComponent(run.id)}/note`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        state.run = next;
        toast("已留给 Planner；当前 Worker 不受影响。");
        showRun(next, false);
      } catch (err) {
        toast(err.message);
        if (btn) { btn.disabled = false; btn.textContent = "留给 Planner"; }
      }
    });
    $("#continueFocus")?.addEventListener("click", () => {
      const el = $("#continueGoal");
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
    });
    $("#continueRunBtn")?.addEventListener("click", async () => {
      const instruction = ($("#continueGoal")?.value || "").trim();
      const additional = Number($("#continueRounds")?.value || 2);
      if (!instruction) return toast("写下追加要求");
      const btn = $("#continueRunBtn");
      if (btn) { btn.disabled = true; btn.textContent = "追加中..."; }
      try {
        const next = await api(`/api/runs/${encodeURIComponent(run.id)}/continue`, {
          method: "POST",
          body: JSON.stringify({ instruction, additional_rounds: additional }),
        });
        state.run = next;
        toast(`已追加 ${additional} 轮，沿用同一个 Planner 与 Worker 池。`);
        showRun(next);
        startPolling(next.id);
      } catch (err) {
        toast(err.message);
        if (btn) { btn.disabled = false; btn.textContent = "追加运行"; }
      }
    });
    $("#newRun")?.addEventListener("click", () => { stopPolling(); showSetup(); });
    updateInspector();
    renderRuns((state.bootstrap && state.bootstrap.runs) || []);
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showSetup() {
    stopPolling();
    state.view = "setup";
    state.run = null;
    renderSetup();
  }

  function updateInspector() {
    const title = $("#inspectorTitle");
    const body = $("#inspectorBody");
    if (state.view === "run" && state.run) {
      const run = state.run;
      const tasks = run.tasks || [];
      const done = tasks.filter((t) => t.status === "done" || t.status === "completed").length;
      title.textContent = statusLabel(run.status);
      body.innerHTML = `
        <div class="hint-card"><div class="hint-title">当前运行</div><p>${esc(run.goal || "")}</p></div>
        <div class="info-row"><span class="k">Planner 模型</span><span class="v">${esc(run.planner_model || "-")}</span></div>
        <div class="info-row"><span class="k">Planner 账号</span><span class="v">在 Codex 客户端手动切换</span></div>
        <div class="info-row"><span class="k">Planner 对话</span><span class="v">${esc(run.planner_title || run.planner_thread_id || run.planner_session_id || "-")}</span></div>
        <div class="info-row"><span class="k">轮次</span><span class="v">${esc(run.round || 0)} / ${esc(run.max_rounds || 0)}</span></div>
        <div class="info-row"><span class="k">任务完成</span><span class="v">${done} / ${tasks.length}</span></div>
        <div class="info-row"><span class="k">状态</span><span class="v">${esc(statusLabel(run.status))}</span></div>
        ${run.error ? `<div class="notice" style="margin-bottom:0">${esc(run.error)}</div>` : ""}`;
      return;
    }
    const p = state.project;
    const planner = plannerSelection();
    const existing = workerThreads().filter((t) => state.selectedCodex.has(t.id));
    title.textContent = p ? "准备一次运行" : "还没有运行";
    body.innerHTML = p ? `
      <div class="hint-card"><div class="hint-title">当前项目</div><p>${esc(p.path)}</p></div>
      <div class="info-row"><span class="k">Planner</span><span class="v">${esc(planner ? planner.model || "默认模型" : "未选择")}</span></div>
      <div class="info-row"><span class="k">Planner 类型</span><span class="v">${esc(planner ? (planner.kind === "dsh" ? "DSH 对话" : "Codex 对话") : "-")}</span></div>
      <div class="info-row"><span class="k">Codex Worker</span><span class="v">${existing.length}</span></div>
      <div class="info-row"><span class="k">DSH Worker</span><span class="v">${state.dshWorkers.length}</span></div>
      <div class="info-row"><span class="k">API Worker</span><span class="v">${state.apiWorkers.length}</span></div>
      <div class="info-row"><span class="k">Planner 对话</span><span class="v">${esc(planner ? short(planner.title, 20) : "-")}</span></div>
      <div class="hint-card"><div class="hint-title">上下文</div><p>Planner 的上下文只存在于它自己的对话中；Codex 与 DSH Planner 都会继续同一个对话。</p></div>
    ` : `<div class="hint-card"><div class="hint-title">开始之前</div><p>从左侧选择一个项目。Planner 使用现有 Codex 对话及其模型；Worker 使用现有对话或 DSH API。</p></div>`;
  }

  boot();
})();
