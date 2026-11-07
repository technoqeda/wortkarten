// Wortkarten: same rules as the iOS version.
const MAX_ATTEMPTS = 5;
const SAVE_KEY = 'wortkarten.state.v1';
const $ = id => document.getElementById(id);

// Only technical differences are ignored: extra spaces, final . ! ? …,
// typographic apostrophes and dashes. Case, articles, umlauts, ß stay strict.
function normalize(s) {
  let t = s.replace(/[\u2019\u2018\u02BC\u00B4]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ');
  t = t.trim().split(/\s+/).join(' ');
  while (t && '.!?… '.includes(t[t.length - 1])) t = t.slice(0, -1);
  return t.trim();
}

let cards = [], byId = {}, deIndex = {}, enIndex = {};
const enKey = (e, hint) => normalize(e) + '|' + (hint || '');

function buildDeck(list) {
  cards = list;
  for (const c of cards) {
    byId[c.id] = c;
    for (const d of c.de) (deIndex[normalize(d)] ||= []).push(c.id);
    for (const e of c.en) (enIndex[enKey(e, c.hint)] ||= []).push(c.id);
  }
}

// Accepted answers: the card's own variants plus variants of every card with the same prompt.
function accepted(card, dir) {
  const ids = new Set(dir === 'enToDe'
    ? (enIndex[enKey(card.en[0], card.hint)] || []) : (deIndex[normalize(card.de[0])] || []));
  ids.add(card.id);
  const res = new Set();
  for (const id of ids) for (const a of (dir === 'enToDe' ? byId[id].de : byId[id].en)) res.add(normalize(a));
  return res;
}
const isCorrect = (input, card, dir) => accepted(card, dir).has(normalize(input));
const prompt = (card, dir) => dir === 'enToDe' ? card.en[0] : card.de[0];
const answer = (card, dir) => dir === 'enToDe' ? card.de[0] : card.en[0];

// ---- Progress ----
let state = { progress: {}, pending: [], step: 0 };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) state = s; } catch {}
const save = () => localStorage.setItem(SAVE_KEY, JSON.stringify(state));
const prog = id => state.progress[id] || { seen: 0, streak: 0, mistakes: 0, learned: false };
const learnedCount = () => cards.filter(c => prog(c.id).learned).length;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
let lastCardId = null, fromPending = false;

function nextCard() {
  state.step += 1;
  const dir = Math.random() < 0.5 ? 'enToDe' : 'deToEn';
  const pick = (id, pending = false) => { lastCardId = id; fromPending = pending; return [byId[id], dir]; };

  // 1. A card that was answered wrong and is due again.
  const i = state.pending.findIndex(p => p.dueStep <= state.step && p.cardId !== lastCardId);
  if (i >= 0) return pick(state.pending.splice(i, 1)[0].cardId, true);

  const unseen = cards.filter(c => prog(c.id).seen === 0);
  const seen = cards.filter(c => prog(c.id).seen > 0 && c.id !== lastCardId);

  // 2. Mostly new cards, sometimes a repeat.
  if (unseen.length && (!seen.length || Math.random() < 0.75))
    return pick(unseen[Math.floor(Math.random() * unseen.length)].id);

  // 3. Weighted repeat: not yet learned cards come up more often.
  const pool = seen.length ? seen : cards;
  const w = pool.map(c => { const p = prog(c.id); return p.learned ? 1 : 4 + Math.min(p.mistakes, 4); });
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < pool.length; k++) { r -= w[k]; if (r < 0) return pick(pool[k].id); }
  return pick(pool[pool.length - 1].id);
}

function record(id, firstTry) {
  const p = prog(id);
  p.seen += 1;
  state.pending = state.pending.filter(x => x.cardId !== id);
  const schedule = n => state.pending.push({ cardId: id, dueStep: state.step + n });
  if (firstTry) {
    p.streak += 1;
    if (p.streak >= 2 || (p.mistakes === 0 && p.streak >= 1)) p.learned = true;
    else schedule(randInt(15, 25));
  } else {
    p.streak = 0; p.mistakes += 1; p.learned = false;
    schedule(randInt(4, 8));
  }
  state.progress[id] = p;
  save();
}

// ---- Screens ----
let card, dir, phase, left, hadMistake;
const input = $('answer');

function showHome() {
  $('study').hidden = true; $('home').hidden = false;
  $('learned').textContent = `Learned: ${learnedCount()} of ${cards.length}`;
}

function showStudy() {
  $('home').hidden = true; $('study').hidden = false;
  next();
}

function setMsg(text, color) {
  $('msg').hidden = !text; $('msg').textContent = text; $('msg').className = 'msg ' + (color || '');
}

function next() {
  [card, dir] = nextCard();
  phase = 'answering'; left = MAX_ATTEMPTS; hadMistake = false;
  $('dir').textContent = dir === 'enToDe' ? 'Translate into German' : 'Translate into English';
  $('prompt').textContent = prompt(card, dir);
  const showHint = dir === 'enToDe' && card.hint;
  $('hint').hidden = !showHint; $('hint').textContent = showHint ? `(${card.hint})` : '';
  input.value = '';
  setMsg('');
  $('action').textContent = 'Check'; $('action').classList.remove('ok');
  $('skip').hidden = false;
  input.focus();
}

// Skip: go to the next card without changing progress. A due repeat stays in the queue.
function skip() {
  if (fromPending) { state.pending.push({ cardId: card.id, dueStep: state.step + randInt(4, 8) }); save(); }
  next();
}

function submit() {
  if (phase === 'correct') { next(); return; }
  if (!normalize(input.value)) { input.focus(); return; }
  const right = `Correct answer:\n${answer(card, dir)}\nType it in`;
  if (isCorrect(input.value, card, dir)) {
    record(card.id, !hadMistake);
    phase = 'correct';
    setMsg('Correct', 'green');
    $('action').textContent = 'Next'; $('action').classList.add('ok');
    $('skip').hidden = true;
  } else if (phase === 'answering') {
    hadMistake = true; left -= 1;
    if (left > 0) setMsg(`Wrong. Attempts left: ${left}`, 'red');
    else { phase = 'mustRetype'; setMsg(right, 'orange'); }
    input.value = '';
  } else {
    setMsg('Wrong. ' + right, 'orange');
    input.value = '';
  }
  input.focus();
}

$('form').addEventListener('submit', e => { e.preventDefault(); submit(); });
$('action').addEventListener('pointerdown', e => e.preventDefault()); // keep keyboard open
$('action').addEventListener('click', submit);
$('skip').addEventListener('pointerdown', e => e.preventDefault()); // keep keyboard open
$('skip').addEventListener('click', skip);
$('close').addEventListener('click', () => { input.blur(); showHome(); });
$('start').addEventListener('click', showStudy);

fetch('cards.json').then(r => r.json()).then(list => {
  buildDeck(list);
  $('start').disabled = false;
  showHome();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
