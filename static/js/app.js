(function () {
  "use strict";

  const STORAGE_KEY = "gpt-cleaner-history";
  const THEME_KEY = "gpt-cleaner-theme";
  const MODE_KEY = "gpt-cleaner-mode";
  const LINE_NUM_KEY = "gpt-cleaner-line-numbers";
  const FIX_CODE_KEY = "gpt-cleaner-fix-code";
  const MAX_HISTORY = 30;

  const SAMPLE_MESSY =
    "ok so heres what the script does basically u need to \n" +
    "def fetch_user(id): # todo fix this later\n" +
    "    r = requests.get('https://api.example.com/users/'+str(id))\n" +
    "    if r.status_code==200: return r.json()\n" +
    "    else: return None\n" +
    "and also json looks like {\"retry\": true, \"max\": 3} \n" +
    "steps: 1) auth 2) fetch 3) parse — sorry its messy lol";

  const MODE_HINTS = {
    readme: "Project README layout — install, usage, config when relevant",
    notes: "Notes-style bullets — quick to scan",
    api_docs: "API reference — endpoints, params, examples",
  };

  const input = document.getElementById("input-text");
  const btnClean = document.getElementById("btn-clean");
  const btnSample = document.getElementById("btn-sample");
  const btnCopy = document.getElementById("btn-copy");
  const btnCopyReadme = document.getElementById("btn-copy-readme");
  const btnCopyHtml = document.getElementById("btn-copy-html");
  const btnDownload = document.getElementById("btn-download");
  const btnDownloadPdf = document.getElementById("btn-download-pdf");
  const btnTheme = document.getElementById("btn-theme");
  const themeIcon = document.getElementById("theme-icon");
  const status = document.getElementById("status");
  const errorBanner = document.getElementById("error-banner");
  const outputRaw = document.getElementById("output-raw");
  const outputPreview = document.getElementById("output-preview");
  const outputCompare = document.getElementById("output-compare");
  const compareBefore = document.getElementById("compare-before");
  const compareAfter = document.getElementById("compare-after");
  const outputWrap = document.getElementById("output-wrap");
  const togglePreview = document.getElementById("toggle-preview");
  const toggleRaw = document.getElementById("toggle-raw");
  const toggleCompare = document.getElementById("toggle-compare");
  const historyList = document.getElementById("history-list");
  const btnClearHistory = document.getElementById("btn-clear-history");
  const smartInsights = document.getElementById("smart-insights");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");
  const chkLineNumbers = document.getElementById("chk-line-numbers");
  const chkScrollSync = document.getElementById("chk-scroll-sync");
  const modeReadme = document.getElementById("mode-readme");
  const modeNotes = document.getElementById("mode-notes");
  const modeApi = document.getElementById("mode-api");
  const modeHint = document.getElementById("mode-hint");
  const chkFixCode = document.getElementById("chk-fix-code");
  const panelOutput = document.getElementById("panel-output");
  const toastRoot = document.getElementById("toast-root");

  const hljsThemeDark = document.getElementById("hljs-theme-dark");
  const hljsThemeLight = document.getElementById("hljs-theme-light");

  let currentMarkdown = "";
  let beforeSnapshot = "";
  let scrollSyncing = false;
  let errorBannerTimer = null;

  const DiffLib = typeof window.Diff !== "undefined" ? window.Diff : null;

  function getMode() {
    if (modeReadme && modeReadme.classList.contains("active")) return "readme";
    if (modeNotes && modeNotes.classList.contains("active")) return "notes";
    if (modeApi && modeApi.classList.contains("active")) return "api_docs";
    return "readme";
  }

  function setMode(mode) {
    if (!modeReadme) return;
    const map = { readme: modeReadme, notes: modeNotes, api_docs: modeApi };
    const active = map[mode] || modeReadme;
    Object.keys(map).forEach(function (k) {
      map[k].classList.toggle("active", map[k] === active);
    });
    if (modeHint) modeHint.textContent = MODE_HINTS[mode] || MODE_HINTS.readme;
    localStorage.setItem(MODE_KEY, mode);
  }

  function wireModeButtons() {
    const modes = [
      ["readme", modeReadme],
      ["notes", modeNotes],
      ["api_docs", modeApi],
    ];
    modes.forEach(function (pair) {
      if (!pair[1]) return;
      pair[1].addEventListener("click", function () {
        setMode(pair[0]);
      });
    });
    let saved = localStorage.getItem(MODE_KEY);
    if (saved === "basic") saved = "notes";
    if (saved === "smart") saved = "readme";
    if (saved === "readme" || saved === "notes" || saved === "api_docs") {
      setMode(saved);
    } else {
      setMode("readme");
    }
  }

  if (chkLineNumbers) {
    const savedLn = localStorage.getItem(LINE_NUM_KEY);
    if (savedLn === "1") chkLineNumbers.checked = true;
    chkLineNumbers.addEventListener("change", function () {
      localStorage.setItem(LINE_NUM_KEY, chkLineNumbers.checked ? "1" : "0");
      renderPreview(currentMarkdown);
    });
  }

  if (chkFixCode) {
    if (localStorage.getItem(FIX_CODE_KEY) === "1") chkFixCode.checked = true;
    chkFixCode.addEventListener("change", function () {
      localStorage.setItem(FIX_CODE_KEY, chkFixCode.checked ? "1" : "0");
    });
  }

  function getFixCode() {
    return chkFixCode && chkFixCode.checked;
  }

  function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    themeIcon.textContent = dark ? "☀️" : "🌙";
    if (hljsThemeDark && hljsThemeLight) {
      hljsThemeDark.disabled = !dark;
      hljsThemeLight.disabled = dark;
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light") {
      applyTheme(false);
    } else {
      applyTheme(true);
    }
  }

  btnTheme.addEventListener("click", function () {
    applyTheme(!document.body.classList.contains("dark"));
  });

  function configureMarked() {
    if (typeof marked === "undefined") return;
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: function (code, lang) {
        if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          } catch (e) {
            /* fall through */
          }
        }
        if (typeof hljs !== "undefined") {
          try {
            return hljs.highlightAuto(code).value;
          } catch (e2) {
            return code;
          }
        }
        return code;
      },
    });
  }

  function decorateCodeBlocks(container) {
    container.querySelectorAll("pre").forEach(function (pre) {
      if (pre.closest(".code-block-outer")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-block-outer";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy-btn";
      btn.setAttribute("aria-label", "Copy code block");
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        const code = pre.querySelector("code");
        const t = code ? code.textContent : pre.textContent;
        navigator.clipboard.writeText(t).then(
          function () {
            showToast("Code copied");
          },
          function () {
            showToast("Copy failed", true);
          }
        );
      });
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(btn);
      wrap.appendChild(pre);
    });
  }

  function wrapCodeLineNumbers(container) {
    if (!chkLineNumbers || !chkLineNumbers.checked) return;
    container.querySelectorAll("pre").forEach(function (pre) {
      if (pre.closest(".code-line-frame")) return;
      const code = pre.querySelector("code");
      if (!code) return;
      const lineCount = code.textContent.split("\n").length;
      const nums = [];
      for (let i = 1; i <= lineCount; i++) nums.push(String(i));
      const frame = document.createElement("div");
      frame.className = "code-line-frame";
      const gutter = document.createElement("div");
      gutter.className = "line-gutter";
      gutter.textContent = nums.join("\n");
      const main = document.createElement("div");
      main.className = "code-line-main";
      pre.parentNode.insertBefore(frame, pre);
      main.appendChild(pre);
      frame.appendChild(gutter);
      frame.appendChild(main);
    });
  }

  function renderPreview(md) {
    configureMarked();
    if (typeof marked !== "undefined" && md) {
      var html = marked.parse(md);
      if (typeof DOMPurify !== "undefined") {
        html = DOMPurify.sanitize(html);
      }
      outputPreview.innerHTML = html;
      if (typeof hljs !== "undefined") {
        outputPreview.querySelectorAll("pre code").forEach(function (block) {
          hljs.highlightElement(block);
        });
      }
      decorateCodeBlocks(outputPreview);
      wrapCodeLineNumbers(outputPreview);
    } else {
      outputPreview.textContent = md || "";
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderCompareView() {
    if (!compareBefore || !compareAfter) return;
    const before = beforeSnapshot || "";
    const after = currentMarkdown || "";
    if (!DiffLib) {
      compareBefore.innerHTML =
        '<pre class="compare-pre compare-fallback">' + escapeHtml(before) + "</pre>";
      compareAfter.innerHTML =
        '<pre class="compare-pre compare-fallback">' + escapeHtml(after) + "</pre>";
      return;
    }
    var parts;
    var totalLen = before.length + after.length;
    if (totalLen < 120000 && typeof DiffLib.diffWordsWithSpace === "function") {
      parts = DiffLib.diffWordsWithSpace(before, after);
    } else if (typeof DiffLib.diffLines === "function") {
      parts = DiffLib.diffLines(before, after);
    } else {
      compareBefore.innerHTML =
        '<pre class="compare-pre compare-fallback">' + escapeHtml(before) + "</pre>";
      compareAfter.innerHTML =
        '<pre class="compare-pre compare-fallback">' + escapeHtml(after) + "</pre>";
      return;
    }
    var left = "";
    var right = "";
    parts.forEach(function (part) {
      var val = escapeHtml(part.value);
      if (part.added) {
        right += '<span class="diff-ins">' + val + "</span>";
      } else if (part.removed) {
        left += '<span class="diff-del">' + val + "</span>";
      } else {
        left += val;
        right += val;
      }
    });
    compareBefore.innerHTML = '<pre class="compare-pre compare-word">' + left + "</pre>";
    compareAfter.innerHTML = '<pre class="compare-pre compare-word">' + right + "</pre>";
  }

  function setView(mode) {
    const isRaw = mode === "raw";
    const isCompare = mode === "compare";
    outputRaw.classList.toggle("hidden", !isRaw);
    outputPreview.classList.toggle("hidden", isRaw || isCompare);
    if (outputCompare) outputCompare.classList.toggle("hidden", !isCompare);
    toggleRaw.classList.toggle("active", isRaw);
    togglePreview.classList.toggle("active", !isRaw && !isCompare);
    if (toggleCompare) toggleCompare.classList.toggle("active", isCompare);
    if (isCompare) renderCompareView();
  }

  togglePreview.addEventListener("click", function () {
    setView("preview");
  });
  toggleRaw.addEventListener("click", function () {
    setView("raw");
  });
  if (toggleCompare) {
    toggleCompare.addEventListener("click", function () {
      setView("compare");
    });
  }

  function setLoading(loading) {
    if (loadingOverlay) {
      loadingOverlay.classList.toggle("hidden", !loading);
      loadingOverlay.setAttribute("aria-busy", loading ? "true" : "false");
    }
    if (loadingText && loading) {
      loadingText.textContent = "Cleaning and structuring your content…";
    }
    btnClean.disabled = loading;
    if (!loading) return;
    status.classList.add("hidden");
    status.classList.remove("error");
  }

  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.remove("hidden");
    status.classList.toggle("error", !!isError);
  }

  function hideErrorBanner() {
    if (!errorBanner) return;
    errorBanner.classList.add("hidden");
    errorBanner.textContent = "";
    if (errorBannerTimer) {
      clearTimeout(errorBannerTimer);
      errorBannerTimer = null;
    }
  }

  function showErrorBanner(message) {
    if (!errorBanner) return;
    errorBanner.textContent = message;
    errorBanner.classList.remove("hidden");
    if (errorBannerTimer) clearTimeout(errorBannerTimer);
    errorBannerTimer = setTimeout(hideErrorBanner, 10000);
  }

  function friendlyApiMessage(raw) {
    const t = (raw || "").toLowerCase();
    if (
      t.includes("413") ||
      t.includes("too large") ||
      t.includes("payload") ||
      t.includes("request entity") ||
      t.includes("maximum request") ||
      t.includes("context length") ||
      t.includes("maximum context") ||
      (t.includes("token") && t.includes("limit") && (t.includes("input") || t.includes("prompt")))
    ) {
      return "⚠️ Input too large. Try reducing size or split into smaller chunks.";
    }
    if (t.includes("402") || t.includes("credit") || t.includes("afford") || t.includes("more credits")) {
      return "⚠️ Token or credit limit exceeded. Try a smaller input, set MAX_OUTPUT_TOKENS lower in .env, or add credits on OpenRouter.";
    }
    if (t.includes("429") || t.includes("rate limit")) {
      return "⚠️ Rate limited. Wait a moment and try again.";
    }
    if (t.includes("401") || t.includes("invalid api key") || t.includes("authentication")) {
      return "⚠️ API key rejected. Check OPENROUTER_API_KEY in .env.";
    }
    if (t.includes("network") || t.includes("failed to fetch")) {
      return "⚠️ Network error. Check your connection and that the server is running.";
    }
    return "⚠️ " + (raw || "Request failed.");
  }

  function showToast(message, isError) {
    if (!toastRoot) return;
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " toast-error" : "");
    el.textContent = message;
    toastRoot.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add("toast-visible");
    });
    const ms = isError ? 5200 : 2400;
    setTimeout(function () {
      el.classList.remove("toast-visible");
      setTimeout(function () {
        el.remove();
      }, 300);
    }, ms);
  }

  function renderInsights(insights) {
    if (!smartInsights) return;
    if (!insights || !insights.chips || !insights.chips.length) {
      smartInsights.classList.add("hidden");
      smartInsights.innerHTML = "";
      return;
    }
    smartInsights.innerHTML = "";
    insights.chips.forEach(function (chip) {
      const row = document.createElement("div");
      row.className = "insight-chip";
      row.innerHTML =
        '<span class="insight-ico" aria-hidden="true">✅</span><span class="insight-text"></span>';
      row.querySelector(".insight-text").textContent = chip.text || "";
      smartInsights.appendChild(row);
    });
    smartInsights.classList.remove("hidden");
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function modeLabel(mode) {
    if (mode === "notes") return "Notes";
    if (mode === "api_docs") return "API";
    return "README";
  }

  function pushHistory(entry) {
    const items = loadHistory();
    items.unshift(entry);
    while (items.length > MAX_HISTORY) items.pop();
    saveHistory(items);
    renderHistory();
  }

  function renderHistory() {
    const items = loadHistory();
    historyList.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "history-empty";
      li.textContent = "No history yet — clean something to see it here.";
      historyList.appendChild(li);
      return;
    }
    items.forEach(function (item) {
      const itemHid = item.hid || String(item.ts);
      const li = document.createElement("li");
      li.className = "history-card";
      const top = document.createElement("div");
      top.className = "history-card-top";
      const badge = document.createElement("span");
      badge.className = "history-badge";
      badge.textContent = modeLabel(item.mode || "readme");
      const time = document.createElement("span");
      time.className = "history-time";
      time.textContent = new Date(item.ts).toLocaleString();
      top.appendChild(badge);
      top.appendChild(time);

      const snippet = document.createElement("div");
      snippet.className = "history-snippet";
      snippet.textContent = item.outputPreview || item.inputPreview || "(empty)";

      const hoverPrev = document.createElement("div");
      hoverPrev.className = "history-hover-preview";
      hoverPrev.setAttribute("role", "tooltip");
      var prevText = (item.output || "").trim();
      if (prevText.length > 900) prevText = prevText.slice(0, 900) + "\n…";
      hoverPrev.textContent = prevText || "(no output)";

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "btn btn-secondary btn-small";
      loadBtn.textContent = "Load into editor";
      loadBtn.addEventListener("click", function () {
        input.value = item.input || "";
        if (item.mode === "readme" || item.mode === "notes" || item.mode === "api_docs") {
          setMode(item.mode);
        }
        if (chkFixCode) chkFixCode.checked = !!item.fix_code;
        setView("preview");
        setOutput(item.output || "", item.insights || null);
        beforeSnapshot = item.input || "";
        showToast("Loaded into editor");
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-ghost btn-small";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async function (e) {
        e.stopPropagation();
        const out = item.output || "";
        if (!out) return;
        try {
          await navigator.clipboard.writeText(out);
          showToast("Copied cleaned output");
        } catch (err) {
          showToast("Copy failed", true);
        }
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-small history-btn-del";
      delBtn.setAttribute("aria-label", "Delete");
      delBtn.title = "Remove from history";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        const next = loadHistory().filter(function (x) {
          return (x.hid || String(x.ts)) !== itemHid;
        });
        saveHistory(next);
        renderHistory();
        showToast("Removed from history");
      });

      actions.appendChild(loadBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);
      li.appendChild(top);
      li.appendChild(snippet);
      li.appendChild(hoverPrev);
      li.appendChild(actions);
      historyList.appendChild(li);
    });
  }

  btnClearHistory.addEventListener("click", function () {
    if (confirm("Clear all history?")) {
      localStorage.removeItem(STORAGE_KEY);
      renderHistory();
    }
  });

  function setExportEnabled(on) {
    [btnCopy, btnCopyReadme, btnCopyHtml, btnDownload, btnDownloadPdf].forEach(function (b) {
      if (b) b.disabled = !on;
    });
  }

  function setOutput(md, insights) {
    currentMarkdown = md || "";
    outputRaw.textContent = currentMarkdown;
    renderPreview(currentMarkdown);
    const has = currentMarkdown.length > 0;
    setExportEnabled(has);
    renderInsights(insights);
    if (toggleCompare && toggleCompare.classList.contains("active")) {
      renderCompareView();
    }
  }

  btnSample.addEventListener("click", function () {
    input.value = SAMPLE_MESSY;
    input.focus();
    showToast("Sample loaded — press Clean or Ctrl+Enter.");
  });

  input.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      btnClean.click();
    }
  });

  btnClean.addEventListener("click", async function () {
    const text = input.value.trim();
    if (!text) {
      showStatus("Please paste some content first.", true);
      showToast("Nothing to clean yet.", true);
      return;
    }
    hideErrorBanner();
    setLoading(true);
    renderInsights(null);
    try {
      const res = await fetch("/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text,
          mode: getMode(),
          fix_code: getFixCode(),
        }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const friendly = friendlyApiMessage(data.error || "Request failed");
        showErrorBanner(friendly);
        showStatus(friendly, true);
        showToast(friendly, true);
        return;
      }
      beforeSnapshot = text;
      setOutput(data.markdown || "", data.insights || null);
      showStatus("Done — Markdown is ready.", false);
      showToast("✅ Cleaned successfully");
      if (panelOutput) {
        panelOutput.classList.remove("output-flash-success");
        void panelOutput.offsetWidth;
        panelOutput.classList.add("output-flash-success");
        setTimeout(function () {
          panelOutput.classList.remove("output-flash-success");
        }, 1400);
      }
      const outPrev = (data.markdown || "").slice(0, 140) + ((data.markdown || "").length > 140 ? "…" : "");
      const hid = "h" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      pushHistory({
        hid: hid,
        ts: Date.now(),
        inputPreview: text.slice(0, 120) + (text.length > 120 ? "…" : ""),
        outputPreview: outPrev,
        input: text,
        output: data.markdown || "",
        insights: data.insights || null,
        mode: data.mode || getMode(),
        fix_code: data.fix_code || false,
      });
    } catch (err) {
      const friendly = friendlyApiMessage(err.message || "Network error");
      showErrorBanner(friendly);
      showStatus(friendly, true);
      showToast(friendly, true);
    } finally {
      setLoading(false);
    }
  });

  btnCopy.addEventListener("click", async function () {
    if (!currentMarkdown) return;
    try {
      await navigator.clipboard.writeText(currentMarkdown);
      showToast("Copied Markdown");
    } catch (e) {
      showToast("Could not copy", true);
    }
  });

  btnCopyReadme.addEventListener("click", async function () {
    if (!currentMarkdown) return;
    var text = currentMarkdown.trim();
    if (!/^\s*#/.test(text)) {
      text = "# README\n\n" + text;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied for GitHub README");
    } catch (e) {
      showToast("Could not copy", true);
    }
  });

  btnCopyHtml.addEventListener("click", async function () {
    if (!currentMarkdown || typeof marked === "undefined") return;
    configureMarked();
    var html = marked.parse(currentMarkdown);
    if (typeof DOMPurify !== "undefined") html = DOMPurify.sanitize(html);
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([currentMarkdown], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      showToast("Copied HTML");
    } catch (e) {
      try {
        await navigator.clipboard.writeText(html);
        showToast("Copied HTML (plain)");
      } catch (e2) {
        showToast("Could not copy HTML", true);
      }
    }
  });

  btnDownload.addEventListener("click", function () {
    if (!currentMarkdown) return;
    const blob = new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gpt-cleaner-output.md";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded .md");
  });

  btnDownloadPdf.addEventListener("click", function () {
    if (!currentMarkdown || typeof marked === "undefined") return;
    configureMarked();
    var bodyHtml = marked.parse(currentMarkdown);
    if (typeof DOMPurify !== "undefined") bodyHtml = DOMPurify.sanitize(bodyHtml);
    const w = window.open("", "_blank");
    if (!w) {
      showToast("Allow pop-ups to print PDF", true);
      return;
    }
    w.document.open();
    w.document.write(
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>GPT-Cleaner export</title><style>body{font-family:system-ui,Segoe UI,sans-serif;padding:1.25rem;line-height:1.5;color:#111}code,pre{font-family:ui-monospace,Consolas,monospace;font-size:0.9em}pre{background:#f4f4f5;padding:0.75rem;border-radius:8px;overflow:auto}h1,h2,h3{margin-top:1.2em}a{color:#2563eb}</style></head><body>"
    );
    w.document.write(bodyHtml);
    w.document.write("</body></html>");
    w.document.close();
    w.focus();
    setTimeout(function () {
      w.print();
    }, 250);
    showToast("Print dialog — choose Save as PDF");
  });

  if (input && outputWrap && chkScrollSync) {
    input.addEventListener("scroll", function () {
      if (!chkScrollSync.checked || scrollSyncing) return;
      const ih = input.scrollHeight - input.clientHeight;
      const oh = outputWrap.scrollHeight - outputWrap.clientHeight;
      if (ih <= 0 || oh <= 0) return;
      const ratio = input.scrollTop / ih;
      scrollSyncing = true;
      outputWrap.scrollTop = ratio * oh;
      requestAnimationFrame(function () {
        scrollSyncing = false;
      });
    });
  }

  const compareScrollEls = document.querySelectorAll(".compare-scroll");
  let cmpScrollLock = false;
  if (compareScrollEls.length === 2) {
    compareScrollEls[0].addEventListener("scroll", function () {
      if (cmpScrollLock) return;
      const a = compareScrollEls[0];
      const b = compareScrollEls[1];
      const ra = a.scrollHeight - a.clientHeight;
      if (ra <= 0) return;
      const rb = b.scrollHeight - b.clientHeight;
      if (rb <= 0) return;
      cmpScrollLock = true;
      b.scrollTop = (a.scrollTop / ra) * rb;
      requestAnimationFrame(function () {
        cmpScrollLock = false;
      });
    });
    compareScrollEls[1].addEventListener("scroll", function () {
      if (cmpScrollLock) return;
      const a = compareScrollEls[0];
      const b = compareScrollEls[1];
      const rb = b.scrollHeight - b.clientHeight;
      if (rb <= 0) return;
      const ra = a.scrollHeight - a.clientHeight;
      if (ra <= 0) return;
      cmpScrollLock = true;
      a.scrollTop = (b.scrollTop / rb) * ra;
      requestAnimationFrame(function () {
        cmpScrollLock = false;
      });
    });
  }

  initTheme();
  wireModeButtons();
  configureMarked();
  setView("preview");
  renderHistory();
  setExportEnabled(false);
})();
