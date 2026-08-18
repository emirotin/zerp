(() => {
  const frames = Array.from(document.querySelectorAll("[data-zerp-slide]"));
  const slides = frames.map((frame) => frame.querySelector(".slide"));
  let current = 0;
  const total = frames.length;
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");
  const navPrev = document.getElementById("nav-prev");
  const navNext = document.getElementById("nav-next");

  function clamp(index) {
    return Math.max(0, Math.min(index, total - 1));
  }

  // Source badge ("s" key): shows the active slide's deck position and the
  // source file it came from, read off the data-zerp-* attributes.
  const sourceBadge = document.createElement("div");
  sourceBadge.className = "source-badge";
  sourceBadge.hidden = true;
  document.body.appendChild(sourceBadge);

  function updateSourceBadge() {
    if (sourceBadge.hidden) {
      return;
    }
    const active = slides[current];
    if (!active) {
      return;
    }
    const src = active.getAttribute("data-zerp-src") || "unknown source";
    const inFile = active.getAttribute("data-zerp-src-slide") || "";
    const ofFile = Number.parseInt(inFile.split("/")[1] ?? "", 10);
    const suffix = ofFile > 1 ? " · " + inFile + " in file" : "";
    sourceBadge.textContent = "#" + String(current + 1) + " · " + src + suffix;
  }

  function toggleSourceBadge() {
    sourceBadge.hidden = !sourceBadge.hidden;
    updateSourceBadge();
  }

  function show(index) {
    current = clamp(index);
    for (const [frameIndex, frame] of frames.entries()) {
      frame.removeAttribute("data-zerp-slide-active");
      const slide = slides[frameIndex];
      if (slide) {
        slide.classList.remove("active");
      }
    }
    const activeFrame = frames[current];
    const active = slides[current];
    if (!activeFrame || !active) {
      return;
    }
    activeFrame.setAttribute("data-zerp-slide-active", "");
    active.classList.add("active");
    updateSourceBadge();
    if (counter) {
      counter.textContent = String(current + 1) + " / " + String(total);
    }
    if (progress) {
      progress.style.width = String(((current + 1) / Math.max(total, 1)) * 100) + "%";
    }
    if (navPrev) {
      navPrev.disabled = current === 0;
    }
    if (navNext) {
      navNext.disabled = current === total - 1;
    }
    history.replaceState(null, "", "#" + String(current + 1));
  }

  function next() {
    show(current + 1);
  }

  function prev() {
    show(current - 1);
  }

  // Declarative reveals: [data-step="N"] appears once the slide's step
  // counter reaches N; [data-until-step="N"] disappears at N. Custom slide
  // scripts keep working — slide-next/slide-prev events fire regardless.
  const stepCounters = new WeakMap();

  function stepTargets(slide) {
    return Array.from(slide.querySelectorAll("[data-step], [data-until-step]"));
  }

  function stepAttr(el, name) {
    const value = Number.parseInt(el.getAttribute(name) ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function maxStep(slide) {
    let max = 0;
    for (const el of stepTargets(slide)) {
      max = Math.max(max, stepAttr(el, "data-step") ?? 0, stepAttr(el, "data-until-step") ?? 0);
    }
    return max;
  }

  function applySteps(slide) {
    const count = stepCounters.get(slide) ?? 0;
    for (const el of stepTargets(slide)) {
      const at = stepAttr(el, "data-step");
      if (at !== null) {
        el.classList.toggle("revealed", count >= at);
      }
      const until = stepAttr(el, "data-until-step");
      if (until !== null) {
        el.classList.toggle("step-done", count >= until);
      }
    }
  }

  // The dev server's live-reload client sets this flag before reloading;
  // the step counter of the active slide is then replayed so a save while
  // rehearsing a stepped slide doesn't collapse it back to step 0.
  const LIVE_RELOAD_FLAG = "zerp-live-reload";

  function persistStep() {
    try {
      const slide = slides[current];
      sessionStorage.setItem("zerp-step:" + String(current), String(stepCounters.get(slide) ?? 0));
    } catch {
      /* storage unavailable */
    }
  }

  function stepForward() {
    const slide = slides[current];
    if (!slide) {
      return;
    }
    const count = stepCounters.get(slide) ?? 0;
    if (count < maxStep(slide)) {
      stepCounters.set(slide, count + 1);
      applySteps(slide);
      persistStep();
    }
    slide.dispatchEvent(new Event("slide-next"));
  }

  function stepBackward() {
    const slide = slides[current];
    if (!slide) {
      return;
    }
    const count = stepCounters.get(slide) ?? 0;
    if (count > 0) {
      stepCounters.set(slide, count - 1);
      applySteps(slide);
      persistStep();
    }
    slide.dispatchEvent(new Event("slide-prev"));
  }

  window.next = next;
  window.prev = prev;

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
      event.preventDefault();
      next();
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      prev();
    }
    if (event.key === "Home") {
      event.preventDefault();
      show(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      show(total - 1);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      stepForward();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepBackward();
    }
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      toggleTheme();
    }
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      toggleSourceBadge();
    }
  });

  let touchStartX = 0;
  document.addEventListener("touchstart", (event) => {
    touchStartX = event.touches[0]?.clientX ?? 0;
  });
  document.addEventListener("touchend", (event) => {
    const delta = touchStartX - (event.changedTouches[0]?.clientX ?? 0);
    if (Math.abs(delta) > 60) {
      if (delta > 0) {
        next();
      } else {
        prev();
      }
    }
  });

  // Theme control: three states in the model, two on screen at any moment.
  // The deck default (system, or whatever `--theme` baked in) is one state;
  // an explicit override stored in localStorage is the other. One press pins
  // the opposite of what you are looking at, the next press unpins it. Nothing
  // outside a press ever writes or clears the override — an OS scheme change
  // must not silently demote a deliberate choice back to "default".
  const THEME_KEY = "zerp-theme";
  const themeToggle = document.getElementById("theme-toggle");
  const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function readOverride() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "light" || stored === "dark" ? stored : null;
    } catch {
      /* storage unavailable */
      return null;
    }
  }

  function writeOverride(value) {
    try {
      if (value) {
        localStorage.setItem(THEME_KEY, value);
      } else {
        localStorage.removeItem(THEME_KEY);
      }
    } catch {
      /* storage unavailable */
    }
  }

  function defaultTheme() {
    const value = document.documentElement.dataset.zerpDefaultTheme;
    return value === "light" || value === "dark" ? value : "system";
  }

  // Which of the two palettes a `data-zerp-theme` value actually paints.
  function resolveScheme(theme) {
    if (theme !== "system") {
      return theme;
    }
    return darkQuery && darkQuery.matches ? "dark" : "light";
  }

  function syncThemeToggle() {
    if (!themeToggle) {
      return;
    }
    const override = readOverride();
    const shown = override ?? resolveScheme(defaultTheme());
    // The icon always names where the next press lands, never where you are.
    const target = override ? resolveScheme(defaultTheme()) : shown === "dark" ? "light" : "dark";
    const label = override
      ? "Use the default theme (" + target + ")"
      : "Switch to the " + target + " theme";
    themeToggle.dataset.themeTarget = target;
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }

  function applyTheme(value) {
    document.documentElement.dataset.zerpTheme = value;
    syncThemeToggle();
  }

  function toggleTheme() {
    const override = readOverride();
    if (override) {
      writeOverride(null);
      applyTheme(defaultTheme());
      return;
    }
    const next = resolveScheme(defaultTheme()) === "dark" ? "light" : "dark";
    writeOverride(next);
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(readOverride() ?? defaultTheme());
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  // An OS scheme flip repaints through CSS on its own; all that is left to do
  // is restate where the button now leads.
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener("change", syncThemeToggle);
  }

  // ---- scale-to-fit: shrink/grow the fixed-px stage to the window ----
  var stage = document.querySelector("[data-zerp-stage]");

  function fitStage() {
    if (!stage || window.__ZERP_NO_SCALE__) return;
    var w = stage.offsetWidth; // layout px = design px; transforms don't affect offset*
    var h = stage.offsetHeight;
    if (!w || !h) return;
    var scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    if (Math.abs(scale - 1) < 0.0005) {
      // Exports and checks render at the design size; leaving the style
      // untouched there keeps their measurements literally transform-free.
      stage.style.transform = "";
      return;
    }
    var tx = (window.innerWidth - w * scale) / 2;
    var ty = (window.innerHeight - h * scale) / 2;
    stage.style.transform = "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")";
  }

  window.addEventListener("resize", fitStage);
  fitStage();

  initTheme();

  show((Number.parseInt(location.hash.slice(1), 10) || 1) - 1);

  // After a live reload, replay EVERY stepped slide — not just the active
  // one — so a save mid-rehearsal doesn't collapse slides already walked
  // through. slide-next is dispatched per step so scripted slides re-run
  // their sequences too.
  try {
    if (sessionStorage.getItem(LIVE_RELOAD_FLAG)) {
      sessionStorage.removeItem(LIVE_RELOAD_FLAG);
      for (let i = 0; i < slides.length; i++) {
        const saved = Number.parseInt(sessionStorage.getItem("zerp-step:" + String(i)) ?? "", 10);
        if (!Number.isInteger(saved) || saved <= 0) {
          continue;
        }
        const slide = slides[i];
        const limit = Math.min(saved, maxStep(slide));
        for (let k = 0; k < limit; k++) {
          slide.dispatchEvent(new Event("slide-next"));
        }
        stepCounters.set(slide, limit);
        applySteps(slide);
      }
    }
  } catch {
    /* storage unavailable */
  }
})();
