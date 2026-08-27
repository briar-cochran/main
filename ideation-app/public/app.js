/* Idea Ranker — vanilla JS client.
   Two modes:
   - Admin (/):      list + create sessions, share client links. Optionally
                     gated by an ADMIN_KEY (sent as x-admin-key).
   - Client (/r/:id) one session only — rank, explain, done. */

const $ = (sel) => document.querySelector(sel);

const CLIENT_MODE = location.pathname.startsWith('/r/');
const CLIENT_SESSION_ID = CLIENT_MODE ? location.pathname.split('/')[2] : null;

// On a client link, hide the admin home immediately — it is the default
// visible view in the markup and would otherwise flash (and be interactive)
// until the session fetch resolves.
if (CLIENT_MODE) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.body.insertAdjacentHTML('beforeend', '<p id="client-loading" style="padding:40px;text-align:center;color:#9aa1b5">Loading your ideas…</p>');
}

// ---------- API ----------

function adminHeaders() {
  const key = localStorage.getItem('adminKey');
  return key ? { 'x-admin-key': key } : {};
}

async function adminFetch(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...adminHeaders() };
  let res = await fetch(url, opts);
  if (res.status === 401) {
    const key = prompt('Admin key:');
    if (key) {
      localStorage.setItem('adminKey', key);
      opts.headers = { ...(opts.headers || {}), ...adminHeaders() };
      res = await fetch(url, opts);
    }
  }
  return res;
}

const api = {
  listSessions: () => adminFetch('/api/sessions').then((r) => (r.ok ? r.json() : [])),
  createSession: (body) =>
    adminFetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()),
  getSession: (id) => fetch(`/api/sessions/${id}`).then((r) => r.json()),
  generateBatch: (id) => fetch(`/api/sessions/${id}/generate-batch`, { method: 'POST' }).then((r) => r.json()),
  rate: (sid, iid, rating) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating }) }),
  reason: (sid, iid, transcript, inputMethod) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/reason`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, inputMethod }) }),
  audio: (sid, iid, blob) =>
    fetch(`/api/sessions/${sid}/ideas/${iid}/audio`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob }),
};

// ---------- Persistence queue ----------
// Every catalog write (rating, reason, audio) goes through one serial queue:
// writes never race each other client-side (the server does whole-document
// read-modify-write saves, so two in-flight writes could drop each other's
// field), failures retry with backoff instead of being silently swallowed,
// and the indicator shows when anything is still unsaved.

let pendingSaves = 0;
let saveFailing = false;
let writeChain = Promise.resolve();

function updateSaveStatus() {
  const el = $('#save-status');
  if (!el) return;
  if (pendingSaves === 0) {
    el.classList.add('hidden');
  } else {
    el.classList.remove('hidden');
    el.textContent = saveFailing ? '⚠ connection trouble — retrying…' : 'Saving…';
    el.classList.toggle('failing', saveFailing);
  }
}

// Retrying helps for network errors, 5xx, and throttle/timeout statuses;
// any other 4xx means the request itself is bad and will never succeed.
const retryable = (status) => status >= 500 || status === 408 || status === 429;

function persist(label, fn) {
  pendingSaves++;
  updateSaveStatus();
  writeChain = writeChain.then(async () => {
    let delay = 2000;
    for (;;) {
      try {
        const res = await fn();
        if (res.ok) break;
        if (!retryable(res.status)) {
          console.warn(`${label} rejected (${res.status})`);
          flashStatus(`⚠ ${label} was rejected — not saved`);
          break;
        }
      } catch (_) {
        /* network error — retry */
      }
      saveFailing = true;
      updateSaveStatus();
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
    saveFailing = false;
    pendingSaves--;
    updateSaveStatus();
    // The done screen waits for the queue to drain before claiming "all done".
    if (pendingSaves === 0) maybeDone();
  });
  return writeChain;
}

// Transient warning in the same pill (auto-clears back to queue state).
let flashTimer = null;
function flashStatus(msg) {
  const el = $('#save-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('failing');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.classList.remove('failing');
    updateSaveStatus();
  }, 4000);
}

// Queued writes are in-memory only — warn before the tab discards them.
window.addEventListener('beforeunload', (e) => {
  if (pendingSaves > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

const RATING_META = {
  love: { emoji: '❤️', label: 'LOVE', color: '#ff4d6d' },
  like: { emoji: '👍', label: 'LIKE', color: '#3ecf8e' },
  dislike: { emoji: '👎', label: 'DISLIKE', color: '#f5a623' },
  hate: { emoji: '🤮', label: 'HATE', color: '#9aa1b5' },
};

let state = {
  session: null,
  queue: [],          // unrated ideas, in order
  current: null,      // idea being rated / explained
  pumping: false,     // generation loop active
  voiceUsed: false,
};

// ---------- Views ----------

function show(viewId) {
  const loading = $('#client-loading');
  if (loading) loading.remove();
  ['view-home', 'view-rank', 'view-done'].forEach((id) => $('#' + id).classList.add('hidden'));
  $('#' + viewId).classList.remove('hidden');
}

// ---------- Home (admin) ----------

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
      <div class="session-actions">
        <button class="ghost copy-link" title="Copy client link">🔗</button>
        <span class="go">→</span>
      </div>`;
    el.querySelector('.copy-link').onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(`${location.origin}/r/${s.id}`);
      e.target.textContent = '✓';
      setTimeout(() => (e.target.textContent = '🔗'), 1200);
    };
    el.onclick = () => openSession(s.id);
    list.appendChild(el);
  }
}

$('#btn-create').onclick = async () => {
  const clientName = $('#client-name').value.trim();
  const clientSlug = $('#client-slug').value.trim();
  const brief = $('#client-brief').value.trim();
  const count = Number($('#idea-count').value) || 100;
  if (!clientName) return alert('Client name is required.');
  if (!brief) return alert('Add a brief — the ideas are only as good as the context.');

  $('#btn-create').disabled = true;
  try {
    const session = await api.createSession({ clientName, clientSlug, brief, target: count });
    if (session.error) return alert(session.error);
    await openSession(session.id);
  } finally {
    $('#btn-create').disabled = false;
  }
};

const backBtn = $('#btn-back');
if (CLIENT_MODE) backBtn.classList.add('hidden');
backBtn.onclick = () => renderHome();
$('#btn-done-home').onclick = () => (CLIENT_MODE ? show('view-done') : renderHome());

$('#btn-share').onclick = () => {
  navigator.clipboard.writeText(`${location.origin}/r/${state.session.id}`);
  $('#btn-share').textContent = '✓';
  setTimeout(() => ($('#btn-share').textContent = '🔗'), 1200);
};

// ---------- Ranking ----------

async function openSession(id) {
  state.session = await api.getSession(id);
  if (state.session.error) {
    document.body.innerHTML = '<p style="padding:40px;text-align:center;color:#9aa1b5">Session not found — check the link.</p>';
    return;
  }
  state.queue = state.session.ideas.filter((i) => !i.rating);
  show('view-rank');
  if (CLIENT_MODE) backBtn.classList.add('hidden');
  renderProgress();
  renderStack();
  pumpGeneration();
  maybeDone();
}

function renderProgress() {
  const total = Math.max(state.session.ideas.length, state.session.generation.target || 0);
  const rated = state.session.ideas.filter((i) => i.rating).length;
  $('#progress-fill').style.width = total ? `${(rated / total) * 100}%` : '0%';
  $('#progress-label').textContent = `${rated} / ${total}`;
  const g = state.session.generation;
  const el = $('#gen-status');
  const failed = g.status === 'error' && state.session.ideas.length < g.target;
  el.textContent = g.status === 'running' ? `✨ ${g.generated}/${g.target}` : failed ? '⚠ gen failed — tap to retry' : '';
  el.classList.toggle('retry', failed);
}

// The server treats an 'error' generation as resumable: the next
// generate-batch call simply retries. This is the UI for that.
$('#gen-status').onclick = () => {
  if (!state.session || state.session.generation.status !== 'error') return;
  state.session.generation.status = 'running';
  renderProgress();
  pumpGeneration();
};

function renderStack() {
  const stack = $('#card-stack');
  stack.innerHTML = '';
  const [top, under] = state.queue;
  if (under) stack.appendChild(buildCard(under, 'under'));
  if (top) stack.appendChild(buildCard(top, 'top'));
  if (!top && state.session.generation.status === 'running') {
    stack.innerHTML = '<div class="idea-card top" style="align-items:center;justify-content:center"><p style="color:var(--muted)">Generating more ideas…</p></div>';
  } else if (!top && state.session.generation.status === 'error' && state.session.ideas.length < (state.session.generation.target || 0)) {
    stack.innerHTML = '<div class="idea-card top" style="align-items:center;justify-content:center"><p style="color:var(--muted)">Idea generation hit a snag — tap “retry” above to continue.</p></div>';
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
  idea.rating = rating; // optimistic — the queue retries until it lands
  // Capture the session id NOW: state.session may point at a different
  // session by the time a retried write actually runs (admin switching decks).
  const sid = state.session.id;
  persist('rating', () => api.rate(sid, idea.id, rating));
  renderProgress();
  openReasonOverlay(rating);
}

// ---------- Voice reason ----------

let recognition = null;
let mediaRecorder = null;
let audioChunks = [];
let audioBlob = null;
let recorderTimer = null;

// Bound the memo length ("1-3 sentences") so an overlay left open doesn't
// record indefinitely and blow past the upload size cap.
const MAX_RECORD_MS = 180_000;

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
    recorderTimer = setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mic.classList.remove('recording');
        $('#mic-status').textContent = 'Recording stopped (max length) — you can still edit the text.';
      }
    }, MAX_RECORD_MS);
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
    if (recorderTimer) { clearTimeout(recorderTimer); recorderTimer = null; }
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

// Vercel rejects serverless request bodies over ~4.5MB, and the server caps
// audio at 4mb to match. Speech-only opus is ~24kbps, so this only trips on
// something pathological — in which case we keep the transcript and drop the
// blob rather than failing the whole save.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

$('#btn-save-reason').onclick = async () => {
  await stopCapture();
  const { idea } = state.current;
  const sid = state.session.id;
  const transcript = $('#reason-text').value.trim();
  const method = transcript ? (state.voiceUsed ? 'voice' : 'typed') : 'skipped';
  const blob = audioBlob && audioBlob.size > 0 && audioBlob.size <= MAX_AUDIO_BYTES ? audioBlob : null;
  if (audioBlob && audioBlob.size > MAX_AUDIO_BYTES) flashStatus('⚠ voice memo too large to upload — text kept');

  // One queue entry for the pair, audio strictly before reason: the reason
  // handler preserves an existing audioFile, so this order can't lose either
  // half — firing both at once could (whole-document saves race server-side).
  persist('reason', async () => {
    if (blob) {
      const ra = await api.audio(sid, idea.id, blob);
      // Throw on retryable failures so the whole pair retries; on a permanent
      // rejection keep the transcript but tell the user the audio was dropped.
      if (!ra.ok && retryable(ra.status)) throw new Error(`audio upload ${ra.status}`);
      if (!ra.ok) {
        console.warn(`audio upload rejected (${ra.status})`);
        flashStatus('⚠ voice memo not saved — text kept');
      }
    }
    return api.reason(sid, idea.id, transcript, method);
  });
  closeReasonAndAdvance();
};

$('#btn-skip-reason').onclick = async () => {
  await stopCapture();
  const { idea } = state.current;
  const sid = state.session.id;
  persist('reason', () => api.reason(sid, idea.id, '', 'skipped'));
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

// ---------- Generation pump ----------
// Whichever browser has the session open drives generation: one batch per
// request until the target is reached. Serverless-friendly — no long-running
// job on the server.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull ideas another tab's pump has generated into our local state.
async function refreshSessionIdeas() {
  const latest = await api.getSession(state.session.id);
  if (latest.error) return;
  const known = new Set(state.session.ideas.map((i) => i.id));
  for (const idea of latest.ideas) {
    if (!known.has(idea.id)) {
      state.session.ideas.push(idea);
      if (!idea.rating) state.queue.push(idea);
    }
  }
  state.session.generation = latest.generation;
}

async function pumpGeneration() {
  if (state.pumping || state.session.generation.status !== 'running') return;
  state.pumping = true;
  let noProgress = 0;
  let netFails = 0;
  try {
    while (state.session && state.session.generation.status === 'running') {
      let result;
      try {
        result = await api.generateBatch(state.session.id);
        netFails = 0;
      } catch (_) {
        // A lost response may hide a batch the server DID commit — refresh so
        // those ideas aren't stranded unrated. Cap the retries: an endless
        // silent loop against a broken server helps nobody.
        if (++netFails >= 5) {
          state.session.generation.status = 'error';
          renderProgress();
          break;
        }
        await sleep(5000);
        try {
          await refreshSessionIdeas();
          renderProgress();
          if (!$('#card-stack .idea-card.top') && !state.current) renderStack();
        } catch (_) {}
        continue;
      }
      if (result.error) {
        state.session.generation.status = 'error';
        renderProgress();
        break;
      }
      // Another tab holds the batch claim — wait, then pick up its ideas.
      if (result.busy) {
        await sleep(5000);
        try { await refreshSessionIdeas(); } catch (_) {}
        renderProgress();
        if (!$('#card-stack .idea-card.top') && !state.current) renderStack();
        if (state.session.generation.status === 'done') break;
        continue;
      }
      state.session.generation = result.generation;
      const fresh = (result.newIdeas || []).filter((idea) => !state.session.ideas.some((i) => i.id === idea.id));
      for (const idea of fresh) {
        state.session.ideas.push(idea);
        state.queue.push(idea);
      }
      // Backstop against a pathological server loop: batches that add nothing
      // but keep reporting 'running' should not spin (and spend) forever.
      if (!result.done && fresh.length === 0) {
        if (++noProgress >= 3) {
          state.session.generation.status = 'error';
          renderProgress();
          break;
        }
        await sleep(2000);
      } else {
        noProgress = 0;
      }
      renderProgress();
      if (!$('#card-stack .idea-card.top') && !state.current) renderStack();
      if (result.done) break;
    }
  } finally {
    state.pumping = false;
    maybeDone();
  }
}

// ---------- Done ----------

function maybeDone() {
  if (!state.session) return;
  if (state.queue.length > 0 || state.current) return;
  if (state.session.generation.status === 'running') return; // more coming
  // A failed generation with ideas still owed is NOT done — leaving the rank
  // view keeps the tap-to-retry control reachable.
  if (state.session.generation.status === 'error' && state.session.ideas.length < (state.session.generation.target || 0)) return;
  // Don't claim "all done" while writes are still queued/retrying — persist()
  // re-calls this when the queue drains.
  if (pendingSaves > 0) return;
  if (state.session.ideas.length === 0) return;
  const counts = { love: 0, like: 0, dislike: 0, hate: 0 };
  state.session.ideas.forEach((i) => { if (counts[i.rating] !== undefined) counts[i.rating]++; });
  const n = state.session.ideas.length;
  const nIdeas = `${n} idea${n === 1 ? '' : 's'}`;
  $('#done-summary').textContent = CLIENT_MODE
    ? `You ranked ${nIdeas}. Thank you — this shapes everything we make for you next.`
    : `${state.session.clientName} ranked ${nIdeas}.`;
  $('#done-counts').innerHTML = Object.entries(counts)
    .map(([k, v]) => `<div><b>${v}</b>${RATING_META[k].emoji} ${k}</div>`).join('');
  const exportLink = $('#export-link');
  const jsonlLink = $('#export-jsonl-link');
  if (CLIENT_MODE) {
    exportLink.classList.add('hidden');
    jsonlLink.classList.add('hidden');
    $('#btn-done-home').classList.add('hidden');
  } else {
    // Exports are admin-gated and the key must never appear in a URL (history,
    // logs, Referer) — download via fetch with the header, then a blob link.
    const slug = state.session.clientSlug || state.session.clientName.toLowerCase().replace(/\s+/g, '-');
    exportLink.href = '#';
    jsonlLink.href = '#';
    exportLink.onclick = (e) => { e.preventDefault(); downloadExport(`/api/sessions/${state.session.id}/export`, `${slug}-catalog.json`); };
    jsonlLink.onclick = (e) => { e.preventDefault(); downloadExport(`/api/sessions/${state.session.id}/export.jsonl`, `${slug}-ideation-feedback.jsonl`); };
  }
  show('view-done');
}

async function downloadExport(path, filename) {
  const res = await adminFetch(path);
  if (!res.ok) return alert(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- Util ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (CLIENT_MODE) {
  openSession(CLIENT_SESSION_ID);
} else {
  renderHome();
}
