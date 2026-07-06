(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  let current = 0;
  const total = slides.length;
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");
  const navPrev = document.getElementById("nav-prev");
  const navNext = document.getElementById("nav-next");

  function clamp(index) {
    return Math.max(0, Math.min(index, total - 1));
  }

  function show(index) {
    current = clamp(index);
    for (const slide of slides) {
      slide.classList.remove("active");
    }
    const active = slides[current];
    if (!active) {
      return;
    }
    active.classList.add("active");
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

  function stepForward() {
    const slide = slides[current];
    if (!slide) {
      return;
    }
    const count = stepCounters.get(slide) ?? 0;
    if (count < maxStep(slide)) {
      stepCounters.set(slide, count + 1);
      applySteps(slide);
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
      cycleTheme();
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

  const THEME_KEY = "zerp-theme";
  const THEME_ORDER = ["light", "system", "dark"];
  const themeSwitch = document.getElementById("theme-switch");
  const themeOptions = themeSwitch ? themeSwitch.querySelector(".theme-options") : null;

  function syncThemeSwitch(value) {
    if (!themeSwitch) {
      return;
    }
    for (const button of themeSwitch.querySelectorAll("[data-theme-choice]")) {
      button.classList.toggle("selected", button.dataset.themeChoice === value);
    }
  }

  function applyTheme(value) {
    document.documentElement.dataset.zerpTheme = value;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      /* storage unavailable */
    }
    syncThemeSwitch(value);
  }

  function cycleTheme() {
    const current = document.documentElement.dataset.zerpTheme || "system";
    const index = THEME_ORDER.indexOf(current);
    applyTheme(THEME_ORDER[(index + 1) % THEME_ORDER.length]);
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* storage unavailable */
    }
    const value = THEME_ORDER.includes(stored)
      ? stored
      : document.documentElement.dataset.zerpDefaultTheme || "system";
    document.documentElement.dataset.zerpTheme = value;
    syncThemeSwitch(value);
  }

  if (themeSwitch && themeOptions) {
    const trigger = themeSwitch.querySelector(".theme-trigger");
    if (trigger) {
      trigger.addEventListener("click", () => {
        themeOptions.hidden = !themeOptions.hidden;
      });
    }
    themeOptions.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-theme-choice]");
      if (choice) {
        applyTheme(choice.dataset.themeChoice);
        themeOptions.hidden = true;
      }
    });
  }

  initTheme();

  show((Number.parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
