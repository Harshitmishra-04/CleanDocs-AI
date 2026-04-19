(function () {
  "use strict";

  var KEY = "gpt-cleaner-theme";

  function applyTheme(dark) {
    document.body.classList.toggle("dark", dark);
    localStorage.setItem(KEY, dark ? "dark" : "light");
    var icon = document.getElementById("landing-theme-icon");
    if (icon) {
      icon.textContent = dark ? "☀️" : "🌙";
    }
  }

  function init() {
    var saved = localStorage.getItem(KEY);
    if (saved === "light") {
      applyTheme(false);
    } else {
      applyTheme(true);
    }

    var btn = document.getElementById("btn-landing-theme");
    if (btn) {
      btn.addEventListener("click", function () {
        applyTheme(!document.body.classList.contains("dark"));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
