/* Idea Ranker — vanilla JS client */

const $ = (sel) => document.querySelector(sel);
const api = {
  listSessions: () => fetch('/api/sessions').then((r) => r.json()),
  createSession: (body) =>
    fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  getSession: (id) => fetch(`/api/sessions/${id}`).then((r) => r.json()),
  generate: (id, count) =>
    fetch(`/api/sessions/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count }) }),
  rate: (sid, iid, rating) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating }) }),
  reason: (sid, iid, transcript, inputMethod) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/reason`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, inputMethod }) }),
  audio: (sid, iid, blob) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/audio`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob }),
};

const RATING_META = {
  love: { emoji: '❤️', label: 'LOVE', color: '#ff4d6d' },
  like: { emoji: '👍', label: 'LIKE', color: '#3ecf8e' },
  dislike: { emoji: '👎', label: 'DISLIKE', color: '#f5a623' },
  hate: { emoji: '🤮', label: 'HATE', color: '#9aa1b5' },
};

let state = {
  session: null,     // full session object
  queue: [],         // unrated ideas, in order
  current: null,     // idea being rated / explained
  pollTimer: null,
  voiceUsed: false,  // whether dictation produced the transcript
};

// ---------- Views ----------

function show(viewId) {
  ['view-home', 'view-rank', 'view-done'].forEach((id) => $('#' + id).classList.add('hidden'));
  $('#' + viewId).classList.remove('hidden');
}

// ---------- Home ----------

async function renderHome() {
  show('view-home');
  const sessions = await api.listSessions();
  const list = $('#session-list');
  list.innerHTML = sessions.length ? '<h2 style="font-size:15px;margin:4px 0 10px;color:var(--muted)">Sessions</h2>' : '';
  for (const s of sessions) {
    const el = document.createElement('div');
    el.className = 'session-item';
    const gen = s.generation.status === 'running' ? ` · generating ${s.generation.generated}/${s.generation.target}` : '';
    el.innerHTML = `<div><strong>${escapeHtml(s.clientName)}</strong>
      <div class="meta">${s.rated}/${s.total} rated${gen} · ${new Date(s.createdAt).toLocaleDateString()}</div></div>
      <span class="go">→</span>`;
    el.onclick = () => openSession(s.id);
    list.appendChild(el);
  }
}

$('#btn-create').onclick = async () => {
  const clientName = $('#client-name').value.trim();
  const brief = $('#client-brief').value.trim();
  const count = Number($('#idea-count').value) || 100;
  if (!clientName) return alert('Client name is required.');
  if (!brief) return alert('Add a brief — the ideas are only as good as the context.');

  $('#btn-create').disabled = true;
  try {
    const session = await api.createSession({ clientName, brief });
    await api.generate(session.id, count);
    await openSession(session.id);
  } finally {
    $('#btn-create').disabled = false;
  }
};

$('#btn-back').onclick = () => { stopPolling(); renderHome(); };
$('#btn-done-home').onclick = () => renderHome();

// ---------- Ranking ----------

async function openSession(id) {
  state.session = await api.getSession(id);
  state.queue = state.session.ideas.filter((i) => !i.rating);
  show('view-rank');
  renderProgress();
  renderStack();
  startPollingIfGenerating();
  maybeDone();
}

function renderProgress() {
  const total = state.session.ideas.length;
  const rated = state.session.ideas.filter((i) => i.rating).length;
  $('#progress-fill').style.width = total ? `${(rated / total) * 100}%` : '0%';
  $('#progress-label').textContent = `${rated} / ${total}`;
  const g = state.session.generation;
  $('#gen-status').textContent = g.status === 'running' ? `✨ ${g.generated}/${g.target}` : g.status === 'error' ? '⚠ gen failed' : '';
}

function renderStack() {
  const stack = $('#card-stack');
  stack.innerHTML = '';
  const [top, under] = state.queue;
  if (under) stack.appendChild(buildCard(under, 'under'));
  if (top) stack.appendChild(buildCard(top, 'top'));
  if (!top && state.session.generation.status === 'running') {
    stack.innerHTML = '<div class="idea-card top" style="align-items:center;justify-content:center"><p style="color:var(--muted)">Generating more ideas…</p></div>';
  }
}

function buildCard(idea, layer) {
  const el = document.createElement('div');
  el.className = `idea-card ${layer}`;
  el.innerHTML = `
    <div class="swipe-badge"></div>
    <div class="angle">${escapeHtml(idea.angle)}</div>
    <h3>${escapeHtml(idea.title)}</h3>
    <p class="hook">${escapeHtml(idea.hook)}</p>
    ${idea.format ? `<div class="format">${escapeHtml(idea.format)}</div>` : ''}`;
  if (layer === 'top') attachSwipe(el);
  return el;
}

// Swipe: right=love, up=like, down=dislike, left=hate
function attachSwipe(el) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
  const badge = el.querySelector('.swipe-badge');

  const dirFor = () => {
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'love' : 'hate') : (dy < 0 ? 'like' : 'dislike');
  };

  el.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startY = e.clientY;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX; dy = e.clientY - startY;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const dir = dirFor();
    if (dir) {
      const m = RATING_META[dir];
      badge.textContent = `${m.emoji} ${m.label}`;
      badge.style.color = m.color;
      badge.style.borderColor = m.color;
      badge.style.opacity = Math.min(1, (Math.max(Math.abs(dx), Math.abs(dy)) - 40) / 80);
    } else {
      badge.style.opacity = 0;
    }
  });
  el.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const dir = (Math.abs(dx) > 110 || Math.abs(dy) > 110) ? dirFor() : null;
    if (dir) {
      flyOut(el, dx, dy);
      rateCurrent(dir);
    } else {
      el.style.transition = '';
      el.style.transform = '';
      badge.style.opacity = 0;
    }
    dx = dy = 0;
  });
}

function flyOut(el, dx, dy) {
  el.classList.add('flyout');
  const fx = dx === 0 && dy === 0 ? 0 : dx * 4;
  const fy = dx === 0 && dy === 0 ? -600 : dy * 4;
  el.style.transform = `translate(${fx}px, ${fy}px) rotate(${fx / 18}deg)`;
}

document.querySelectorAll('.rate').forEach((btn) => {
  btn.onclick = () => {
    const top = $('#card-stack .idea-card.top');
    if (top) {
      const dirs = { love: [500, 0], like: [0, -600], dislike: [0, 600], hate: [-500, 0] };
      const [fx, fy] = dirs[btn.dataset.rating];
      top.classList.add('flyout');
      top.style.transform = `translate(${fx}px, ${fy}px) rotate(${fx / 18}deg)`;
    }
    rateCurrent(btn.dataset.rating);
  };
});

document.addEventListener('keydown', (e) => {
  if (!$('#view-rank').classList.contains('hidden') && $('#reason-overlay').classList.contains('hidden')) {
    const map = { 1: 'hate', 2: 'dislike', 3: 'like', 4: 'love' };
    if (map[e.key]) $(`.rate.${map[e.key]}`).click();
  }
});

async function rateCurrent(rating) {
  const idea = state.queue[0];
  if (!idea || state.current) return;
  state.current = { idea, rating };
  idea.rating = rating; // optimistic
  api.rate(state.session.id, idea.id, rating).catch(() => {});
  renderProgress();
  openReasonOverlay(rating);
}

// ---------- Voice reason ----------

let recognition = null;
let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;

function openReasonOverlay(rating) {
  const m = RATING_META[rating];
  const chip = $('#reason-rating-chip');
  chip.textContent = `${m.emoji} ${m.label}`;
  chip.className = `chip ${rating}`;
  $('#reason-text').value = '';
  $('#mic-status').textContent = 'Starting microphone…';
  state.voiceUsed = false;
  audioBlob = null;
  $('#reason-overlay').classList.remove('hidden');
  startCapture();
}

async function startCapture() {
  const mic = $('#mic-visual');

  // 1. Audio recording (saved to the catalog)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      audioBlob = audioChunks.length ? new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' }) : null;
      stream.getTracks().forEach((t) => t.stop());
    };
    mediaRecorder.start();
    mic.classList.add('recording');
    $('#mic-status').textContent = 'Listening… speak now';
  } catch (err) {
    $('#mic-status').textContent = 'Mic unavailable — type your reason instead.';
    $('#reason-text').focus();
  }

  // 2. Live dictation (Chrome/Safari; graceful fallback to typing elsewhere)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    let finalText = '';
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      $('#reason-text').value = (finalText + interim).trim();
      state.voiceUsed = true;
    };
    recognition.onerror = () => {};
    try { recognition.start(); } catch (_) {}
  }
}

function stopCapture() {
  return new Promise((resolve) => {
    if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
    $('#mic-visual').classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      const mr = mediaRecorder;
      mr.addEventListener('stop', () => resolve(), { once: true });
      mr.stop();
    } else {
      resolve();
    }
    mediaRecorder = null;
  });
}

$('#btn-save-reason').onclick = async () => {
  await stopCapture();
  const { idea } = state.current;
  const transcript = $('#reason-text').value.trim();
  const method = transcript ? (state.voiceUsed ? 'voice' : 'typed') : 'skipped';
  api.reason(state.session.id, idea.id, transcript, method).catch(() => {});
  if (audioBlob && audioBlob.size > 0) api.audio(state.session.id, idea.id, audioBlob).catch(() => {});
  closeReasonAndAdvance();
};

$('#btn-skip-reason').onclick = async () => {
  await stopCapture();
  const { idea } = state.current;
  api.reason(state.session.id, idea.id, '', 'skipped').catch(() => {});
  closeReasonAndAdvance();
};

function closeReasonAndAdvance() {
  $('#reason-overlay').classList.add('hidden');
  state.queue.shift();
  state.current = null;
  renderStack();
  renderProgress();
  maybeDone();
}

// ---------- Generation polling ----------

function startPollingIfGenerating() {
  stopPolling();
  if (state.session.generation.status !== 'running') return;
  state.pollTimer = setInterval(async () => {
    const fresh = await api.getSession(state.session.id);
    const known = new Set(state.session.ideas.map((i) => i.id));
    for (const idea of fresh.ideas) {
      if (!known.has(idea.id)) state.queue.push(idea);
    }
    // keep local rating state; adopt fresh idea list + generation status
    const ratedLocal = new Map(state.session.ideas.map((i) => [i.id, i.rating]));
    fresh.ideas.forEach((i) => { if (ratedLocal.get(i.id)) i.rating = ratedLocal.get(i.id); });
    state.session = fresh;
    renderProgress();
    if (!$('#card-stack .idea-card.top') && !state.current) renderStack();
    if (fresh.generation.status !== 'running') stopPolling();
  }, 4000);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ---------- Done ----------

function maybeDone() {
  if (state.queue.length > 0 || state.current) return;
  if (state.session.generation.status === 'running') return; // more coming
  if (state.session.ideas.length === 0) return;
  stopPolling();
  const counts = { love: 0, like: 0, dislike: 0, hate: 0 };
  state.session.ideas.forEach((i) => { if (counts[i.rating] !== undefined) counts[i.rating]++; });
  $('#done-summary').textContent = `${state.session.clientName} ranked ${state.session.ideas.length} ideas.`;
  $('#done-counts').innerHTML = Object.entries(counts)
    .map(([k, v]) => `<div><b>${v}</b>${RATING_META[k].emoji} ${k}</div>`).join('');
  $('#export-link').href = `/api/sessions/${state.session.id}/export`;
  show('view-done');
}

// ---------- Util ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

renderHome();
