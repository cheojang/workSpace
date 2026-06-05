/* ===================================================================
   TaskCube — 3D 업무 대시보드  (vanilla JS, no build)
   X축=진행 단계 / Y축=단계 내 스택 / Z축=대분류(프로젝트) 깊이
   =================================================================== */
(function () {
  "use strict";

  // ---------- constants ----------
  const STORE_KEY = "taskcube.board.v1";
  const COL_W = 290;
  const COL_GAP = 64;
  const GROUP_Z_STEP = 560; // 대분류 한 칸당 깊이(px)
  const CATEGORIES = ["디자인", "개발", "버그", "문서", "리서치", "기획"];

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
  function mkCard(title, cats, due, who, pri, note) {
    return { id: uid("c"), title, categories: cats, due, assignee: who, priority: pri, note: note || "" };
  }
  // 표준 워크플로우(할일/진행중/검토/완료)에 카드를 분배해 대분류 보드 하나를 만든다
  function mkGroup(name, buckets) {
    const cards = {};
    const stages = ["할 일", "진행 중", "검토", "완료"].map((sn, i) => {
      const list = (buckets[i] || []).map((card) => { cards[card.id] = card; return card.id; });
      return { id: uid("s"), name: sn, cardIds: list };
    });
    return { id: uid("g"), name, stages, cards };
  }
  function seed() {
    const home = mkGroup("집안일", [
      [ mkCard("주말 장보기 목록 정리", ["기타"], "2026-06-07", "나", "보통", "우유, 계란, 세제"),
        mkCard("욕실 청소", ["기타"], "2026-06-05", "나", "낮음") ],
      [ mkCard("거실 정리 및 분리수거", ["기타"], "2026-06-03", "나", "보통") ],
      [ mkCard("가계부 5월 결산 확인", ["문서"], "", "나", "낮음") ],
      [ mkCard("에어컨 필터 청소", ["기타"], "2026-05-28", "나", "낮음") ],
    ]);
    const work = mkGroup("회사일", [
      [ mkCard("랜딩 페이지 히어로 섹션 리디자인", ["디자인"], "2026-06-03", "민", "높음", "히어로 카피 A/B 테스트 결과 반영"),
        mkCard("사용자 인터뷰 5건 정리 및 인사이트 도출", ["리서치", "기획"], "2026-06-08", "지", "보통"),
        mkCard("결제 모듈 PG사 비교 자료", ["문서"], "2026-06-15", "수", "낮음") ],
      [ mkCard("OAuth 2.0 소셜 로그인 연동", ["개발"], "2026-06-01", "태", "높음", "구글/카카오/애플 우선"),
        mkCard("디자인 시스템 v2 토큰 정리", ["디자인", "개발"], "2026-06-05", "민", "보통") ],
      [ mkCard("장바구니 수량 변경 시 합계 미갱신 버그", ["버그"], "2026-05-29", "태", "높음", "재현: 수량 +/- 연타 시") ],
      [ mkCard("프로젝트 초기 세팅 및 CI 파이프라인", ["개발", "문서"], "2026-05-20", "태", "보통"),
        mkCard("브랜드 로고 및 컬러 가이드 확정", ["디자인"], "2026-05-15", "수", "낮음") ],
    ]);
    return {
      version: 2,
      groups: [home, work],
      view: { rotX: -14, rotY: 16, mode: "3d", theme: "dark", search: "", focus: 0, zoom: 1, panX: 0, panY: 0 },
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
      // v1(단일 board) → v2(대분류 groups) 마이그레이션
      if (s && s.version === 1 && s.board && s.board.stages) {
        s.groups = [{ id: uid("g"), name: "기본", stages: s.board.stages, cards: s.board.cards }];
        delete s.board;
        s.version = 2;
      }
      if (!s || s.version !== 2 || !Array.isArray(s.groups) || !s.groups.length) return seed();
      s.view = Object.assign({ rotX: -14, rotY: 16, mode: "3d", theme: "dark", search: "", focus: 0, zoom: 1, panX: 0, panY: 0 }, s.view);
      s.view.focus = clamp(s.view.focus | 0, 0, s.groups.length - 1);
      return s;
    } catch (e) { return seed(); }
  }
  // 현재 활성 대분류(보드)
  function activeGroup() {
    return state.groups[clamp(state.view.focus | 0, 0, state.groups.length - 1)];
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
    board.innerHTML = "";
    const focus = clamp(state.view.focus | 0, 0, state.groups.length - 1);

    // 대분류(보드)마다 group-board를 만들어 Z축 깊이로 배치
    state.groups.forEach((group, gi) => {
      const gb = document.createElement("div");
      gb.className = "group-board" + (gi === focus ? " active" : "");
      gb.dataset.groupId = group.id;
      gb.style.setProperty("--gz", (-gi * GROUP_Z_STEP) + "px");

      const stages = group.stages;
      const totalW = stages.length * COL_W + (stages.length - 1) * COL_GAP;
      stages.forEach((stage, i) => gb.appendChild(buildColumn(group, stage, i, totalW)));
      board.appendChild(gb);
    });

    applyView();
    applySearch();
    applyFocus();
  }

  function buildColumn(group, stage, i, totalW) {
    const cards = group.cards;
    const col = document.createElement("div");
    col.className = "column";
    col.dataset.stageId = stage.id;
    col.style.setProperty("--cx", (i * (COL_W + COL_GAP)) + "px"); // 좌측 정렬 — 첫 단계 위치 고정, 늘면 우측으로

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
    return col;
  }

  function buildCard(card) {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.cardId = card.id;
    const primary = card.categories[0] || "기타";
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
        `<button class="back-flip"><svg class="icon"><use href="#i-rotate"/></svg> 다시 뒤집기</button>` +
      `</div>`;

    // actions
    el.querySelector(".flip").addEventListener("click", (e) => { e.stopPropagation(); el.classList.toggle("flipped"); });
    el.querySelector(".back-flip").addEventListener("click", (e) => { e.stopPropagation(); el.classList.remove("flipped"); });
    el.querySelector(".edit").addEventListener("click", (e) => { e.stopPropagation(); openEditor(card.id); });
    el.querySelector(".del").addEventListener("click", (e) => { e.stopPropagation(); deleteCard(card.id); });

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
    activeGroup().stages.push({ id: uid("s"), name: "새 단계", cardIds: [] });
    save(); render();
  }
  function deleteStage(id) {
    const g = activeGroup();
    const st = g.stages.find((s) => s.id === id);
    if (!st) return;
    if (st.cardIds.length && !confirm(`'${st.name}' 단계의 카드 ${st.cardIds.length}개도 함께 삭제됩니다. 계속할까요?`)) return;
    st.cardIds.forEach((cid) => delete g.cards[cid]);
    g.stages = g.stages.filter((s) => s.id !== id);
    save(); render();
  }
  function deleteCard(id) {
    const g = activeGroup();
    delete g.cards[id];
    g.stages.forEach((s) => (s.cardIds = s.cardIds.filter((c) => c !== id)));
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
    const c = cardId ? activeGroup().cards[cardId] : null;
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
    const g = activeGroup();
    if (editingId) {
      Object.assign(g.cards[editingId], data);
    } else {
      const id = uid("c");
      g.cards[id] = Object.assign({ id }, data);
      const st = g.stages.find((s) => s.id === editingStageId) || g.stages[0];
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
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    // document 레벨에 등록 → 카드를 body로 옮겨도 끊기지 않음
    document.addEventListener("pointermove", onCardPointerMove);
    document.addEventListener("pointerup", onCardPointerUp, { once: true });
    document.addEventListener("pointercancel", onCardPointerUp, { once: true });
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
    document.removeEventListener("pointermove", onCardPointerMove);

    if (!drag.started) { drag = null; return; } // was a click, not a drag

    const ph = drag.placeholder;
    const targetStackEl = ph.parentNode;
    const targetStageId = targetStackEl.dataset.stageId;
    // compute index among real cards
    const siblings = [...targetStackEl.children].filter((n) => n.classList.contains("card") || n === ph);
    const index = siblings.indexOf(ph);

    // commit to data model (활성 대분류 내에서만 이동)
    const cid = drag.cardId;
    const g = activeGroup();
    g.stages.forEach((s) => (s.cardIds = s.cardIds.filter((c) => c !== cid)));
    const target = g.stages.find((s) => s.id === targetStageId);
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

  function applyView() {
    if (state.view.mode === "flat") return; // 평면은 CSS가 처리
    const z = state.view.zoom || 1, px = state.view.panX || 0, py = state.view.panY || 0;
    scene.style.transform = `translate(${px}px, ${py}px) scale(${z}) translateZ(-120px) rotateX(${state.view.rotX}deg) rotateY(${state.view.rotY}deg)`;
  }
  function resetView() {
    state.view.zoom = 1; state.view.panX = 0; state.view.panY = 0;
    setRotation(-14, 16, true); // applyView + save 포함
  }
  function setRotation(rx, ry, sync) {
    state.view.rotX = clamp(Math.round(rx), ROT_MIN, ROT_MAX);
    state.view.rotY = clamp(Math.round(ry), ROT_MIN, ROT_MAX);
    if (state.view.mode !== "flat") applyView();
    updateGizmo();
    if (sync !== false) { rotXEl.value = state.view.rotX; rotYEl.value = state.view.rotY; }
    save();
  }
  // 축 범례(gizmo)를 현재 시점에 맞춰 회전 — 캐드처럼 같이 움직임
  const capX = $("#capX"), capY = $("#capY"), capZ = $("#capZ");
  function updateGizmo() {
    const gi = $("#axisInner");
    if (!gi) return;
    const rx = state.view.rotX, ry = state.view.rotY;
    gi.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    // 라벨은 축 끝에 두되 항상 정면을 보도록(빌보드) 부모 회전을 상쇄
    const bb = `rotateY(${-ry}deg) rotateX(${-rx}deg)`, L = 50;
    if (capX) capX.style.transform = `translateX(${L}px) ${bb}`;
    if (capY) capY.style.transform = `translateY(${L}px) ${bb}`;
    if (capZ) capZ.style.transform = `translateZ(${-L}px) ${bb}`;
  }
  rotXEl.addEventListener("input", () => setRotation(+rotXEl.value, state.view.rotY, false));
  rotYEl.addEventListener("input", () => setRotation(state.view.rotX, +rotYEl.value, false));

  // empty-space drag to rotate
  let bgDrag = null;
  stageEl.addEventListener("pointerdown", (e) => {
    if (state.view.mode === "flat") return;
    if (e.target.closest(".column") || e.target.closest(".card")) return;
    e.preventDefault(); // 텍스트 선택 방지
    bgDrag = { x: e.clientX, y: e.clientY, rx: state.view.rotX, ry: state.view.rotY };
    stageEl.classList.add("rotating");
    scene.classList.add("no-anim");
    stageEl.setPointerCapture(e.pointerId);
  });
  stageEl.addEventListener("pointermove", (e) => {
    if (!bgDrag) return;
    // 빈 공간 드래그 = 시점 회전
    const dx = e.clientX - bgDrag.x, dy = e.clientY - bgDrag.y;
    setRotation(bgDrag.rx - dy * 0.35, bgDrag.ry + dx * 0.35, true);
  });
  function endBgDrag() {
    if (!bgDrag) return;
    bgDrag = null; stageEl.classList.remove("rotating"); scene.classList.remove("no-anim");
  }
  stageEl.addEventListener("pointerup", endBgDrag);
  stageEl.addEventListener("pointercancel", endBgDrag);
  // 빈 공간 더블클릭 → 위치·시점 복귀
  stageEl.addEventListener("dblclick", (e) => {
    if (e.target.closest(".card") || e.target.closest(".column")) return;
    resetView();
  });

  // mode toggle (입체 / 평면)
  function setMode(mode) {
    state.view.mode = mode;
    app.classList.toggle("flat", mode === "flat");
    [...document.querySelectorAll(".mode-btn")].forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    if (mode !== "flat") { scene.classList.remove("no-anim"); applyView(); }
    applyFocus();
    save();
  }
  $("#modeToggle").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-btn"); if (b) setMode(b.dataset.mode);
  });

  // ===================================================================
  //  Z축 — 대분류(프로젝트) 깊이 전환
  // ===================================================================
  const zBadge = $("#zNav"), zName = $("#zNavName"), zIdx = $("#zNavIdx"), reelEl = $("#groupReel");
  // 대분류별 색 (목차 구분용)
  const GROUP_COLORS = ["#f43f5e", "#6366f1", "#10b981", "#f59e0b", "#14b8a6", "#8b5cf6", "#ef4444", "#0ea5e9"];
  const groupColor = (i) => GROUP_COLORS[((i % GROUP_COLORS.length) + GROUP_COLORS.length) % GROUP_COLORS.length];
  // 순환 최단 거리
  function relIndex(gi, focus, n) {
    let rel = gi - focus;
    if (rel > n / 2) rel -= n;
    if (rel < -n / 2) rel += n;
    return rel;
  }
  // 대분류 보드 전체가 대관람차처럼 원을 그리며 회전·교체
  const WHEEL_R = 620, WHEEL_STEP = 30; // 반경(px), 보드 간 각도(deg)
  function applyFocus() {
    const n = state.groups.length;
    const focus = clamp(state.view.focus | 0, 0, n - 1);
    const boards = [...document.querySelectorAll(".group-board")];
    boards.forEach((gb, gi) => {
      const rel = relIndex(gi, focus, n);
      const angle = rel * WHEEL_STEP;
      const rad = angle * Math.PI / 180;
      // 원 둘레 위치: 활성은 정면(앞·중앙), 다음은 위에서, 이전은 아래에서 호를 그림 (곤돌라는 수평 유지)
      gb.style.setProperty("--gz", (WHEEL_R * Math.cos(rad) - WHEEL_R).toFixed(1) + "px");
      gb.style.setProperty("--gy", (-WHEEL_R * Math.sin(rad)).toFixed(1) + "px");
      gb.style.setProperty("--gs", rel === 0 ? 1 : 0.9);
      gb.classList.toggle("active", rel === 0);
    });
    const g = state.groups[focus];
    if (zName) zName.textContent = g ? g.name : "";
    if (zIdx) zIdx.textContent = (focus + 1) + " / " + n;
    renderReel(focus, n);
    requestAnimationFrame(layoutFloor);
  }
  // 왼쪽 세로 목차 — 현재 분류 표시(활성 중앙 강조). 회전 연출은 보드가 담당
  function renderReel(focus, n) {
    if (!reelEl) return;
    reelEl.innerHTML = "";
    const maxVisible = Math.min(3, Math.floor(n / 2));
    state.groups.forEach((g, gi) => {
      const rel = relIndex(gi, focus, n), dist = Math.abs(rel);
      if (dist > maxVisible) return;
      const it = document.createElement("div");
      it.className = "reel-item" + (rel === 0 ? " active" : "");
      it.style.setProperty("--gc", groupColor(gi));
      it.style.transform = `translateY(${(rel * 52).toFixed(0)}px) scale(${rel === 0 ? 1 : 0.9})`;
      it.style.opacity = dist === 0 ? 1 : dist === 1 ? 0.55 : 0.25;
      it.style.zIndex = String(10 - dist);
      it.innerHTML = `<span class="reel-bar"></span><span class="reel-name">${esc(g.name)}</span>`;
      it.addEventListener("click", () => (rel === 0 ? renameGroup() : setFocus(gi)));
      it.addEventListener("wheel", groupWheel, { passive: false });
      reelEl.appendChild(it);
    });
  }
  // 바닥 판을 활성 보드 크기(단계 수·컬럼 높이)에 맞춰 배치
  function layoutFloor() {
    const floor = $("#adFloor");
    if (!floor) return;
    const cols = activeGroup().stages.length;
    const boardW = cols * COL_W + Math.max(0, cols - 1) * COL_GAP;
    let maxH = 0;
    document.querySelectorAll(".group-board.active .column-inner").forEach((el) => {
      if (el.offsetHeight > maxH) maxH = el.offsetHeight;
    });
    floor.style.width = (boardW + 240) + "px";
    floor.style.left = (296 + boardW / 2) + "px"; // 좌측정렬 보드의 컬럼 중앙
    floor.style.top = (44 + maxH + 28) + "px";    // 컬럼 아래로 (board top + 최대 컬럼 높이)
  }
  // 무한 순환 전환 (끝에서 처음으로 wrap)
  function setFocus(next) {
    const n = state.groups.length;
    if (n <= 1) return;
    const f = ((next % n) + n) % n;
    if (f === (state.view.focus | 0)) return;
    state.view.focus = f;
    applyFocus(); save();
  }
  // 입체 모드에서 보드 휠 = 마우스 포인터 중심 줌 인/아웃
  const ZOOM_MIN = 0.45, ZOOM_MAX = 2.4;
  stageEl.addEventListener("wheel", (e) => {
    if (state.view.mode === "flat") return;
    e.preventDefault();
    const rect = stageEl.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;   // scene 중심(=transform-origin) 기준
    const my = e.clientY - rect.top - rect.height / 2;
    const old = state.view.zoom || 1;
    const nz = clamp(old * (e.deltaY > 0 ? 0.9 : 1.1), ZOOM_MIN, ZOOM_MAX);
    const r = nz / old;
    // 커서 아래 지점이 고정되도록 pan 보정 → 줌으로 좌우상하 이동
    state.view.panX = mx - (mx - (state.view.panX || 0)) * r;
    state.view.panY = my - (my - (state.view.panY || 0)) * r;
    state.view.zoom = nz;
    applyView();
    save();
  }, { passive: false });
  // 대분류 제목 영역(헤더 네비 + 작업영역 플로팅)에서 휠 = 대분류 전환 (무한 순환)
  function groupWheel(e) {
    e.preventDefault(); e.stopPropagation();
    setFocus((state.view.focus | 0) + (e.deltaY > 0 ? 1 : -1));
  }
  zBadge.addEventListener("wheel", groupWheel, { passive: false });
  $("#zNavPrev").addEventListener("click", () => setFocus((state.view.focus | 0) - 1));
  $("#zNavNext").addEventListener("click", () => setFocus((state.view.focus | 0) + 1));
  // 화살표 키로도 대분류 전환
  document.addEventListener("keydown", (e) => {
    if (!overlay.hidden) return;
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setFocus((state.view.focus | 0) - 1); }
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setFocus((state.view.focus | 0) + 1); }
  });
  // 대분류 추가 / 이름변경 / 삭제
  $("#zNavName").addEventListener("dblclick", renameGroup);
  $("#zNavAdd").addEventListener("click", addGroup);
  $("#zNavDel").addEventListener("click", deleteGroup);
  function addGroup() {
    const name = (prompt("새 대분류 이름", "새 대분류") || "").trim();
    if (!name) return;
    const g = { id: uid("g"), name, stages: ["할 일", "진행 중", "검토", "완료"].map((sn) => ({ id: uid("s"), name: sn, cardIds: [] })), cards: {} };
    state.groups.push(g);
    state.view.focus = state.groups.length - 1;
    save(); render();
  }
  function renameGroup() {
    const g = activeGroup();
    const name = (prompt("대분류 이름 변경", g.name) || "").trim();
    if (!name) return;
    g.name = name; save(); applyFocus();
  }
  function deleteGroup() {
    if (state.groups.length <= 1) { toast("대분류는 최소 1개가 필요합니다."); return; }
    const g = activeGroup();
    if (!confirm(`대분류 '${g.name}'와 그 안의 모든 카드를 삭제할까요?`)) return;
    state.groups.splice(state.view.focus | 0, 1);
    state.view.focus = clamp(state.view.focus | 0, 0, state.groups.length - 1);
    save(); render();
  }

  // reset view
  $("#resetView").addEventListener("click", resetView);

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
  function findCard(id) {
    for (const g of state.groups) if (g.cards[id]) return g.cards[id];
    return null;
  }
  function applySearch() {
    const q = (state.view.search || "").trim().toLowerCase();
    document.querySelectorAll(".card").forEach((el) => {
      const card = findCard(el.dataset.cardId);
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
    const g = activeGroup();
    const rows = [CSV_COLS.slice()];
    g.stages.forEach((st) => {
      st.cardIds.forEach((cid) => {
        const c = g.cards[cid]; if (!c) return;
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
      const g = activeGroup();
      const stageName = get(row, "stage") || (g.stages[0] && g.stages[0].name) || "할 일";
      let st = g.stages.find((s) => s.name === stageName);
      if (!st) { st = { id: uid("s"), name: stageName, cardIds: [] }; g.stages.push(st); }
      g.cards[card.id] = card; st.cardIds.push(card.id); count++;
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
    const g = activeGroup();
    const code = b64encodeUtf8(JSON.stringify({ v: 1, board: { stages: g.stages, cards: g.cards } }));
    return { code, url: location.origin + location.pathname + "#share=" + code };
  }
  function mergeBoard(incoming) {
    const g = activeGroup();
    incoming.stages.forEach((inStage) => {
      let target = g.stages.find((s) => s.name === inStage.name);
      if (!target) { target = { id: uid("s"), name: inStage.name, cardIds: [] }; g.stages.push(target); }
      (inStage.cardIds || []).forEach((oldId) => {
        const c = incoming.cards[oldId]; if (!c) return;
        const nid = uid("c");
        g.cards[nid] = Object.assign({}, c, { id: nid });
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
    if (state.view.mode !== "flat") state.view.mode = "3d"; // 구버전 'category' 모드 정리
    setMode(state.view.mode);
    updateGizmo();
    checkSharedHash();
    render();
  }
  boot();
})();
