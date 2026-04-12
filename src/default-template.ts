export const defaultStyles = `
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

:root {
    --zerp-bg: #0d1117;
    --zerp-panel: #161b22;
    --zerp-border: #30363d;
    --zerp-text: #e6edf3;
    --zerp-muted: #8b949e;
    --zerp-faint: #484f58;
    --zerp-accent: #58a6ff;
    --zerp-green: #3fb950;
    --zerp-orange: #f0883e;
    --zerp-purple: #bc8cff;
    --zerp-red: #f85149;
}

html,
body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--zerp-bg);
    color: var(--zerp-text);
    font-family: "Montserrat", sans-serif;
}

img,
video {
    max-width: 100%;
}

.slide {
    display: none;
    width: 100vw;
    height: 100vh;
    padding: 50px 70px;
    flex-direction: column;
    justify-content: center;
    position: relative;
}

.slide.active {
    display: flex;
}

.slide h1 {
    font-size: 3.2em;
    font-weight: 900;
    line-height: 1.15;
    margin-bottom: 20px;
}

.slide h2 {
    font-size: 2.2em;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 14px;
}

.slide h3 {
    font-size: 1.4em;
    font-weight: 700;
    margin-bottom: 10px;
    color: var(--zerp-muted);
}

.slide p,
.slide li {
    font-size: 1.25em;
    line-height: 1.5;
    color: #c9d1d9;
}

.slide ul {
    list-style: none;
    padding: 0;
}

.slide li {
    padding: 5px 0;
}

.slide li::before {
    content: "→ ";
    color: var(--zerp-accent);
}

.accent {
    color: var(--zerp-accent);
}

.accent-green {
    color: var(--zerp-green);
}

.accent-orange {
    color: var(--zerp-orange);
}

.accent-purple {
    color: var(--zerp-purple);
}

.accent-red {
    color: var(--zerp-red);
}

.big-number {
    font-size: 3em;
    font-weight: 900;
    color: var(--zerp-accent);
    font-family: "Roboto Mono", monospace;
}

.img-row {
    display: flex;
    gap: 24px;
    align-items: center;
    justify-content: center;
    margin: 24px 0;
    flex-wrap: wrap;
}

.img-row img {
    max-height: 300px;
    border-radius: 10px;
    object-fit: contain;
    background: var(--zerp-panel);
    padding: 6px;
}

.two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    align-items: center;
}

.caption {
    font-size: 0.8em;
    color: var(--zerp-muted);
    text-align: center;
    margin-top: 4px;
}

.block-label {
    position: absolute;
    top: 24px;
    left: 70px;
    font-size: 0.8em;
    font-weight: 700;
    color: var(--zerp-faint);
    text-transform: uppercase;
    letter-spacing: 3px;
}

.interactive-badge {
    display: inline-block;
    background: #238636;
    color: white;
    padding: 5px 16px;
    border-radius: 20px;
    font-size: 0.8em;
    font-weight: 700;
    margin-bottom: 14px;
}

.timeline {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    justify-content: center;
    margin: 16px 0;
}

.timeline .item {
    background: var(--zerp-panel);
    border: 1px solid var(--zerp-border);
    border-radius: 10px;
    padding: 14px 18px;
    text-align: center;
    min-width: 130px;
}

.timeline .item .year {
    font-family: "Roboto Mono", monospace;
    font-size: 1.3em;
    font-weight: 700;
    color: var(--zerp-accent);
}

.timeline .item .label {
    font-size: 0.85em;
    color: #c9d1d9;
    margin-top: 4px;
}

.nav {
    position: fixed;
    bottom: 24px;
    right: 36px;
    display: flex;
    gap: 10px;
    z-index: 100;
}

.nav button {
    background: none;
    border: none;
    color: var(--zerp-faint);
    padding: 4px 8px;
    cursor: pointer;
    font-size: 0.85em;
    font-family: "Roboto Mono", monospace;
}

.nav button:hover {
    color: var(--zerp-muted);
}

.counter {
    position: fixed;
    bottom: 28px;
    left: 36px;
    font-size: 0.85em;
    color: var(--zerp-faint);
    font-family: "Roboto Mono", monospace;
    z-index: 100;
}

.progress {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    background: var(--zerp-accent);
    z-index: 100;
    transition: width 0.3s;
}

.quote {
    border-left: 4px solid var(--zerp-accent);
    padding: 14px 20px;
    margin: 16px 0;
    background: var(--zerp-panel);
    border-radius: 0 10px 10px 0;
    font-style: italic;
    font-size: 1.1em;
}

.key-thought {
    background: var(--zerp-panel);
    border: 2px solid var(--zerp-accent);
    border-radius: 14px;
    padding: 28px 36px;
    margin: 16px 0;
    text-align: center;
}

.key-thought p {
    font-size: 1.4em;
    font-weight: 700;
    color: var(--zerp-text);
}

.grid-demo {
    display: grid;
    grid-template-columns: repeat(7, 48px);
    gap: 3px;
    justify-content: center;
    margin: 16px 0;
}

.grid-demo .cell {
    width: 48px;
    height: 48px;
    border: 2px solid var(--zerp-border);
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75em;
    color: var(--zerp-faint);
}

.grid-demo .cell.filled {
    background: var(--zerp-red);
    border-color: var(--zerp-red);
    color: white;
}
`;

export const defaultRuntime = `
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
            delta > 0 ? next() : prev();
        }
    });

    show((Number.parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
`;
