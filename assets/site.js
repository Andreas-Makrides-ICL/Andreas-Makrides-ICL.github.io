(function () {
  "use strict";

  /* ---------- theme toggle ---------- */
  var root = document.documentElement;
  function storedTheme() { try { return localStorage.getItem("theme"); } catch (e) { return null; } }
  function saveTheme(t) { try { localStorage.setItem("theme", t); } catch (e) {} }
  function currentTheme() {
    return root.getAttribute("data-theme") ||
      (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
  var saved = storedTheme();
  if (saved) root.setAttribute("data-theme", saved);
  var themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    var label = function () {
      themeBtn.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme");
    };
    label();
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      saveTheme(next);
      label();
    });
  }

  /* ---------- mobile menu ---------- */
  var menuBtn = document.getElementById("menu-toggle");
  var nav = document.getElementById("site-nav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") { nav.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
    });
  }

  /* ---------- quant pipeline: forecast, optimise, backtest, risk ---------- */
  var desk = document.getElementById("desk");
  if (desk) {
    var NS = "http://www.w3.org/2000/svg";
    // Illustrative GB day-ahead price shapes (GBP/MWh)
    var days = {
      sunny: [72, 68, 65, 63, 64, 70, 85, 98, 90, 70, 52, 40, 32, 28, 30, 38, 55, 88, 120, 135, 118, 96, 84, 76],
      winter: [80, 76, 74, 72, 74, 82, 105, 128, 122, 110, 102, 98, 96, 95, 100, 115, 140, 168, 175, 160, 138, 115, 98, 88],
      windy: [42, 35, 28, 22, 18, 20, 30, 48, 55, 50, 45, 40, 38, 36, 40, 48, 62, 80, 92, 85, 70, 58, 50, 46]
    };
    var seeds = { sunny: 11, winter: 23, windy: 37 };
    var N = 1000, SHOW = 90, FC_SD = 8.75;
    var W = 260, L = 30, R = 252, T = 12, B = 122;
    var $ = function (id) { return document.getElementById(id); };

    function el(tag, attrs, parent) {
      var n = document.createElementNS(NS, tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    }
    function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function fmt(x) { return (x < 0 ? "−£" : "£") + Math.abs(Math.round(x)).toLocaleString("en-GB"); }
    function scale(d0, d1, r0, r1) { return function (v) { return r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); }; }

    // seeded random numbers, so every visitor sees the same simulation
    function rng(seed) {
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    function normal(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

    // Exact dynamic programme: 1 MW battery, d MWh, integer state of charge,
    // each hour charge (+1), discharge (-1) or idle, round-trip losses applied on discharge.
    function optimise(prices, d, eta) {
      var n = prices.length, V = [], A = [], t, s;
      for (t = 0; t <= n; t++) { V.push([]); A.push([]); for (s = 0; s <= d; s++) { V[t].push(t === n ? 0 : -1e12); A[t].push(0); } }
      for (t = n - 1; t >= 0; t--) {
        for (s = 0; s <= d; s++) {
          var best = V[t + 1][s], act = 0;
          if (s < d && V[t + 1][s + 1] - prices[t] > best) { best = V[t + 1][s + 1] - prices[t]; act = 1; }
          if (s > 0 && V[t + 1][s - 1] + eta * prices[t] > best) { best = V[t + 1][s - 1] + eta * prices[t]; act = -1; }
          V[t][s] = best; A[t][s] = act;
        }
      }
      var plan = [], cur = 0;
      for (t = 0; t < n; t++) { var a = A[t][cur]; plan.push(a); cur += a; }
      return { profit: V[0][0], plan: plan };
    }
    function pnl(plan, prices, eta) {
      var v = 0;
      for (var h = 0; h < plan.length; h++) v += plan[h] > 0 ? -prices[h] : plan[h] < 0 ? eta * prices[h] : 0;
      return v;
    }
    function frame(svg, yMin, yMax, yFmt) {
      var y = scale(yMin, yMax, B, T);
      [yMin, (yMin + yMax) / 2, yMax].forEach(function (v) {
        el("line", { x1: L, x2: R, y1: y(v), y2: y(v), "class": "grid" }, svg);
        el("text", { x: L - 5, y: y(v) + 3, "text-anchor": "end", "class": "tick" }, svg).textContent = yFmt(v);
      });
      return y;
    }
    function path(xs, ys) { return xs.map(function (x, i) { return (i ? "L" : "M") + x.toFixed(1) + " " + ys[i].toFixed(1); }).join(" "); }

    var state = { day: "sunny" };
    var durIn = $("duration"), effIn = $("efficiency");

    function render() {
      var base = days[state.day], d = +durIn.value, eta = +effIn.value / 100;
      $("duration-out").textContent = d + " h";
      $("efficiency-out").textContent = effIn.value + "%";

      // simulate realised prices and probabilistic forecasts
      var r = rng(seeds[state.day]), sims = [], i, h;
      for (i = 0; i < N; i++) {
        var lvl = 12 * normal(r), e = 0, f = 0, act = [], fc = [];
        for (h = 0; h < 24; h++) {
          e = 0.7 * e + 10 * normal(r);
          f = 0.6 * f + 7 * normal(r);
          act.push(base[h] + lvl + e);
          fc.push(base[h] + lvl + e + f);
        }
        sims.push({ act: act, fc: fc });
      }
      var bench = optimise(base, d, eta).plan;        // fixed schedule from the typical day
      var mae = 0, A = [], Bm = [];
      sims.forEach(function (s) {
        for (var k = 0; k < 24; k++) mae += Math.abs(s.fc[k] - s.act[k]);
        A.push(pnl(optimise(s.fc, d, eta).plan, s.act, eta));
        Bm.push(pnl(bench, s.act, eta));
      });
      mae /= N * 24;

      // 1. forecast
      var day0 = sims[0], fsvg = $("p-forecast"); clear(fsvg);
      var hx = scale(0, 23, L + 4, R - 4);
      var yP = frame(fsvg, 0, 200, function (v) { return "£" + v; });
      var xs = base.map(function (_, k) { return hx(k); });
      var up = day0.fc.map(function (v) { return yP(v + 1.645 * FC_SD); });
      var lo = day0.fc.map(function (v) { return yP(v - 1.645 * FC_SD); });
      el("path", { d: path(xs, up) + " " + xs.slice().reverse().map(function (x, k) { return "L" + x.toFixed(1) + " " + lo[23 - k].toFixed(1); }).join(" ") + " Z", "class": "band" }, fsvg);
      el("path", { d: path(xs, day0.fc.map(yP)), "class": "fc" }, fsvg);
      el("path", { d: path(xs, day0.act.map(yP)), "class": "price" }, fsvg);
      $("o-mae").textContent = "£" + mae.toFixed(1) + "/MWh";

      // 2. optimise
      var osvg = $("p-optimise"); clear(osvg);
      var yO = frame(osvg, 0, 200, function (v) { return "£" + v; });
      var plan0 = optimise(day0.fc, d, eta).plan, cw = (R - L - 8) / 24;
      plan0.forEach(function (a, k) {
        if (a) el("rect", { x: hx(k) - cw / 2 + 0.5, y: T, width: cw - 1, height: B - T, rx: 1, "class": a > 0 ? "col-buy" : "col-sell" }, osvg);
      });
      el("path", { d: path(xs, day0.act.map(yO)), "class": "price" }, osvg);
      [0, 12, 23].forEach(function (k, j) {
        el("text", { x: hx(k), y: B + 13, "text-anchor": j === 0 ? "start" : j === 2 ? "end" : "middle", "class": "tick" }, osvg).textContent = ["00:00", "12:00", "23:00"][j];
      });
      $("o-profit").textContent = fmt(A[0]) + " today";

      // 3. backtest: cumulative P&L over the first SHOW days
      var bsvg = $("p-backtest"); clear(bsvg);
      var cumA = [0], cumB = [0];
      for (i = 0; i < SHOW; i++) { cumA.push(cumA[i] + A[i]); cumB.push(cumB[i] + Bm[i]); }
      var top = Math.max(cumA[SHOW], cumB[SHOW], 1);
      var yB = frame(bsvg, 0, top, function (v) { return v >= 1000 ? "£" + Math.round(v / 1000) + "k" : "£" + Math.round(v); });
      var dx = scale(0, SHOW, L + 2, R - 2);
      var bx = cumA.map(function (_, k) { return dx(k); });
      el("path", { d: path(bx, cumB.map(yB)), "class": "bench" }, bsvg);
      el("path", { d: path(bx, cumA.map(yB)), "class": "strat" }, bsvg);
      el("text", { x: L, y: B + 13, "class": "tick" }, bsvg).textContent = "day 0";
      el("text", { x: R, y: B + 13, "text-anchor": "end", "class": "tick" }, bsvg).textContent = "day " + SHOW;
      var sumA = A.reduce(function (s, v) { return s + v; }, 0), sumB = Bm.reduce(function (s, v) { return s + v; }, 0);
      var better = A.filter(function (v, k) { return v > Bm[k]; }).length;
      $("o-sharpe").textContent = (sumA >= sumB ? "+" : "") + Math.round((sumA / sumB - 1) * 100) + "%, ahead on " + Math.round(better / N * 100) + "% of days";

      // 4. risk: distribution of daily P&L
      var rsvg = $("p-risk"); clear(rsvg);
      var sorted = A.slice().sort(function (a, b) { return a - b; });
      var k5 = Math.floor(0.05 * N), var5 = sorted[k5];
      var cvar = sorted.slice(0, k5).reduce(function (s, v) { return s + v; }, 0) / k5;
      var lo2 = sorted[Math.floor(0.005 * N)], hi2 = sorted[Math.ceil(0.995 * N) - 1], bins = 24;
      var w = (hi2 - lo2) / bins || 1, counts = [];
      for (i = 0; i < bins; i++) counts.push(0);
      A.forEach(function (v) { counts[Math.max(0, Math.min(bins - 1, Math.floor((v - lo2) / w)))]++; });
      var cmax = Math.max.apply(null, counts), bw = (R - L) / bins, xr = scale(lo2, hi2, L, R);
      el("line", { x1: L, x2: R, y1: B, y2: B, "class": "axis" }, rsvg);
      counts.forEach(function (c, j) {
        var hgt = c / cmax * (B - T - 12);
        el("rect", { x: L + j * bw + 0.5, y: B - hgt, width: bw - 1, height: hgt, rx: 1, "class": lo2 + (j + 1) * w <= var5 + w / 2 ? "hist tail" : "hist" }, rsvg);
      });
      el("line", { x1: xr(var5), x2: xr(var5), y1: T, y2: B, "class": "marker-line" }, rsvg);
      el("text", { x: xr(var5) + 4, y: T + 8, "class": "tick" }, rsvg).textContent = "5% VaR";
      [lo2, hi2].forEach(function (v, j) {
        el("text", { x: j ? R : L, y: B + 13, "text-anchor": j ? "end" : "start", "class": "tick" }, rsvg).textContent = fmt(v);
      });
      $("o-var").textContent = fmt(var5) + ", CVaR " + fmt(cvar);
    }

    var dayBtns = desk.querySelectorAll("[data-day]");
    dayBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.day = btn.getAttribute("data-day");
        dayBtns.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
        render();
      });
    });
    var langBtns = desk.querySelectorAll("[data-lang]");
    langBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        langBtns.forEach(function (b) {
          var on = b === btn;
          b.setAttribute("aria-pressed", on ? "true" : "false");
          $("code-" + b.getAttribute("data-lang")).hidden = !on;
        });
      });
    });
    durIn.addEventListener("input", render);
    effIn.addEventListener("input", render);
    render();
  }

  /* ---------- publications: filters and BibTeX copy ---------- */
  var filterBtns = document.querySelectorAll("[data-filter]");
  if (filterBtns.length) {
    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var f = btn.getAttribute("data-filter");
        filterBtns.forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
        document.querySelectorAll("[data-type]").forEach(function (item) {
          item.hidden = !(f === "all" || item.getAttribute("data-type") === f);
        });
        document.querySelectorAll(".year-group").forEach(function (g) {
          if (g.querySelector("[data-type]")) g.hidden = !g.querySelector("[data-type]:not([hidden])");
        });
      });
    });
  }
  document.querySelectorAll("[data-bibtex]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-bibtex"));
      if (!src) return;
      var done = function () {
        var note = btn.parentNode.querySelector(".copied");
        if (!note) { note = document.createElement("span"); note.className = "copied"; note.setAttribute("role", "status"); btn.parentNode.appendChild(note); }
        note.textContent = "BibTeX copied";
        setTimeout(function () { note.textContent = ""; }, 2000);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(src.textContent.trim()).then(done, function () {});
    });
  });
})();
