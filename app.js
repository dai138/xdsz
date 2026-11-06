/* ============================================================
 * 线性代数 智能刷题系统
 * 功能：按部分/顺序/随机练习、错题记忆与强化、知识点加权、
 *       逐选项解析、大题自评、模拟考试（随机20题·限时30分钟）、
 *       统计与进度导出
 * 数据保存在浏览器 localStorage（建议使用 Chrome 打开）
 * ============================================================ */
'use strict';

const LS_KEY = 'laquiz_state_v1';
const CHAPTERS = [
  '第一部分 矩阵与行列式基础',
  '第二部分 逆矩阵与初等变换',
  '第三部分 分块矩阵与线性方程组',
  '第四部分 向量乘法与综合应用',
];

function defaultState() {
  return { q: {}, e: {}, t: {}, examHist: [], settings: { mode: 'adaptive', chapter: 0, count: 10 } };
}
let state;
try {
  state = JSON.parse(localStorage.getItem(LS_KEY)) || defaultState();
  state.q = state.q || {}; state.e = state.e || {}; state.t = state.t || {};
  state.examHist = state.examHist || [];
} catch (e) { state = defaultState(); }
function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

// ---------------- 状态与加权 ----------------
const topicKey = q => q.ch + '|' + q.topic;

function topicW(q) {          // 知识点错题加权：错得多 → 该知识点下所有题权重升高
  const t = state.t[topicKey(q)] || { r: 0, w: 0 };
  return Math.max(0, Math.min(4, t.w - t.r * 0.5));
}
function questionWeight(q, id) {
  const s = (id === undefined ? state.q[q.id] : id) || {};
  let w = 1;
  if (s.seen === undefined) w += 3;      // 新题优先出现
  if (s.last === 'w') w += 4;            // 上次错了 → 本次马上再考
  w += 3 * Math.min(s.w || 0, 5);        // 累计错得越多权重越高
  w += 2 * topicW(q);                    // 知识点加权
  return w;
}

// ---------------- 通用组件 ----------------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = s => esc(s).replace(/\n/g, '<br>');
function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60), ss = s % 60;
  return (m < 10 ? '0' + m : m) + ':' + (ss < 10 ? '0' + ss : ss);
}

function chapterOptions(selEl, chosen) {
  selEl.innerHTML = '';
  const all = document.createElement('option');
  all.value = 0; all.textContent = '全部部分';
  selEl.appendChild(all);
  CHAPTERS.forEach((name, i) => {
    const o = document.createElement('option');
    o.value = i + 1; o.textContent = name + ' ' + chapterAcc(i + 1);
    selEl.appendChild(o);
  });
  selEl.value = chosen || 0;
}
function chapterAcc(ch) {
  let r = 0, w = 0;
  BANK.filter(q => q.ch === ch).forEach(q => {
    const s = state.q[q.id];
    if (s) { r += s.r; w += s.w; }
  });
  if (r + w === 0) return '';
  return `（对${r}/错${w} ${Math.round(100 * r / (r + w))}%）`;
}
function topicAcc(key) {
  const t = state.t[key] || { r: 0, w: 0 };
  if (t.r + t.w === 0) return null;
  return Math.round(100 * t.r / (t.r + t.w));
}

// ---------------- 页面切换 ----------------
function show(page) {
  if (exam.running && page !== 'exam') {
    if (!confirm('模拟考试正在进行中，离开将终止本次考试（不计成绩），确定离开？')) return;
    exam.abort();
  }
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#page-' + page).classList.remove('hidden');
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'home') renderHome();
  if (page === 'wrong') renderWrong();
  if (page === 'stats') renderStats();
}

// ---------------- 首页 ----------------
function renderHome() {
  const total = BANK.length;
  const done = Object.values(state.q).filter(s => (s.r || s.w)).length;
  const wCnt = Object.values(state.q).filter(s => s.w > 0).length;
  $('#home-summary').innerHTML =
    `客观题共 <b>${total}</b> 题 · 已作答 <b>${done}</b> 题 · 错题本 <b>${wCnt}</b> 题 · 大题 <b>${ESSAYS.length}</b> 项 · 模拟考试 <b>${state.examHist.length}</b> 次`;
}
function startQuiz(mode) {
  const ch = mode === 'chapter' ? parseInt($('#chapter-select').value, 10) : 0;
  const count = parseInt($('#count-select').value, 10) || 0;
  quiz.init(mode, ch, count);
  show('quiz');
}
function startEssay() {
  essay.init();
  show('quiz');
}
function startExam() {
  exam.init();
}

// ---------------- 客观题练习 ----------------
const quiz = {
  mode: 'adaptive', ch: 0, count: 0,
  session: [], used: new Set(), idx: 0,
  sessionR: 0, sessionW: 0, selections: [], blankVals: [],

  init(mode, ch, count) {
    this.mode = mode; this.ch = ch; this.count = count;
    this.session = []; this.used = new Set(); this.idx = 0;
    this.sessionR = 0; this.sessionW = 0;
    this.next();
  },

  pool() {
    let p = BANK.filter(q => !this.ch || q.ch === this.ch);
    if (this.mode === 'wrong') p = p.filter(q => (state.q[q.id] || {}).w > 0);
    return p;
  },

  next() {
    if (this.count && this.used.size >= this.count) { this.finish(); return; }
    const pool = this.pool();
    let q = null;
    if (this.mode === 'order') {
      q = pool.find(x => !this.used.has(x.id));
    } else {
      const unused = pool.filter(x => !this.used.has(x.id));
      if (unused.length) {
        const ws = unused.map(x => questionWeight(x));
        let total = ws.reduce((a, b) => a + b, 0), r = Math.random() * total;
        for (let i = 0; i < unused.length; i++) { r -= ws[i]; if (r <= 0) { q = unused[i]; break; } }
        if (!q) q = unused[unused.length - 1];
      }
    }
    if (q) this.used.add(q.id);
    this.render(q);
  },

  render(q) {
    if (!q) { this.finish(); return; }
    this.q = q;
    this.selections = []; this.blankVals = (q.type === 'blank' ? q.blanks.map(() => '') : []);
    const poolLen = this.pool().length;
    const done = this.idx, totalN = this.count ? Math.min(this.count, poolLen) : poolLen;
    $('#quiz-title').textContent =
      `${this.mode === 'wrong' ? '错题强化 · ' : ''}第 ${done + 1} / ${totalN} 题`;
    $('#quiz-progress').style.width = (done / Math.max(1, totalN) * 100) + '%';
    $('#quiz-score').textContent = `本次：对 ${this.sessionR} · 错 ${this.sessionW}`;

    let html = `<div class="q-meta"><span class="chip">${CHAPTERS[q.ch - 1]}</span><span class="chip chip-topic">${esc(q.topic)}</span>${q.type === 'multi' ? '<span class="chip chip-multi">多选题</span>' : q.type === 'judge' ? '<span class="chip chip-judge">判断题</span>' : q.type === 'blank' ? '<span class="chip chip-blank">填空题</span>' : ''}</div>`;
    html += `<div class="q-stem">${fmt(q.stem)}</div>`;
    if (q.img) html += `<div class="q-img"><img src="${q.img}" alt="题目示意图" onerror="this.parentElement.style.display='none'"></div>`;

    if (q.type === 'blank') {
      html += `<div class="blank-wrap">`;
      q.blanks.forEach((b, i) => {
        html += `<div class="blank-item"><input type="text" class="blank-input" placeholder="第${i + 1}空" data-i="${i}"></div>`;
      });
      html += `</div><button class="btn btn-primary btn-block" id="btn-submit">提交答案（Enter）</button>`;
    } else {
      html += `<div class="options">`;
      q.options.forEach((op, i) => {
        html += `<button class="option" data-i="${i}"><span class="opt-tag">${'ABCDEFGH'[i]}</span><span>${esc(op)}</span></button>`;
      });
      html += `</div>`;
      if (q.type === 'multi') html += `<button class="btn btn-primary btn-block" id="btn-submit">提交所选（Enter）</button>`;
    }

    html += `<div id="feedback"></div>
      <div id="next-area" class="hidden"><button class="btn btn-primary btn-block" id="btn-next">下一题（Enter）</button></div>`;
    $('#quiz-body').innerHTML = html;

    $$('.option').forEach(btn => btn.addEventListener('click', () => this.onOption(btn)));
    $$('.blank-input').forEach(inp => inp.addEventListener('input', e => {
      this.blankVals[parseInt(e.target.dataset.i, 10)] = e.target.value;
    }));
    const sb = $('#btn-submit');
    if (sb) sb.addEventListener('click', () => this.submit());
    const nb = $('#btn-next');
    if (nb) nb.addEventListener('click', () => { this.idx++; this.next(); });
    $('#quiz-body').scrollIntoView({ block: 'start' });
    if (!this.enterBound) {
      this.enterBound = true;
      document.addEventListener('keydown', e => this.onKey(e));
    }
  },

  onKey(e) {
    const fb = $('#feedback');
    const answered = fb && fb.classList.contains('done');
    if (e.key === 'Enter') {
      if (answered) { const n = $('#btn-next'); if (n) n.click(); }
      else { const s = $('#btn-submit'); if (s) s.click(); }
    }
    const optN = parseInt(e.key, 10);
    if (!answered && optN >= 1 && optN <= 4) {
      const btns = $$('.option');
      if (btns.length && !$('#btn-submit')) {          // 单选/判断：直接选并提交
        this.onOption(btns[optN - 1]);
      } else if (btns.length) {
        this.onOption(btns[optN - 1]);                 // 多选：切换选择
      }
    }
  },

  onOption(btn) {
    const i = parseInt(btn.dataset.i, 10);
    if (this.q.type === 'multi') {
      const p = this.selections.indexOf(i);
      if (p >= 0) this.selections.splice(p, 1); else this.selections.push(i);
      btn.classList.toggle('selected');
    } else {
      this.selections = [i];
      this.submit();
    }
  },

  correct() {
    const a = this.q.answer;
    if (this.q.type === 'multi') {
      const arr = this.selections.slice().sort();
      return arr.length === a.length && arr.every((v, i) => v === a[i]);
    }
    if (this.q.type === 'blank') {
      return this.q.accepts.every((acc, i) =>
        acc.some(v => v.toLowerCase() === (this.blankVals[i] || '').trim().toLowerCase()));
    }
    return this.selections[0] === a;
  },

  submit() {
    if (this.q.type === 'blank' && this.blankVals.some(v => !v.trim())) {
      $('#feedback').innerHTML = '<div class="fb-warn">请填写所有空格后再提交</div>';
      return;
    }
    if (this.q.type === 'multi' && !this.selections.length) {
      $('#feedback').innerHTML = '<div class="fb-warn">请至少选择一个选项</div>';
      return;
    }
    const ok = this.correct();
    this.record(ok);
    const fb = $('#feedback');
    fb.classList.add('done');
    $('#next-area').classList.remove('hidden');
    const sb = $('#btn-submit'); if (sb) sb.classList.add('hidden');

    let html = `<div class="fb-result ${ok ? 'fb-ok' : 'fb-bad'}">${ok ? '✓ 回答正确！' : '✗ 回答错误'}</div>`;
    if (this.q.type === 'blank') {
      const user = this.blankVals.join('、') || '（未填）';
      const ref = this.q.accepts.map(a => a[0]).join('、');
      html += `<div class="fb-line">你的答案：${esc(user)}　|　参考答案：${esc(ref)}</div>`;
    } else {
      const isCorrectOpt = i => this.q.type === 'multi' ? this.q.answer.includes(i) : this.q.answer === i;
      const isPicked = i => this.selections.includes(i);
      html += `<div class="fb-options">`;
      this.q.options.forEach((op, i) => {
        let cls = '', mark = '';
        if (isCorrectOpt(i)) { cls = 'opt-right'; mark = '✓'; }
        else if (isPicked(i)) { cls = 'opt-wrong'; mark = '✗'; }
        html += `<div class="fb-opt ${cls}"><span class="opt-tag">${'ABCDEFGH'[i]}${mark}</span>
          <div><div class="fb-opt-text">${esc(op)}</div>
          ${(isCorrectOpt(i) || isPicked(i)) && this.q.exp[i] ? `<div class="fb-opt-exp">${esc(this.q.exp[i])}</div>` : ''}</div></div>`;
      });
      html += `</div>`;
      // 未选的选项解析折叠显示
      const rest = this.q.exp.filter((_, i) => !isCorrectOpt(i) && !isPicked(i)).join('　');
      if (rest && this.q.exp.length >= 3) html += `<details class="fb-rest"><summary>查看其余选项解析</summary><div class="fb-opt-exp">${esc(rest)}</div></details>`;
    }
    if (this.q.note) html += `<div class="fb-note">📌 ${esc(this.q.note)}</div>`;
    if (ok) this.sessionR++; else this.sessionW++;
    $('#quiz-score').textContent = `本次：对 ${this.sessionR} · 错 ${this.sessionW}`;
    fb.innerHTML = html;
  },

  record(ok) {
    const q = this.q;
    const s = state.q[q.id] = state.q[q.id] || { r: 0, w: 0, seen: true };
    const t = state.t[topicKey(q)] = state.t[topicKey(q)] || { r: 0, w: 0 };
    s.seen = true; s.last = ok ? 'r' : 'w';
    if (ok) { s.r++; t.r++; } else { s.w++; t.w++; }
    save();
  },

  finish() {
    $('#quiz-title').textContent = '本组练习完成';
    $('#quiz-progress').style.width = '100%';
    $('#quiz-score').textContent = `本次：对 ${this.sessionR} · 错 ${this.sessionW}`;
    const wrongInSession = [...this.used].filter(id => {
      const s = state.q[id];
      return s && s.last === 'w';
    });
    $('#quiz-body').innerHTML = `
      <div class="finish-box">
        <div class="finish-emoji">🎉</div>
        <div class="finish-title">本组完成</div>
        <div class="finish-line">正确 <b>${this.sessionR}</b> · 错误 <b>${this.sessionW}</b>${this.sessionR + this.sessionW ? ` · 正确率 <b>${Math.round(100 * this.sessionR / (this.sessionR + this.sessionW))}%</b>` : ''}</div>
        ${wrongInSession.length ? `<div class="finish-tip">💡 本组有 <b>${wrongInSession.length}</b> 题答错，已自动记入错题本，下次练习会优先出现并连带强化对应知识点。</div>` : ''}
        <div class="finish-btns">
          <button class="btn btn-primary" onclick="startQuiz(quiz.mode==='chapter'?'chapter':quiz.mode)">再练一组</button>
          <button class="btn" onclick="show('wrong')">查看错题本</button>
          <button class="btn" onclick="show('home')">返回首页</button>
        </div>
      </div>`;
  }
};

// ---------------- 大题自评 ----------------
const essay = {
  idx: 0, session: [], used: new Set(), showAns: false,

  init() {
    this.idx = 0; this.used = new Set(); this.showAns = false;
    this.pick();
  },

  pick() {
    const unused = ESSAYS.filter(x => !this.used.has(x.id));
    let item = null;
    if (unused.length) {
      const ws = unused.map(x => questionWeight(x, state.e[x.id]));
      let total = ws.reduce((a, b) => a + b, 0), r = Math.random() * total;
      for (let i = 0; i < unused.length; i++) { r -= ws[i]; if (r <= 0) { item = unused[i]; break; } }
      if (!item) item = unused[unused.length - 1];
      this.used.add(item.id);
    }
    if (item) this.render(item); else {
      $('#quiz-body').innerHTML = `<div class="finish-box"><div class="finish-emoji">🎉</div><div class="finish-title">本轮自评完成</div><div class="finish-btns"><button class="btn btn-primary" onclick="essay.init()">再来一轮</button><button class="btn" onclick="show('home')">返回首页</button></div></div>`;
    }
  },

  render(item) {
    this.item = item; this.showAns = false;
    $('#quiz-title').textContent = `大题自评 · ${this.used.size} / ${ESSAYS.length}`;
    $('#quiz-progress').style.width = (this.used.size / ESSAYS.length * 100) + '%';
    $('#quiz-score').textContent = '';
    let html = `<div class="q-meta"><span class="chip">${CHAPTERS[item.ch - 1]}</span><span class="chip chip-topic">${esc(item.topic)}</span><span class="chip chip-judge">自评模式</span></div>`;
    html += `<div class="q-stem essay-title">${esc(item.title)}</div>`;
    if (item.stem) html += `<div class="q-stem stem-box">${fmt(item.stem)}</div>`;
    html += `<div class="essay-hint">先在心里/纸上作答，再对照参考答案自评 ↓</div>
      <button class="btn btn-primary btn-block" id="btn-show-ans">显示参考答案</button>
      <div id="essay-ans" class="essay-ans hidden"><pre>${esc(item.answer)}</pre></div>
      <div id="essay-grade" class="hidden">
        <div class="essay-grade-tip">这道题你掌握了吗？（点"没掌握"会记入错题本并加强考查）</div>
        <div class="finish-btns">
          <button class="btn btn-bad" id="btn-grade-no">✗ 没掌握</button>
          <button class="btn btn-ok" id="btn-grade-yes">✓ 掌握了</button>
        </div>
      </div>`;
    $('#quiz-body').innerHTML = html;
    $('#btn-show-ans').addEventListener('click', () => {
      this.showAns = true;
      $('#essay-ans').classList.remove('hidden');
      $('#essay-grade').classList.remove('hidden');
      $('#btn-show-ans').classList.add('hidden');
    });
    $('#btn-grade-no').addEventListener('click', () => this.grade(false));
    $('#btn-grade-yes').addEventListener('click', () => this.grade(true));
  },

  grade(ok) {
    const s = state.e[this.item.id] = state.e[this.item.id] || { r: 0, w: 0 };
    const t = state.t[topicKey(this.item)] = state.t[topicKey(this.item)] || { r: 0, w: 0 };
    s.seen = true; s.last = ok ? 'r' : 'w';
    if (ok) { s.r++; t.r++; } else { s.w++; t.w++; }
    save();
    this.pick();
  }
};

// ---------------- 模拟考试 ----------------
const exam = {
  DURATION: 30 * 60,   // 限时（秒）
  TOTAL: 20,           // 题量
  running: false, submitted: false,
  items: [], picks: [], startTime: 0, endTime: 0, timerId: null, lastResult: null, bound: false,

  init() {
    // 随机抽 20 题（Fisher-Yates 洗牌）
    const pool = BANK.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.items = pool.slice(0, Math.min(this.TOTAL, pool.length));
    this.picks = this.items.map(() => null);
    this.running = true; this.submitted = false; this.lastResult = null;
    this.startTime = Date.now();
    this.endTime = this.startTime + this.DURATION * 1000;
    clearInterval(this.timerId);
    this.timerId = setInterval(() => this.tick(), 1000);
    show('exam');
    this.render();
    if (!this.bound) {
      this.bound = true;
      $('#btn-handin').addEventListener('click', () => this.handin());
    }
    this.tick();
  },

  tick() {
    if (!this.running) return;
    const remain = Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
    $('#exam-timer').textContent = fmtTime(remain);
    $('#exam-timer').classList.toggle('urgent', remain <= 300 && remain > 0);
    document.title = '⏱ ' + fmtTime(remain) + ' · 线性代数模拟考试';
    if (remain === 0) this.submit(true);   // 时间到 → 自动交卷
  },

  render() {
    $('#exam-bar').classList.remove('hidden');
    $('#exam-answered').textContent = `已答 ${this.picks.filter(p => p !== null).length} / ${this.items.length}`;
    let html = '';
    this.items.forEach((q, i) => {
      html += `<div class="exam-q">
        <div class="exam-q-head"><span class="exam-q-num">第 ${i + 1} 题</span><span class="chip">${CHAPTERS[q.ch - 1]}</span><span class="chip chip-topic">${esc(q.topic)}</span></div>
        <div class="exam-stem">${fmt(q.stem)}</div>
        ${q.img ? `<div class="q-img"><img src="${q.img}" alt="题目示意图" onerror="this.parentElement.style.display='none'"></div>` : ''}
        <div class="options">`;
      q.options.forEach((op, j) => {
        html += `<button class="option exam-opt${this.picks[i] === j ? ' selected' : ''}" data-q="${i}" data-i="${j}"><span class="opt-tag">${'ABCDEFGH'[j]}</span><span>${esc(op)}</span></button>`;
      });
      html += `</div></div>`;
    });
    $('#exam-body').innerHTML = html;
    $$('.exam-opt').forEach(b => b.addEventListener('click', () =>
      this.pick(parseInt(b.dataset.q, 10), parseInt(b.dataset.i, 10))));
  },

  pick(qIdx, i) {
    if (!this.running) return;
    this.picks[qIdx] = i;
    $('#exam-answered').textContent = `已答 ${this.picks.filter(p => p !== null).length} / ${this.items.length}`;
    $$('.exam-opt').forEach(b => {
      if (parseInt(b.dataset.q, 10) === qIdx) b.classList.toggle('selected', parseInt(b.dataset.i, 10) === i);
    });
  },

  handin() {
    const n = this.picks.filter(p => p === null).length;
    if (n && !confirm(`还有 ${n} 题未作答，确定交卷吗？`)) return;
    this.submit(false);
  },

  submit(auto) {
    if (this.submitted || !this.running) return;
    clearInterval(this.timerId);
    this.running = false; this.submitted = true;
    let right = 0, wrong = 0, blank = 0;
    this.items.forEach((q, i) => {
      const picked = this.picks[i];
      if (picked === null) { blank++; this.record(q, false); }
      else if (picked === q.answer) { right++; this.record(q, true); }
      else { wrong++; this.record(q, false); }
    });
    const score = Math.round(100 * right / this.items.length);
    const used = Math.min(this.DURATION, Math.max(0, Math.round((Date.now() - this.startTime) / 1000)));
    state.examHist.push({ ts: Date.now(), score, right, wrong, blank, total: this.items.length, used });
    if (state.examHist.length > 30) state.examHist = state.examHist.slice(-30);
    save();
    document.title = '线性代数 · 智能刷题系统';
    this.lastResult = { score, right, wrong, blank, total: this.items.length, used, auto: !!auto };
    this.resultView(this.lastResult);
  },

  record(q, ok) {
    const s = state.q[q.id] = state.q[q.id] || { r: 0, w: 0, seen: true };
    const t = state.t[topicKey(q)] = state.t[topicKey(q)] || { r: 0, w: 0 };
    s.seen = true; s.last = ok ? 'r' : 'w';
    if (ok) { s.r++; t.r++; } else { s.w++; t.w++; }
  },

  resultView(r) {
    const cls = r.score >= 85 ? 'good' : r.score >= 60 ? 'mid' : 'bad';
    const emoji = r.score >= 85 ? '🏆' : r.score >= 60 ? '✅' : '📚';
    let html = `<div class="finish-box">
      <div class="finish-emoji">${emoji}</div>
      <div class="exam-score ${cls}">${r.score}<span class="exam-score-unit">分</span></div>
      <div class="finish-line">共 <b>${r.total}</b> 题 · 答对 <b>${r.right}</b>${r.wrong ? ` · 答错 <b>${r.wrong}</b>` : ''}${r.blank ? ` · 未答 <b>${r.blank}</b>` : ''} · 用时 <b>${fmtTime(r.used)}</b>${r.auto ? '（时间到，自动交卷）' : ''}</div>
      ${r.wrong + r.blank
        ? `<div class="finish-tip">💡 答错与未答共 <b>${r.wrong + r.blank}</b> 题，已自动记入错题本，之后练习会优先出现并连带强化对应知识点。</div>`
        : `<div class="finish-tip">🎉 全部答对，继续保持！</div>`}
      <div class="finish-btns">
        <button class="btn btn-primary" onclick="exam.init()">再考一次</button>
        <button class="btn" onclick="show('wrong')">查看错题本</button>
        <button class="btn" onclick="show('home')">返回首页</button>
      </div>
    </div>
    <h3>📋 逐题复盘</h3>`;
    this.items.forEach((q, i) => {
      const picked = this.picks[i];
      const okk = picked === q.answer;
      const verdict = picked === null
        ? `<span class="chip chip-miss">未作答</span>`
        : okk ? `<span class="chip chip-ok">✓ 答对</span>` : `<span class="chip chip-no">✗ 答错</span>`;
      html += `<div class="exam-q"><div class="exam-q-head"><span class="exam-q-num">第 ${i + 1} 题</span><span class="chip">${CHAPTERS[q.ch - 1]}</span><span class="chip chip-topic">${esc(q.topic)}</span>${verdict}</div>`;
      html += `<div class="exam-stem">${fmt(q.stem)}</div><div class="fb-options">`;
      q.options.forEach((op, j) => {
        const isAns = q.answer === j, isPk = picked === j;
        html += `<div class="fb-opt ${isAns ? 'opt-right' : isPk ? 'opt-wrong' : ''}"><span class="opt-tag">${'ABCDEFGH'[j]}${isAns ? '✓' : isPk ? '✗' : ''}</span>
          <div><div class="fb-opt-text">${esc(op)}</div>
          ${(isAns || isPk) && q.exp[j] ? `<div class="fb-opt-exp">${esc(q.exp[j])}</div>` : ''}</div></div>`;
      });
      html += `</div>`;
      const rest = q.exp.filter((_, j) => q.answer !== j && picked !== j).join('　');
      if (rest) html += `<details class="fb-rest"><summary>查看其余选项解析</summary><div class="fb-opt-exp">${esc(rest)}</div></details>`;
      if (q.note) html += `<div class="fb-note">📌 ${esc(q.note)}</div>`;
      html += `</div>`;
    });
    $('#exam-body').innerHTML = html;
    $('#exam-bar').classList.add('hidden');
  },

  abort() {
    if (!this.running) return;
    clearInterval(this.timerId);
    this.running = false; this.submitted = true;
    document.title = '线性代数 · 智能刷题系统';
  }
};

// 考试进行中刷新/关闭页面时提醒
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', e => {
    if (exam.running) { e.preventDefault(); e.returnValue = ''; }
  });
}

// ---------------- 错题本 ----------------
function renderWrong() {
  const wrongQ = BANK.filter(q => (state.q[q.id] || {}).w > 0)
    .sort((a, b) => state.q[b.id].w - state.q[a.id].w);
  const wrongE = ESSAYS.filter(x => (state.e[x.id] || {}).w > 0)
    .sort((a, b) => state.e[b.id].w - state.e[a.id].w);
  const el = $('#wrong-body');
  if (!wrongQ.length && !wrongE.length) {
    el.innerHTML = `<div class="empty">暂无错题。答错的题目会自动出现在这里，并提高后续考查频率。</div>`;
    return;
  }
  let html = '';
  if (wrongQ.length) {
    html += `<h3>客观题错题（${wrongQ.length}）</h3>`;
    wrongQ.forEach(q => {
      const s = state.q[q.id];
      html += `<div class="wrong-item">
        <div class="wrong-head"><span class="chip">${CHAPTERS[q.ch - 1]}</span><span class="chip chip-topic">${esc(q.topic)}</span><span class="wrong-cnt">错 ${s.w} 次</span></div>
        <div class="wrong-stem">${fmt(q.stem)}</div>
      </div>`;
    });
  }
  if (wrongE.length) {
    html += `<h3>大题错题（${wrongE.length}）</h3>`;
    wrongE.forEach(x => {
      const s = state.e[x.id];
      html += `<div class="wrong-item">
        <div class="wrong-head"><span class="chip">${CHAPTERS[x.ch - 1]}</span><span class="chip chip-topic">${esc(x.topic)}</span><span class="wrong-cnt">错 ${s.w} 次</span></div>
        <div class="wrong-stem">${esc(x.title)}</div>
      </div>`;
    });
  }
  html += `<div class="finish-btns">
    <button class="btn btn-primary" onclick="quiz.init('wrong',0,0);show('quiz')">开始错题强化</button>
    <button class="btn btn-bad" id="btn-clear-wrong">清空错题记录</button>
  </div>`;
  el.innerHTML = html;
  $('#btn-clear-wrong').addEventListener('click', () => {
    if (!confirm('确定清空所有错题记录？（不影响已答对/错的历史统计）')) return;
    Object.values(state.q).forEach(s => s.w = 0);
    Object.values(state.e).forEach(s => s.w = 0);
    Object.values(state.t).forEach(s => s.w = 0);
    save(); renderWrong();
  });
}

// ---------------- 统计 ----------------
function renderStats() {
  const el = $('#stats-body');
  let html = '';
  const totalQ = Object.values(state.q).reduce((a, s) => a + s.r + s.w, 0);
  const totalE = Object.values(state.e).reduce((a, s) => a + s.r + s.w, 0);
  const right = Object.values(state.q).reduce((a, s) => a + s.r, 0) + Object.values(state.e).reduce((a, s) => a + s.r, 0);
  html += `<div class="stat-cards">
    <div class="stat-card"><div class="stat-num">${totalQ + totalE}</div><div>累计答题</div></div>
    <div class="stat-card"><div class="stat-num">${totalQ + totalE ? Math.round(100 * right / (totalQ + totalE)) : '-'}%</div><div>总正确率</div></div>
    <div class="stat-card"><div class="stat-num">${Object.values(state.q).filter(s => s.w > 0).length + Object.values(state.e).filter(s => s.w > 0).length}</div><div>错题数</div></div>
  </div>`;

  html += `<h3>各章正确率</h3><div class="stat-list">`;
  CHAPTERS.forEach((name, i) => {
    let r = 0, w = 0;
    BANK.filter(q => q.ch === i + 1).forEach(q => { const s = state.q[q.id]; if (s) { r += s.r; w += s.w; } });
    ESSAYS.filter(x => x.ch === i + 1).forEach(x => { const s = state.e[x.id]; if (s) { r += s.r; w += s.w; } });
    const pct = r + w ? Math.round(100 * r / (r + w)) : null;
    html += `<div class="stat-row">
      <span class="stat-label">${esc(name)}</span>
      <span class="stat-bar-wrap"><span class="stat-bar ${pct === null ? 'bar-empty' : pct < 60 ? 'bar-red' : pct < 85 ? 'bar-yellow' : 'bar-green'}" style="width:${pct === null ? 0 : pct}%"></span></span>
      <span class="stat-val">${pct === null ? '未作答' : pct + '%（' + r + '/' + (r + w) + '）'}</span>
    </div>`;
  });
  html += `</div>`;

  const topics = Object.entries(state.t).filter(([, v]) => v.r + v.w >= 2 && v.w > 0)
    .sort((a, b) => (b[1].w / (b[1].r + b[1].w)) - (a[1].w / (a[1].r + a[1].w))).slice(0, 8);
  if (topics.length) {
    html += `<h3>薄弱知识点 TOP ${topics.length}</h3><div class="stat-list">`;
    topics.forEach(([key, v]) => {
      const [ch, topic] = key.split('|');
      const pct = Math.round(100 * v.w / (v.r + v.w));
      html += `<div class="stat-row">
        <span class="stat-label">${CHAPTERS[parseInt(ch, 10) - 1].replace(/^第\d+章 /, '')} · ${esc(topic)}</span>
        <span class="stat-bar-wrap"><span class="stat-bar bar-red" style="width:${pct}%"></span></span>
        <span class="stat-val">错 ${v.w} / 共 ${v.r + v.w}</span>
      </div>`;
    });
    html += `</div>`;
  }

  if (state.examHist.length) {
    html += `<h3>模拟考试记录（最近 ${Math.min(10, state.examHist.length)} 次）</h3><div class="stat-list">`;
    state.examHist.slice().reverse().slice(0, 10).forEach(h => {
      const d = new Date(h.ts);
      const pad = n => String(n).padStart(2, '0');
      html += `<div class="stat-row">
        <span class="stat-label">${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())} · 用时 ${fmtTime(h.used)}</span>
        <span class="stat-bar-wrap"><span class="stat-bar ${h.score < 60 ? 'bar-red' : h.score < 85 ? 'bar-yellow' : 'bar-green'}" style="width:${h.score}%"></span></span>
        <span class="stat-val">${h.score} 分（${h.right}/${h.total}）</span>
      </div>`;
    });
    html += `</div>`;
  }

  html += `<h3>数据管理</h3><div class="finish-btns">
    <button class="btn" id="btn-export">导出进度（备份）</button>
    <button class="btn" id="btn-import">导入进度</button>
    <button class="btn btn-bad" id="btn-reset">清空全部记录</button>
    <input type="file" id="import-file" accept=".json" class="hidden">
  </div><div class="stat-note">进度保存在本浏览器 localStorage 中；换电脑或清理浏览器前请先导出备份。</div>`;
  el.innerHTML = html;

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '线性代数刷题进度备份.json';
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.q) { state = data; save(); alert('导入成功'); renderStats(); }
        else alert('文件格式不正确');
      } catch (err) { alert('解析失败：' + err.message); }
    };
    reader.readAsText(f);
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('确定清空全部答题记录？此操作不可恢复（建议先导出备份）')) return;
    state = defaultState(); save(); renderStats();
  });
}

// ---------------- 启动 ----------------
document.addEventListener('DOMContentLoaded', () => {
  $$('nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.page)));
  chapterOptions($('#chapter-select'), state.settings.chapter);
  $('#count-select').value = state.settings.count || 10;
  $('#chapter-select').addEventListener('change', e => { state.settings.chapter = parseInt(e.target.value, 10); save(); });
  $('#count-select').addEventListener('change', e => { state.settings.count = parseInt(e.target.value, 10); save(); });
  show('home');
});
