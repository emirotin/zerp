(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  let current = 0;
  const total = slides.length;
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");

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
    history.replaceState(null, "", "#" + String(current + 1));
  }

  function next() {
    show(current + 1);
  }

  function prev() {
    show(current - 1);
  }

  function stepForward() {
    slides[current]?.dispatchEvent(new Event("slide-next"));
  }

  function stepBackward() {
    slides[current]?.dispatchEvent(new Event("slide-prev"));
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

  show((Number.parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
