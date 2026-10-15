/* Remembers every settings control (by id) per page and restores it on load. */
(function () {
  const page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  const KEY = `field-notes-settings-v2:${page}`;
  // Entity pickers and one-off fields whose options/values belong to the current data, not to a preference.
  const SKIP = new Set([
    "import-file", "add-park-select", "batter", "game-date", "sim-date", "seed", "help-toggle", "foul-stop", "hr-stop", "stadium-select",
    "shift-sel", "ph-sel", "pc-sel", "ds-slot", "ds-bench", "log-inning", "sch-team", "st-team", "st-q", "p-q",
    "tm-sel", "tm-name", "tm-abbr", "tm-color", "tm-park", "ns-label", "lg-name", "lg-my", "d-my", "d-name", "d-seed", "p-reseed"
  ]);
  const controls = () => [...document.querySelectorAll("select[id], input[id], textarea[id]")].filter((el) => !SKIP.has(el.id) && el.type !== "file" && el.type !== "button");
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (error) { return {}; } };
  let restoring = true;

  const valueOf = (el) => (el.type === "checkbox" || el.type === "radio" ? el.checked : el.value);
  function save(el) {
    if (restoring || SKIP.has(el.id) || !el.id || el.type === "file") return;
    const data = read();
    data[el.id] = valueOf(el);
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (error) { /* storage full or blocked */ }
  }
  document.addEventListener("change", (event) => event.target && event.target.id && save(event.target), true);
  document.addEventListener("input", (event) => event.target && event.target.id && save(event.target), true);

  const done = new WeakSet();
  function restoreOne(el, data) {
    if (done.has(el) || !el.id || SKIP.has(el.id) || el.type === "file" || el.type === "button" || !(el.id in data)) return;
    done.add(el);
    const value = data[el.id];
    if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked === value) return;
      el.checked = !!value;
    } else {
      if (el.value === String(value)) return;
      if (el.tagName === "SELECT" && ![...el.options].some((option) => option.value === String(value))) return;
      el.value = value;
    }
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) { /* a handler needing a game that isn't started yet */ }
  }

  function restore() {
    const data = read();
    for (const el of controls()) restoreOne(el, data);
    restoring = false;
    // Panels built later (league setup, dialogs) get their last values too.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        const latest = read();
        restoring = true;
        for (const el of controls()) restoreOne(el, latest);
        restoring = false;
      }, 0);
    }).observe(document.body, { childList: true, subtree: true });
  }
  const start = () => setTimeout(restore, 0);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
