/* ===================================================================
   TaskCube — 3D 큐브 업무 대시보드  (vanilla JS, no build)
   X축=진행 단계 / Y축=단계 내 스택 / Z축=일의 범주(깊이)
   =================================================================== */
(function () {
  "use strict";

  // ---------- constants ----------
  const STORE_KEY = "taskcube.board.v1";
  const COL_W = 290;
  const COL_GAP = 64;
  const Z_STEP = 64; // category depth step (px)
  const CATEGORIES = ["디자인", "개발", "버그", "문서", "리서치", "기획"];
  const CATEGORY_Z = {}; // 첫 번째 범주 → 깊이 평면
  CATEGORIES.forEach((c, i) => (CATEGORY_Z[c] = -i * Z_STEP));

  const ROT_MIN = -60, ROT_MAX = 60;
  const DRAG_THRESHOLD = 5;

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const uid = (p) => p + Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function catColor(cat) {
    const named = getComputedStyle(document.documentElement).getPropertyValue("--c-" + cat).trim();
    return named || "var(--c-기타)";
  }
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 55%)`;
  }
  function dueInfo(iso) {
    if (!iso) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(iso + "T00:00:00");
    const days = Math.round((d - today) / 86400000);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    let tag = "", cls = "";
    if (days < 0) { tag = `${-days}일 지남`; cls = "overdue"; }
    else if (days === 0) { tag = "D-DAY"; cls = "soon"; }
    else if (days <= 3) { tag = `D-${days}`; cls = "soon"; }
    return { label, tag, cls };
  }

  // ---------- default seed ----------
  function seed() {
    const mk = (title, cats, due, who, pri, note) =>
      ({ id: uid("c"), title, categories: cats, due, assignee: who, priority: pri, note: note || "" });
    const c = [
      mk("랜딩 페이지 히어로 섹션 리디자인", ["디자인"], "2026-06-03", "민", "높음", "히어로 카피 A/B 테스트 결과 반영"),
      mk("사용자 인터뷰 5건 정리 및 인사이트 도출", ["리서치", "기획"], "2026-06-08", "지", "보통"),
      mk("결제 모듈 PG사 비교 자료", ["문서"], "2026-06-15", "수", "낮음"),
      mk("OAuth 2.0 소셜 로그인 연동", ["개발"], "2026-06-01", "태", "높음", "구글/카카오/애플 우선"),
      mk("디자인 시스템 v2 토큰 정리", ["디자인", "개발"], "2026-06-05", "민", "보통"),
      mk("장바구니 수량 변경 시 합계 미갱신 버그", ["버그"], "2026-05-29", "태", "높음", "재현: 수량 +/- 연타 시"),
      mk("프로젝트 초기 세팅 및 CI 파이프라인", ["개발", "문서"], "2026-05-20", "태", "보통"),
      mk("브랜드 로고 및 컬러 가이드 확정", ["디자인"], "2026-05-15", "수", "낮음"),
    ];
    const cards = {}; c.forEach((x) => (cards[x.id] = x));
    return {
      version: 1,
      board: {
        stages: [
          { id: uid("s"), name: "할 일", cardIds: [c[0].id, c[1].id, c[2].id] },
          { id: uid("s"), name: "진행 중", cardIds: [c[3].id, c[4].id] },
          { id: uid("s"), name: "검토", cardIds: [c[5].id] },
          { id: uid("s"), name: "완료", cardIds: [c[6].id, c[7].id] },
        ],
        cards,
      },
      view: { rotX: -14, rotY: 16, mode: "3d", theme: "dark", search: "" },
    };
  }

  // ---------- state + persistence ----------
  let state = load();
  let saveTimer = null;
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return seed();
      const s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.board || !s.board.stages) return seed();
      s.view = Object.assign({ rotX: -14, rotY: 16, mode: "3d", theme: "dark", search: "" }, s.view);
      return s;
    } catch (e) { return seed(); }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  window.addEventListener("beforeunload", flush);

  // ---------- element refs ----------
  const app = $("#app");
  const board = $("#board");
  const stageEl = $("#stage");
  const scene = $("#scene");

  // ===================================================================
  //  RENDER
  // ===================================================================
  function render() {
    const { stages, cards } = state.board;
    const totalW = stages.length * COL_W + (stages.length - 1) * COL_GAP;
    board.innerHTML = "";

    stages.forEach((stage, i) => {
      const col = document.createElement("div");
      col.className = "column";
      col.dataset.stageId = stage.id;
      col.style.setProperty("--cx", (i * (COL_W + COL_GAP) - totalW / 2) + "px");

      const inner = document.createElement("div");
      inner.className = "column-inner";

      // head
      const head = document.createElement("div");
      head.className = "column-head";
      head.innerHTML =
        `<span class="col-dot"></span>` +
        `<input class="col-title" value="${esc(stage.name)}" maxlength="24" />` +
        `<span class="col-count">${stage.cardIds.length}</span>` +
        `<button class="col-del" title="단계 삭제"><svg class="icon"><use href="#i-close"/></svg></button>`;
      inner.appendChild(head);

      // card stack
      const stack = document.createElement("div");
      stack.className = "card-stack";
      stack.dataset.stageId = stage.id;
      stage.cardIds.forEach((cid) => {
        const card = cards[cid];
        if (card) stack.appendChild(buildCard(card));
      });
      inner.appendChild(stack);

      // add card
      const addBtn = document.createElement("button");
      addBtn.className = "add-card";
      addBtn.innerHTML = `<svg class="icon"><use href="#i-plus"/></svg> 카드 추가`;
      addBtn.addEventListener("click", () => openEditor(null, stage.id));
      inner.appendChild(addBtn);

      // head events
      const titleInput = head.querySelector(".col-title");
      titleInput.addEventListener("change", () => { stage.name = titleInput.value.trim() || "제목 없음"; titleInput.value = stage.name; save(); });
      titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") titleInput.blur(); });
      head.querySelector(".col-del").addEventListener("click", () => deleteStage(stage.id));

      col.appendChild(inner);
      board.appendChild(col);
    });

    applySearch();
  }

  function buildCard(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.cardId = card.id;
    const primary = card.categories[0] || "기타";
    el.style.setProperty("--cz", (CATEGORY_Z[primary] || 0) + "px");
    el.style.setProperty("--cat-color", catColor(primary));

    const chips = card.categories.map((cat) =>
      `<span class="cat-chip" style="--chip-color:${catColor(cat)}">${esc(cat)}</span>`).join("");
    const di = dueInfo(card.due);
    const dueHtml = di
      ? `<span class="due ${di.cls}"><svg class="icon"><use href="#i-cal"/></svg>${di.label}${di.tag ? ` · ${di.tag}` : ""}</span>`
      : "";
    const avHtml = card.assignee
      ? `<span class="avatar" style="--av-color:${avatarColor(card.assignee)}">${esc(card.assignee[0])}</span>`
      : "";

    el.innerHTML =
      `<div class="card-face front">` +
        (chips ? `<div class="card-cats">${chips}</div>` : "") +
        `<div class="card-title">${esc(card.title)}</div>` +
        `<div class="card-meta">${dueHtml}${avHtml}</div>` +
        `<div class="card-foot">` +
          `<span class="priority ${card.priority}"><svg class="icon"><use href="#i-bars"/></svg>${card.priority}</span>` +
          `<span class="card-actions">` +
            `<button class="card-act flip" title="뒤집기"><svg class="icon"><use href="#i-rotate"/></svg></button>` +
            `<button class="card-act edit" title="편집"><svg class="icon"><use href="#i-edit"/></svg></button>` +
            `<button class="card-act del" title="삭제"><svg class="icon"><use href="#i-trash"/></svg></button>` +
          `</span>` +
        `</div>` +
      `</div>` +
      `<div class="card-face back">` +
        `<div class="back-title">${esc(card.title)}</div>` +
        (card.note ? `<div class="back-note">${esc(card.note)}</div>` : `<div class="back-note back-empty">메모가 없습니다.</div>`) +
        `<div class="back-hint">버튼으로 다시 뒤집기</div>` +
      `</div>`;

    // actions
    el.querySelector(".flip").addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("flipped"); });
    el.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(card.id); });
    el.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); deleteCard(card.id); });

    // hover tilt
    el.addEventListener("pointermove", (e) => onTilt(e, el));
    el.addEventListener("pointerleave", () => clearTilt(el));
    // double-click spin
    el.addEventListener("dblclick", () => spin(el));
    // drag
    el.addEventListener("pointerdown", (e) => onCardPointerDown(e, el, card.id));

    return el;
  }

  // ===================================================================
  //  CRUD
  // ===================================================================
  function addStage() {
    state.board.stages.push({ id: uid("s"), name: "새 단계", cardIds: [] });
    save(); render();
  }
  function deleteStage(id) {
    const st = state.board.stages.find((s) => s.id === id);
    if (!st) return;
    if (st.cardIds.length && !confirm(`'${st.name}' 단계의 카드 ${st.cardIds.length}개도 함께 삭제됩니다. 계속할까요?`)) return;
    st.cardIds.forEach((cid) => delete state.board.cards[cid]);
    state.board.stages = state.board.stages.filter((s) => s.id !== id);
    save(); render();
  }
  function deleteCard(id) {
    delete state.board.cards[id];
    state.board.stages.forEach((s) => (s.cardIds = s.cardIds.filter((c) => c !== id)));
    save(); render();
  }

  // ===================================================================
  //  CARD EDITOR MODAL
  // ===================================================================
  const overlay = $("#modalOverlay");
  const form = $("#cardForm");
  let editingId = null, editingStageId = null;

  // category suggestion chips
  $("#catSuggest").innerHTML = CATEGORIES.map((c) =>
    `<span class="cat-chip" data-cat="${c}" style="--chip-color:${catColor(c)}">${c}</span>`).join("");
  $("#catSuggest").addEventListener("click", (e) => {
    const chip = e.target.closest(".cat-chip"); if (!chip) return;
    const inp = $("#f-categories");
    const list = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
    const cat = chip.dataset.cat;
    if (list.includes(cat)) inp.value = list.filter((x) => x !== cat).join(", ");
    else inp.value = [...list, cat].join(", ");
  });

  function openEditor(cardId, stageId) {
    editingId = cardId; editingStageId = stageId;
    const c = cardId ? state.board.cards[cardId] : null;
    $("#modalTitle").textContent = cardId ? "카드 편집" : "새 카드";
    $("#f-title").value = c ? c.title : "";
    $("#f-categories").value = c ? c.categories.join(", ") : "";
    $("#f-due").value = c ? c.due || "" : "";
    $("#f-assignee").value = c ? c.assignee || "" : "";
    $("#f-priority").value = c ? c.priority : "보통";
    $("#f-note").value = c ? c.note || "" : "";
    overlay.hidden = false;
    setTimeout(() => $("#f-title").focus(), 30);
  }
  function closeEditor() { overlay.hidden = true; editingId = editingStageId = null; }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {
      title: $("#f-title").value.trim() || "제목 없음",
      categories: $("#f-categories").value.split(",").map((s) => s.trim()).filter(Boolean),
      due: $("#f-due").value,
      assignee: $("#f-assignee").value.trim(),
      priority: $("#f-priority").value,
      note: $("#f-note").value.trim(),
    };
    if (!data.categories.length) data.categories = ["기타"];
    if (editingId) {
      Object.assign(state.board.cards[editingId], data);
    } else {
      const id = uid("c");
      state.board.cards[id] = Object.assign({ id }, data);
      const st = state.board.stages.find((s) => s.id === editingStageId) || state.board.stages[0];
      st.cardIds.push(id);
    }
    closeEditor(); save(); render();
  });
  $("#modalClose").addEventListener("click", closeEditor);
  $("#modalCancel").addEventListener("click", closeEditor);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeEditor(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeEditor(); });

  // ===================================================================
  //  CARD INTERACTIONS — tilt / spin
  // ===================================================================
  function onTilt(e, el) {
    if (state.view.mode === "flat" || el.classList.contains("flipped") || el.classList.contains("dragging") || drag) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--extra", `rotateY(${px * 10}deg) rotateX(${-py * 10}deg)`);
  }
  function clearTilt(el) {
    if (!el.classList.contains("flipped")) el.style.removeProperty("--extra");
  }
  function spin(el) {
    if (state.view.mode === "flat") return;
    el.classList.add("spinning");
    el.addEventListener("animationend", () => el.classList.remove("spinning"), { once: true });
  }

  // ===================================================================
  //  DRAG & DROP  (flatten-during-drag + pointer events)
  // ===================================================================
  let drag = null; // {cardId, el, placeholder, offX, offY, savedTransform, started}

  function onCardPointerDown(e, el, cardId) {
    if (e.button !== 0) return;
    if (e.target.closest(".card-act")) return; // let buttons work
    const startX = e.clientX, startY = e.clientY;
    const r = el.getBoundingClientRect();
    drag = {
      cardId, el, started: false,
      offX: startX - r.left, offY: startY - r.top,
      startX, startY, rafPending: false, lastEvt: e,
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onCardPointerMove);
    el.addEventListener("pointerup", onCardPointerUp, { once: true });
    el.addEventListener("pointercancel", onCardPointerUp, { once: true });
  }

  function beginDrag() {
    drag.started = true;
    const el = drag.el;
    // flatten the scene for reliable 1:1 hit-testing
    drag.savedTransform = scene.style.transform;
    scene.classList.add("no-anim");
    scene.style.transform = "none";
    // placeholder in original slot
    const ph = document.createElement("div");
    ph.className = "drop-placeholder";
    const r = el.getBoundingClientRect();
    ph.style.height = r.height + "px";
    el.parentNode.insertBefore(ph, el);
    drag.placeholder = ph;
    // lift card
    el.classList.add("dragging", "no-transition");
    el.style.removeProperty("--extra");
    document.body.appendChild(el); // detach to body for fixed positioning
  }

  function onCardPointerMove(e) {
    if (!drag) return;
    drag.lastEvt = e;
    if (!drag.started) {
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      beginDrag();
    }
    if (drag.rafPending) return;
    drag.rafPending = true;
    requestAnimationFrame(() => {
      drag.rafPending = false;
      if (!drag) return;
      const ev = drag.lastEvt;
      drag.el.style.setProperty("--dx", (ev.clientX - drag.offX) + "px");
      drag.el.style.setProperty("--dy", (ev.clientY - drag.offY) + "px");
      updateDropTarget(ev.clientX, ev.clientY);
    });
  }

  function updateDropTarget(x, y) {
    const stackEl = elementStackAt(x, y);
    if (!stackEl) return;
    const ph = drag.placeholder;
    const cards = [...stackEl.querySelectorAll(".card:not(.dragging)")];
    let ref = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { ref = c; break; }
    }
    if (ref) stackEl.insertBefore(ph, ref);
    else {
      const addBtn = stackEl.parentNode.querySelector(".add-card");
      stackEl.appendChild(ph);
    }
  }

  function elementStackAt(x, y) {
    drag.el.style.pointerEvents = "none";
    const target = document.elementFromPoint(x, y);
    if (!target) return null;
    const col = target.closest(".column");
    if (!col) return null;
    return col.querySelector(".card-stack");
  }

  function onCardPointerUp() {
    if (!drag) return;
    const el = drag.el;
    el.removeEventListener("pointermove", onCardPointerMove);

    if (!drag.started) { drag = null; return; } // was a click, not a drag

    const ph = drag.placeholder;
    const targetStackEl = ph.parentNode;
    const targetStageId = targetStackEl.dataset.stageId;
    // compute index among real cards
    const siblings = [...targetStackEl.children].filter((n) => n.classList.contains("card") || n === ph);
    const index = siblings.indexOf(ph);

    // commit to data model
    const cid = drag.cardId;
    state.board.stages.forEach((s) => (s.cardIds = s.cardIds.filter((c) => c !== cid)));
    const target = state.board.stages.find((s) => s.id === targetStageId);
    if (target) target.cardIds.splice(index, 0, cid);

    // cleanup visual
    el.classList.remove("dragging", "no-transition");
    el.style.removeProperty("--dx");
    el.style.removeProperty("--dy");
    el.style.pointerEvents = "";
    ph.remove();

    // restore scene rotation
    scene.classList.remove("no-anim");
    scene.style.transform = drag.savedTransform || "";

    drag = null;
    save(); render();
  }

  // ===================================================================
  //  VIEWPOINT — sliders, empty-space drag, mode, theme, reset
  // ===================================================================
  const rotXEl = $("#rotX"), rotYEl = $("#rotY");

  function applyRotation() {
    scene.style.transform = `translateZ(-120px) rotateX(${state.view.rotX}deg) rotateY(${state.view.rotY}deg)`;
  }
  function setRotation(rx, ry, sync) {
    state.view.rotX = clamp(Math.round(rx), ROT_MIN, ROT_MAX);
    state.view.rotY = clamp(Math.round(ry), ROT_MIN, ROT_MAX);
    if (state.view.mode === "3d") applyRotation();
    if (sync !== false) { rotXEl.value = state.view.rotX; rotYEl.value = state.view.rotY; }
    save();
  }
  rotXEl.addEventListener("input", () => setRotation(+rotXEl.value, state.view.rotY, false));
  rotYEl.addEventListener("input", () => setRotation(state.view.rotX, +rotYEl.value, false));

  // empty-space drag to rotate
  let bgDrag = null;
  stageEl.addEventListener("pointerdown", (e) => {
    if (state.view.mode === "flat") return;
    if (e.target.closest(".column") || e.target.closest(".card")) return;
    bgDrag = { x: e.clientX, y: e.clientY, rx: state.view.rotX, ry: state.view.rotY };
    stageEl.classList.add("rotating");
    scene.classList.add("no-anim");
    stageEl.setPointerCapture(e.pointerId);
  });
  stageEl.addEventListener("pointermove", (e) => {
    if (!bgDrag) return;
    const dx = e.clientX - bgDrag.x, dy = e.clientY - bgDrag.y;
    setRotation(bgDrag.rx - dy * 0.35, bgDrag.ry + dx * 0.35, true);
  });
  function endBgDrag() {
    if (!bgDrag) return;
    bgDrag = null; stageEl.classList.remove("rotating"); scene.classList.remove("no-anim");
  }
  stageEl.addEventListener("pointerup", endBgDrag);
  stageEl.addEventListener("pointercancel", endBgDrag);

  // mode toggle
  function setMode(mode) {
    state.view.mode = mode;
    app.classList.toggle("flat", mode === "flat");
    [...document.querySelectorAll(".mode-btn")].forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    if (mode === "3d") { scene.classList.remove("no-anim"); applyRotation(); }
    save();
  }
  $("#modeToggle").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-btn"); if (b) setMode(b.dataset.mode);
  });

  // reset view
  $("#resetView").addEventListener("click", () => setRotation(-14, 16, true));

  // theme
  function setTheme(t) {
    state.view.theme = t;
    document.documentElement.setAttribute("data-theme", t);
    save();
    // re-render so computed category colors refresh
    render();
  }
  $("#themeToggle").addEventListener("click", () =>
    setTheme(state.view.theme === "dark" ? "light" : "dark"));

  // add stage
  $("#addStage").addEventListener("click", addStage);

  // search
  const searchEl = $("#search");
  function applySearch() {
    const q = (state.view.search || "").trim().toLowerCase();
    document.querySelectorAll(".card").forEach((el) => {
      const card = state.board.cards[el.dataset.cardId];
      if (!card) return;
      const hay = (card.title + " " + card.categories.join(" ") + " " + (card.assignee || "")).toLowerCase();
      el.classList.toggle("dimmed", q.length > 0 && !hay.includes(q));
    });
  }
  searchEl.addEventListener("input", () => { state.view.search = searchEl.value; applySearch(); save(); });

  // ===================================================================
  //  UTILITIES — toast, clipboard, download
  // ===================================================================
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => (t.hidden = true), 250);
    }, 2000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      ta.remove(); return true;
    }
  }
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function dateStamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  // ===================================================================
  //  CSV  export / import
  // ===================================================================
  const CSV_COLS = ["stage", "title", "categories", "due", "assignee", "priority", "note"];
  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportCsv() {
    const rows = [CSV_COLS.slice()];
    state.board.stages.forEach((st) => {
      st.cardIds.forEach((cid) => {
        const c = state.board.cards[cid]; if (!c) return;
        rows.push([st.name, c.title, c.categories.join("|"), c.due || "", c.assignee || "", c.priority || "", c.note || ""]);
      });
    });
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    download(`taskcube-${dateStamp()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    toast(`${rows.length - 1}개 카드를 내보냈습니다`);
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], field = "", i = 0, q = false;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function importCsv(text) {
    const rows = parseCsv(text).filter((r) => r.some((c) => (c || "").trim() !== ""));
    if (!rows.length) { toast("빈 CSV 파일입니다"); return; }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {}; let start = 0;
    if (header.some((h) => CSV_COLS.includes(h))) { CSV_COLS.forEach((k) => (idx[k] = header.indexOf(k))); start = 1; }
    else CSV_COLS.forEach((k, n) => (idx[k] = n));
    const get = (row, k) => (idx[k] >= 0 && row[idx[k]] != null ? row[idx[k]].trim() : "");
    let count = 0;
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      const title = get(row, "title"); if (!title) continue;
      const cats = get(row, "categories").split(/[|,]/).map((s) => s.trim()).filter(Boolean);
      const pri = get(row, "priority");
      const card = {
        id: uid("c"), title,
        categories: cats.length ? cats : ["기타"],
        due: get(row, "due"), assignee: get(row, "assignee"),
        priority: ["높음", "보통", "낮음"].includes(pri) ? pri : "보통",
        note: get(row, "note"),
      };
      const stageName = get(row, "stage") || (state.board.stages[0] && state.board.stages[0].name) || "할 일";
      let st = state.board.stages.find((s) => s.name === stageName);
      if (!st) { st = { id: uid("s"), name: stageName, cardIds: [] }; state.board.stages.push(st); }
      state.board.cards[card.id] = card; st.cardIds.push(card.id); count++;
    }
    flush(); render();
    toast(count ? `${count}개 카드를 가져왔습니다` : "가져올 카드가 없습니다");
  }

  // ===================================================================
  //  SHARE  link/code encode-decode + merge
  // ===================================================================
  function b64encodeUtf8(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decodeUtf8(b64) {
    b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return decodeURIComponent(escape(atob(b64)));
  }
  function makeShareUrl() {
    const code = b64encodeUtf8(JSON.stringify({ v: 1, board: state.board }));
    return { code, url: location.origin + location.pathname + "#share=" + code };
  }
  function mergeBoard(incoming) {
    incoming.stages.forEach((inStage) => {
      let target = state.board.stages.find((s) => s.name === inStage.name);
      if (!target) { target = { id: uid("s"), name: inStage.name, cardIds: [] }; state.board.stages.push(target); }
      (inStage.cardIds || []).forEach((oldId) => {
        const c = incoming.cards[oldId]; if (!c) return;
        const nid = uid("c");
        state.board.cards[nid] = Object.assign({}, c, { id: nid });
        target.cardIds.push(nid);
      });
    });
  }
  function checkSharedHash() {
    const m = location.hash.match(/share=([^&]+)/);
    if (!m) return;
    try {
      const data = JSON.parse(b64decodeUtf8(m[1]));
      if (data && data.board && Array.isArray(data.board.stages)) {
        const nCards = Object.keys(data.board.cards || {}).length;
        const nStages = data.board.stages.length;
        if (confirm(`친구가 공유한 보드를 내 보드에 병합할까요?\n단계 ${nStages}개 · 카드 ${nCards}개`)) {
          mergeBoard(data.board); flush();
          setTimeout(() => toast("공유된 보드를 병합했습니다"), 200);
        }
      }
    } catch (e) { /* malformed share data — ignore */ }
    history.replaceState(null, "", location.pathname + location.search);
  }

  // ---------- share/export menu wiring ----------
  const shareMenu = $("#shareMenu");
  $("#shareMenuBtn").addEventListener("click", (e) => { e.stopPropagation(); shareMenu.hidden = !shareMenu.hidden; });
  shareMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { shareMenu.hidden = true; });
  $("#mExportCsv").addEventListener("click", () => { shareMenu.hidden = true; exportCsv(); });
  $("#mImportCsv").addEventListener("click", () => { shareMenu.hidden = true; $("#csvFile").click(); });
  $("#csvFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => importCsv(String(rd.result));
    rd.readAsText(f); e.target.value = "";
  });

  // ---------- share modal ----------
  const shareOverlay = $("#shareOverlay");
  function openShare() {
    $("#shareUrl").value = makeShareUrl().url;
    shareOverlay.hidden = false;
    setTimeout(() => $("#shareUrl").select(), 30);
  }
  function closeShare() { shareOverlay.hidden = true; }
  $("#mShareLink").addEventListener("click", () => { shareMenu.hidden = true; openShare(); });
  $("#shareClose").addEventListener("click", closeShare);
  shareOverlay.addEventListener("click", (e) => { if (e.target === shareOverlay) closeShare(); });
  $("#shareCopy").addEventListener("click", async () => { await copyText($("#shareUrl").value); toast("링크를 복사했습니다"); });
  $("#shareCopyCode").addEventListener("click", async () => {
    await copyText(($("#shareUrl").value.split("#share=")[1]) || ""); toast("코드를 복사했습니다");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !shareOverlay.hidden) closeShare(); });

  // ===================================================================
  //  BOOT
  // ===================================================================
  function boot() {
    document.documentElement.setAttribute("data-theme", state.view.theme);
    rotXEl.value = state.view.rotX;
    rotYEl.value = state.view.rotY;
    searchEl.value = state.view.search || "";
    setMode(state.view.mode);
    if (state.view.mode === "3d") applyRotation();
    checkSharedHash();
    render();
  }
  boot();
})();
