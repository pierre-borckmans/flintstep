// The hero: the drawn pedal presses its own switches and the MIDI it would send ticks into
// the log. The page's HTML is the resting frame (II held, A toggled on), so without JS, or
// with reduced motion, nothing moves and the picture still makes sense.
(() => {
  const stage = document.querySelector(".stage");
  if (!stage) return;

  const $$ = (sel) => [...stage.querySelectorAll(sel)];
  const leds = $$(".led");
  const caps = $$(".fs");
  const labels = $$(".cap-label");
  const amp = stage.querySelector(".lamp-amp");
  const rows = stage.querySelector(".log-rows");
  const pulse = stage.querySelector(".pulse");
  const button = stage.querySelector(".pause");
  const NAMES = ["I", "II", "A", "III", "IV", "B"];

  // What each switch sends in the demo: press and release halves, null for nothing.
  // A is a toggle: its press alternates between on and off and its release sends nothing.
  const SENDS = [
    () => ["CC 80 = 127 · ch 1", "CC 80 = 0 · ch 1"],
    () => ["CC 81 = 127 · ch 1", "CC 81 = 0 · ch 1"],
    (on) => [on ? "CC 82 = 127 · ch 1" : "CC 82 = 0 · ch 1", null],
    () => ["Note C3 on · vel 127 · ch 1", "Note C3 off · ch 1"],
    () => ["CC 84 = 127 · ch 1", "CC 84 = 0 · ch 1"],
    () => ["Program 4 · ch 1", null],
  ];
  // One loop, ending on II like the resting frame. A starts on and toggles twice.
  const ORDER = [0, 2, 3, 5, 4, 2, 1];
  const STEP = 1900;
  const HOLD = 460;
  const REST = 1400;

  let toggleA = true;
  let i = 0;
  let timers = [];
  let userPaused = false;
  let visible = true;
  let running = false;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function send(msg, sw) {
    if (!msg) return;
    const li = document.createElement("li");
    li.className = "fresh enter";
    li.innerHTML = `<span class="msg"></span><span class="sw"></span>`;
    li.firstChild.textContent = msg;
    li.lastChild.textContent = NAMES[sw];
    for (const old of rows.querySelectorAll(".fresh")) old.classList.remove("fresh");
    rows.prepend(li);
    while (rows.children.length > 7) rows.lastElementChild.remove();
    // AMP shows MIDI out: a short flash per message
    amp.classList.add("on");
    later(() => amp.classList.remove("on"), 90);
    if (pulse) {
      pulse.classList.remove("go");
      void pulse.offsetWidth;
      pulse.classList.add("go");
    }
  }

  function press(sw, down) {
    caps[sw].classList.toggle("held", down);
    labels[sw].classList.toggle("on", down);
    if (sw === 2) {
      if (down) {
        toggleA = !toggleA;
        leds[2].classList.toggle("on", toggleA);
        send(SENDS[2](toggleA)[0], 2);
      }
      return;
    }
    leds[sw].classList.toggle("on", down);
    send(SENDS[sw]()[down ? 0 : 1], sw);
  }

  function step() {
    const sw = ORDER[i];
    press(sw, true);
    later(() => press(sw, false), HOLD);
    i = (i + 1) % ORDER.length;
    later(step, i === 0 ? STEP + REST : STEP);
  }

  function start() {
    if (running) return;
    running = true;
    // let go of the resting frame's held II, then begin
    if (caps[1].classList.contains("held")) later(() => press(1, false), 600);
    later(step, 1500);
  }

  function stop() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    if (!running) return; // the resting frame stays as drawn
    running = false;
    // leave nothing half-pressed
    caps.forEach((c, n) => {
      if (c.classList.contains("held")) press(n, false);
    });
    amp.classList.remove("on");
  }

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function update() {
    button.hidden = reduce.matches;
    if (!reduce.matches && !userPaused && visible && !document.hidden) start();
    else stop();
  }

  button.addEventListener("click", () => {
    userPaused = !userPaused;
    button.setAttribute("aria-pressed", String(userPaused));
    button.lastElementChild.textContent = userPaused ? "Play" : "Pause";
    update();
  });
  reduce.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    update();
  }).observe(stage);
})();
