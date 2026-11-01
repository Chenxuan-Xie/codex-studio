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

  async function boot() {
    applyTheme(localStorage.getItem("codex-studio-theme") || "light");
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "api") state.tab = "api";
    if (params.get("tab") === "dsh") state.tab = "dsh";
    $("#themeBtn").addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
    $("#refreshBtn").addEventListener("click", () => loadBootstrap(false));
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

  function workerThreads() {
    return state.threads.filter((t) => t.id !== state.plannerId);
  }

  function apiModel() {
    return (state.bootstrap && state.bootstrap.models) || [];
  }

  function selectedApiModel(id) {
    return apiModel().find((m) => m.id === id) || null;
  }

  function renderSetup() {
    state.view = "setup";
    const p = state.project;
    if (!p) {
      $("#main").innerHTML = `<div class="empty-state"><div class="empty-mark">CS</div><h1>选择一个项目</h1><p>从左侧选择项目，或先添加一个 Codex 项目。</p></div>`;
      return;
    }
    $("#topProject").textContent = p.name || p.path;
    const planner = plannerThread();
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
          <div class="setup-eyebrow">New orchestration</div>
          <h1 class="setup-title">从项目到任务，交给 Planner</h1>
          <p class="setup-sub">选一个现有 Codex 对话作为 Planner，它会使用该对话当前的模型和上下文。Worker 可以是项目里的现有对话，也可以是新的 DSH/API worker。</p>
        </div>
        <div class="project-chip"><span>▣</span><span>${esc(p.path)}</span></div>
      </div>
      <div class="section">
        <div class="section-head">
          <div class="section-title-wrap"><div class="step-num">1</div><div><div class="section-title">选择 Planner 对话</div><div class="section-sub">使用该对话的模型与上下文；账号切换在 Codex 里完成，应用继续同一个 thread。</div></div></div>
          ${planner ? `<span class="badge mono">${esc(planner.model || "thread 默认模型")}</span>` : ""}
        </div>
        <div class="section-body"><div class="thread-list">${plannerHtml}</div></div>
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
            <div class="thread-list">${existingHtml}</div>
            ${selectedExisting.length ? `<div class="selected-workers">${existingNames}</div>` : ""}
          </div>
          <div class="tab-panel ${state.tab === "dsh" ? "active" : ""}" id="tabDsh">
            <div class="notice info">DSH Worker 会继续你选中的 DeepSeek Harness 原会话，不会新建一次性 headless 会话。若该对话正在 DSH 客户端里执行，ACP 会提示被占用。</div>
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
          ${planner && planner.status === "failed" ? `<div class="notice">这个 Planner 的上一次回合失败了。若原因是额度不足，请先在 Codex 里切换账号或换一个对话。</div>` : ""}
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
    $$("[data-planner]").forEach((el) => el.addEventListener("click", () => {
      if (el.classList.contains("disabled")) {
        toast("这个对话仍在执行中，先等它结束");
        return;
      }
      state.plannerId = el.dataset.planner;
      state.selectedCodex.delete(state.plannerId);
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
    const planner = plannerThread();
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
          planner_thread_id: planner.id,
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
    $("#main").innerHTML = `
      <div class="run-head">
        <div>
          <div class="setup-eyebrow">Orchestration run</div>
          <div class="run-title">${esc(run.goal || "未命名运行")}</div>
          <div class="run-goal">${esc(run.project_path || "")}</div>
        </div>
        <div class="run-actions">
          <span class="status-pill ${statusClass(run.status)}">${esc(statusLabel(run.status))}</span>
          ${run.status === "paused" ? `<button class="secondary-btn" id="resumeRun">切换账号后继续</button>` : ""}
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
        <div class="info-row"><span class="k">Planner thread</span><span class="v">${esc(run.planner_thread_id || "-")}</span></div>
        <div class="info-row"><span class="k">轮次</span><span class="v">${esc(run.round || 0)} / ${esc(run.max_rounds || 0)}</span></div>
        <div class="info-row"><span class="k">任务完成</span><span class="v">${done} / ${tasks.length}</span></div>
        <div class="info-row"><span class="k">状态</span><span class="v">${esc(statusLabel(run.status))}</span></div>
        ${run.error ? `<div class="notice" style="margin-bottom:0">${esc(run.error)}</div>` : ""}`;
      return;
    }
    const p = state.project;
    const planner = plannerThread();
    const existing = workerThreads().filter((t) => state.selectedCodex.has(t.id));
    title.textContent = p ? "准备一次运行" : "还没有运行";
    body.innerHTML = p ? `
      <div class="hint-card"><div class="hint-title">当前项目</div><p>${esc(p.path)}</p></div>
      <div class="info-row"><span class="k">Planner</span><span class="v">${esc(planner ? planner.model || "thread 默认" : "未选择")}</span></div>
      <div class="info-row"><span class="k">Planner 账号</span><span class="v">在 Codex 客户端切换</span></div>
      <div class="info-row"><span class="k">Codex Worker</span><span class="v">${existing.length}</span></div>
      <div class="info-row"><span class="k">DSH Worker</span><span class="v">${state.dshWorkers.length}</span></div>
      <div class="info-row"><span class="k">API Worker</span><span class="v">${state.apiWorkers.length}</span></div>
      <div class="info-row"><span class="k">Planner thread</span><span class="v">${esc(planner ? planner.id.slice(0, 8) : "-")}</span></div>
      <div class="hint-card"><div class="hint-title">上下文</div><p>Planner 的上下文只存在于 Codex thread 中。应用不会复制或伪造第二份 Planner 上下文。</p></div>
    ` : `<div class="hint-card"><div class="hint-title">开始之前</div><p>从左侧选择一个项目。Planner 使用现有 Codex 对话及其模型；Worker 使用现有对话或 DSH API。</p></div>`;
  }

  boot();
})();
