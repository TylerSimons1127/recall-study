/* ============ RECALL v3 — real FSRS engine, full CRUD, share links ============ */
import { fsrs, createEmptyCard, Rating, State } from './ts-fsrs.js';

(() => {
'use strict';

/* ---------- FSRS scheduler (real, 21-param v6) ---------- */
let scheduler = fsrs({ request_retention: 0.90, maximum_interval: 36500, enable_fuzz: true });

function setRetention(r){ scheduler = fsrs({ request_retention: r, maximum_interval: 36500, enable_fuzz: true }); }

/* Card storage shape (hydrated to fsrs Card when scheduling):
 * { id, front, back, state:{due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review} }
 */
function toFsrsCard(c){
  const s = c.f || {};
  return {
    due: s.due ? new Date(s.due) : new Date(),
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    elapsed_days: s.elapsed_days ?? 0,
    scheduled_days: s.scheduled_days ?? 0,
    reps: s.reps ?? 0,
    lapses: s.lapses ?? 0,
    learning_steps: s.learning_steps ?? 0,
    state: s.state ?? State.New,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

function grade(c, rating){ // rating: 1..4 (Rating.Again..Easy)
  const card = toFsrsCard(c);
  const out = scheduler.next(card, new Date(), rating);
  const nc = out.card;
  c.f = {
    due: nc.due.getTime(),
    stability: nc.stability,
    difficulty: nc.difficulty,
    elapsed_days: nc.elapsed_days,
    scheduled_days: nc.scheduled_days,
    reps: nc.reps,
    lapses: nc.lapses,
    learning_steps: nc.learning_steps,
    state: nc.state,
    last_review: nc.last_review ? nc.last_review.getTime() : undefined,
  };
  save();
}

function retrievability(c){
  if(!c.f || c.f.state === State.New) return null; // never reviewed
  const now = new Date();
  const last = c.f.last_review ? new Date(c.f.last_review) : new Date(c.f.due);
  const elapsed = Math.max(0, (now - last) / 86400000);
  const s = c.f.stability ?? 0;
  if(s <= 0) return 0;
  // FSRS forgetting curve: R(t) = (1 + FACTOR * t / S) ^ DECAY
  // default DECAY = -0.1542, FACTOR = 19/81
  return Math.pow(1 + (19/81) * (elapsed / s), -0.1542);
}

function cardDue(c){ return !c.f || c.f.due <= Date.now(); }
function dueCards(set){ return set.cards.filter(cardDue); }
function allDue(){ return store.sets.reduce((n,s)=>n+dueCards(s).length,0); }
function weakest(n){
  const all=[];
  store.sets.forEach(s=>s.cards.forEach(c=>{ const p = retrievability(c); if(p!==null) all.push({set:s, card:c, p}); }));
  return all.sort((a,b)=>a.p-b.p).slice(0,n);
}
function masteryOf(set){
  const reviewed = set.cards.filter(c=>c.f && c.f.reps>0);
  if(!reviewed.length) return 0;
  const sum = reviewed.reduce((a,c)=>a + (retrievability(c) ?? 0), 0);
  return Math.round(sum/reviewed.length*100);
}
function avgRetention(){
  const all = store.sets.flatMap(s=>s.cards).filter(c=>c.f && c.f.reps>0);
  if(!all.length) return null;
  return Math.round(all.reduce((a,c)=>a+(retrievability(c)??0),0)/all.length*100);
}

/* ---------- persistence ---------- */
const LS_KEY = 'recall_v3';
const store = {
  sets: [],
  sessions: [],
  streak: { count: 0, lastDate: '' },
  settings: { retention: 0.90, newPerDay: 20, theme: 'auto' },
};
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(store)); }catch(e){ console.warn('storage full', e); } }
function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){ Object.assign(store, JSON.parse(raw)); applySettings(); return; }
  }catch(e){}
}

function bumpStreak(){
  const t = todayStr();
  if(store.streak.lastDate !== t){
    const yest = todayStr(new Date(Date.now() - 86400000));
    store.streak.count = (store.streak.lastDate === yest) ? store.streak.count + 1 : 1;
    store.streak.lastDate = t;
    save();
  }
}

const DAY = 86400000;
function todayStr(d){
  const dt = d || new Date();
  const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,'0'), day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function uid(){ return Math.random().toString(36).slice(2,10); }

/* ---------- DOM utils ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function show(view){
  $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+view));
  window.scrollTo(0,0);
}
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._to); t._to = setTimeout(()=>t.classList.remove('show'), 2600);
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function normalize(s){ return String(s).toLowerCase().replace(/[’’']/g,"'").replace(/[^a-z0-9\s]/g,'').replace(/\b(the|a|an|of|in|on|to|for|and|or)\b/g,'').replace(/\s+/g,' ').trim(); }
function fuzzyMatch(a,b){ if(!a||!b) return false; if(a===b) return true; const wa=new Set(a.split(' ')), wb=new Set(b.split(' ')); let hit=0; for(const t of wa) if(wb.has(t)) hit++; return hit/Math.max(wa.size,wb.size) >= 0.6; }

/* ---------- render: HOME ---------- */
function renderHome(){
  const due = allDue();
  $('#today-headline').textContent = due===0 ? 'All caught up' : `${due} card${due===1?'':'s'} due`;
  const topSet = store.sets.map(s=>({s, pending:dueCards(s).length})).filter(x=>x.pending>0).sort((a,b)=>b.pending-a.pending)[0];
  $('#today-sub').textContent = topSet ? `${topSet.s.subject} · ${topSet.s.title}` : (store.sets.length ? 'Review any set to keep your streak' : 'Make your first set to begin');
  $('#continue-label').textContent = due===0 ? (store.sets.length ? 'Review anyway' : 'Create a set') : 'Continue studying';
  $('#stat-due').textContent = due;
  $('#stat-streak').textContent = store.streak.count;
  const ret = avgRetention();
  $('#stat-retention').textContent = ret===null ? '—' : ret+'%';
  const ringPct = ret===null ? 0 : ret;
  $('#ring-pct').textContent = ringPct;
  drawRing($('#mastery-ring'), ringPct);
  $('#today-date').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});

  renderSetsList($('#search').value.trim());
  renderHeatmap();
  renderWeakest();
}

function renderSetsList(q){
  const list = $('#sets-list'); list.innerHTML='';
  const query = q.toLowerCase();
  const filtered = store.sets.filter(s =>
    !q || s.title.toLowerCase().includes(query) || s.subject.toLowerCase().includes(query) ||
    s.cards.some(c => c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query))
  );
  $('#empty-home').hidden = store.sets.length > 0;
  if(!filtered.length && store.sets.length > 0){
    list.innerHTML = `<div class="empty-state" style="padding:20px"><p style="margin:0">No sets match "${esc(q)}"</p></div>`;
    return;
  }
  filtered.forEach(s=>{
    const pending = dueCards(s).length;
    const mastery = masteryOf(s);
    const row = document.createElement('button');
    row.className='set-row';
    row.innerHTML = `
      <div class="set-chip" style="background:${s.color}1a;color:${s.color};border:1px solid ${s.color}33">${(s.subject||'S').slice(0,2).toUpperCase()}</div>
      <div class="set-info">
        <div class="set-name">${esc(s.title)}</div>
        <div class="set-detail">${s.cards.length} cards · ${mastery}% retention</div>
      </div>
      ${pending>0?`<span class="set-due">${pending} due</span>`:`<span class="set-due zero">done</span>`}`;
    row.onclick = ()=> openSet(s.id);
    list.appendChild(row);
  });
}

function renderHeatmap(){
  const hm = $('#heatmap'); hm.innerHTML='';
  const today = new Date(); today.setHours(0,0,0,0);
  const todayDow = (today.getDay()+6)%7;
  const counts = {};
  store.sessions.forEach(s=>{ counts[s.date] = (counts[s.date]||0)+(s.reviewed||0); });
  for(let w=11; w>=0; w--){
    for(let d=0; d<7; d++){
      const dt = new Date(today);
      dt.setDate(dt.getDate() - (w*7 + (todayDow - d)));
      const key = todayStr(dt);
      const c = counts[key] || 0;
      const cell = document.createElement('div');
      cell.className = 'hm-cell' + (c===0 ? '' : c<10 ? ' l1' : c<25 ? ' l2' : c<50 ? ' l3' : ' l4');
      if(key === todayStr()) cell.classList.add('today');
      cell.title = `${key}: ${c} cards reviewed`;
      if(dt > today) cell.style.visibility = 'hidden';
      hm.appendChild(cell);
    }
  }
}

function renderWeakest(){
  const wl = $('#weakest-list'); wl.innerHTML='';
  const w = weakest(4);
  if(!w.length){ wl.innerHTML = `<p style="font-size:13.5px;color:var(--muted);padding:16px;text-align:center">Study some cards first — weak ones will appear here.</p>`; return; }
  w.forEach(({set,card,p})=>{
    const r = document.createElement('div'); r.className='weak-row';
    r.innerHTML = `<span class="weak-term">${esc(card.front)}</span><span class="weak-set">${esc(set.subject)}</span><div class="weak-meter"><i style="width:${Math.round(p*100)}%"></i></div>`;
    r.onclick = ()=>{ openSet(set.id); startSession(set.id,'flashcards'); };
    r.style.cursor='pointer';
    wl.appendChild(r);
  });
}

function drawRing(svg, pct){
  const C = 2*Math.PI*50;
  svg.innerHTML = `
    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line-soft)" stroke-width="8"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--acc)" stroke-width="8"
      stroke-linecap="round" stroke-dasharray="${(pct/100*C).toFixed(1)} ${C.toFixed(1)}"
      style="transition:stroke-dasharray 800ms cubic-bezier(.3,.7,.3,1)"/>
    ${Array.from({length:12},(_,i)=>{
      const a = i/12*Math.PI*2 - Math.PI/2;
      const major = i%3===0, r1 = 44, r2 = major ? 37.5 : 41.5;
      return `<line x1="${(60+Math.cos(a)*r1).toFixed(1)}" y1="${(60+Math.sin(a)*r1).toFixed(1)}" x2="${(60+Math.cos(a)*r2).toFixed(1)}" y2="${(60+Math.sin(a)*r2).toFixed(1)}" stroke="var(--line)" stroke-width="${major?2:1}" opacity="${major?0.9:0.5}"/>`;
    }).join('')}`;
}

/* ---------- SET DETAIL ---------- */
let currentSetId = null;
function openSet(id){
  currentSetId = id;
  const s = store.sets.find(x=>x.id===id);
  if(!s) return show('home');
  $('#set-title').textContent = s.title;
  $('#set-meta').innerHTML = `
    <span class="meta-pill"><b>${s.cards.length}</b> cards</span>
    <span class="meta-pill"><b>${masteryOf(s)}%</b> retention</span>
    <span class="meta-pill"><b>${dueCards(s).length}</b> due</span>`;
  const examInput = $('#exam-date'), pill = $('#exam-pill');
  examInput.value = s.examDate||'';
  examInput.onchange = ()=>{ s.examDate = examInput.value; save(); updateExamPill(s, pill); };
  updateExamPill(s, pill);
  $('#card-count').textContent = `${s.cards.length} total`;
  const cl = $('#card-list'); cl.innerHTML='';
  s.cards.forEach(c=>{
    const r = retrievability(c);
    const stab = c.f ? c.f.stability : null;
    const dotColor = r===null ? 'var(--muted)' : r>=0.85 ? 'var(--good)' : r>=0.6 ? 'var(--hard)' : 'var(--bad)';
    const row = document.createElement('div'); row.className='card-row';
    row.innerHTML = `
      <div class="card-side"><span class="lab">Term</span><div class="txt">${esc(c.front)}</div></div>
      <div class="card-side"><span class="lab">Answer</span><div class="txt">${esc(c.back)}</div></div>
      <div class="card-stab">
        <span class="stab-dot" style="background:${dotColor}" title="${r===null?'not yet reviewed':Math.round(r*100)+'% recall probability'}"></span>
        <span style="font-size:10px;color:var(--muted);font-family:var(--f-mono)">${r===null?'new':Math.round(r*100)+'%'}</span>
      </div>
      <div class="card-actions">
        <button class="card-mini-btn" data-edit="${c.id}" title="Edit card"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
        <button class="card-mini-btn danger" data-del="${c.id}" title="Delete card"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>`;
    cl.appendChild(row);
  });
  show('set');
}

function updateExamPill(s, pill){
  if(!s.examDate){ pill.hidden = true; return; }
  const exam = new Date(s.examDate+'T12:00:00');
  const days = Math.ceil((exam - Date.now())/DAY);
  const unlearned = s.cards.filter(c => { const r = retrievability(c); return r === null || r < 0.9; }).length;
  pill.hidden = false;
  if(days < 0){ pill.textContent = 'Exam passed — review for retention'; pill.style.color = 'var(--muted)'; return; }
  pill.style.color = '';
  pill.textContent = days === 0
    ? `Exam today — ${unlearned} cards not yet at 90% recall`
    : `${days} day${days===1?'':'s'} · ${Math.ceil(unlearned/days)} new cards/day to cover all`;
}

/* ---------- STUDY SESSION ---------- */
let session = null;
let lastGrade = null; // for undo

document.addEventListener('click', e=>{
  const mc = e.target.closest('.mode-card');
  if(mc) startSession(currentSetId, mc.dataset.mode);
});

$('#btn-continue').onclick = ()=>{
  if(!store.sets.length){ openSheet(); return; }
  const top = store.sets.map(s=>({s, p:dueCards(s).length})).sort((a,b)=>b.p-a.p)[0];
  openSet(top.s.id);
  startSession(top.s.id, 'flashcards');
};

$('#btn-exit-study').onclick = ()=>{ if(session) finishSession(true); };

$('#btn-undo').onclick = ()=>{
  if(!session) return;
  if(!lastGrade) { $('#btn-undo').disabled = true; return; }
  session.idx--;
  session.reviewed = Math.max(0, session.reviewed - 1);
  if(lastGrade.rating >= 3) session.correct = Math.max(0, session.correct - 1);
  const c = session.queue[session.idx];
  if(c) c.f = lastGrade.prevF;
  lastGrade = null;
  $('#btn-undo').disabled = true;
  save();
  renderStudy();
  toast('Undone');
};

function startSession(setId, mode){
  const s = store.sets.find(x=>x.id===setId);
  if(!s || !s.cards.length){ toast('No cards in this set yet'); return; }
  let cards = mode === 'flashcards' || mode === 'learn' ? dueCards(s) : s.cards.slice();
  if(!cards.length){ cards = s.cards.slice(); toast('No cards due — reviewing all anyway'); }
  shuffle(cards);
  session = { setId, mode, queue:cards, idx:0, correct:0, reviewed:0, matched:0 };
  lastGrade = null;
  $('#btn-undo').disabled = true;
  show('study');
  renderStudy();
}

function renderStudy(){
  const s = store.sets.find(x=>x.id===session.setId);
  const { mode, queue, idx } = session;
  $('#study-progress').style.width = `${(idx/queue.length*100)}%`;
  $('#study-count').textContent = `${Math.min(idx+1,queue.length)}/${queue.length}`;
  const stage = $('#study-stage'); stage.innerHTML='';
  if(mode === 'flashcards') renderFlashcard(stage, s, queue[idx]);
  else if(mode === 'learn') renderLearn(stage, s, queue[idx]);
  else if(mode === 'test') renderTestQ(stage, s, queue[idx]);
  else if(mode === 'match') renderMatch(stage, s);
}

function trackGrade(c, rating){
  lastGrade = { prevF: c.f ? { ...c.f } : null, rating };
  $('#btn-undo').disabled = false;
  grade(c, rating);
}

/* flashcards */
function renderFlashcard(stage, s, card){
  stage.innerHTML = `
    <div class="fc-scene">
      <div class="fc-card" id="fc-card" tabindex="0" role="button" aria-label="Flip card">
        <div class="fc-face"><div class="fc-tag">${esc(s.subject)}</div><div class="fc-text">${esc(card.front)}</div><div class="fc-hint">Tap or press space to flip</div></div>
        <div class="fc-face fc-back"><div class="fc-tag">Answer</div><div class="fc-text">${esc(card.back)}</div><div class="fc-hint">How well did you know it?</div></div>
      </div>
    </div>
    <div class="grade-row" id="grade-row" style="opacity:0;pointer-events:none;transition:opacity var(--t-micro)">
      <button class="grade-btn g1" data-g="1"><span>Again</span><small><kbd>1</kbd></small></button>
      <button class="grade-btn g2" data-g="2"><span>Hard</span><small><kbd>2</kbd></small></button>
      <button class="grade-btn g3" data-g="3"><span>Good</span><small><kbd>3</kbd></small></button>
      <button class="grade-btn g4" data-g="4"><span>Easy</span><small><kbd>4</kbd></small></button>
    </div>`;
  const fc = $('#fc-card'), gr = $('#grade-row');
  gr.innerHTML = `
    <div class="confidence-strip" id="conf-strip">
      <span class="conf-lab">How sure were you?</span>
      <button class="conf-btn" data-c="3">Sure</button>
      <button class="conf-btn" data-c="2">Mostly</button>
      <button class="conf-btn" data-c="1">Guessed</button>
    </div>
  ` + gr.innerHTML;
  fc.onclick = ()=>{ fc.classList.add('flipped'); gr.style.opacity=1; gr.style.pointerEvents='auto'; };
  fc.onkeydown = e=>{ if(e.key===' '||e.key==='Enter'){e.preventDefault();fc.click();} };
  gr.querySelectorAll('.grade-btn').forEach(b=>{
    b.onclick = ()=>{
      const r = +b.dataset.g;
      const confBtn = gr.querySelector('.conf-btn.sel');
      const conf = confBtn ? +confBtn.dataset.c : 2;
      trackGrade(card, r);
      // store confidence for calibration analytics
      card.confHistory = (card.confHistory || []).concat([{ r, conf, t: Date.now() }]).slice(-30);
      save();
      session.reviewed++;
      if(r >= 3) session.correct++;
      nextCard();
    };
  });
  gr.querySelectorAll('.conf-btn').forEach(b=>{
    b.onclick = e=>{ e.stopPropagation(); gr.querySelectorAll('.conf-btn').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); };
  });
}

/* learn */
function renderLearn(stage, s, card){
  stage.innerHTML = `
    <div class="learn-q">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">${esc(s.subject)}</div>
      <h2>${esc(card.front)}</h2>
      <form class="learn-form" id="learn-form">
        <input class="learn-input" id="learn-input" type="text" placeholder="Type your answer…" autocomplete="off" autocapitalize="off" spellcheck="false"/>
        <button type="submit" class="btn-primary full">Check</button>
      </form>
      <div class="learn-hint" id="learn-hint" hidden></div>
      <div class="learn-verdict" id="learn-verdict"></div>
    </div>`;
  const inp = $('#learn-input'), vf = $('#learn-verdict'), hint = $('#learn-hint');
  inp.focus();
  let attempts = 0;
  $('#learn-form').onsubmit = e=>{
    e.preventDefault();
    const ok = fuzzyMatch(normalize(inp.value), normalize(card.back));
    attempts++;
    if(ok){
      trackGrade(card, attempts === 1 ? 3 : 2); // hint used = "Hard"
      session.reviewed++; session.correct++;
      vf.className='learn-verdict ok'; vf.textContent = attempts === 1 ? 'Correct.' : 'Correct — but the hint means this one needs more reps.';
      hint.hidden = true;
      setTimeout(nextCard, 1100);
      return;
    }
    if(attempts === 1){
      // Socratic recovery: useful hint without giving away the answer
      const back = card.back;
      const words = back.split(/\s+/).filter(Boolean);
      let hintTxt;
      const commaIdx = back.indexOf(',');
      if(commaIdx > 3 && commaIdx < 60){
        hintTxt = `Think about: "${back.slice(0, commaIdx).trim()}" …`;
      } else if(words.length >= 3){
        const first = words[0];
        hintTxt = `Starts with "${first[0]}${'_'.repeat(Math.max(0,first.length-1))}" and is ${words.length} words`;
      } else {
        hintTxt = `First letter: "${back[0]}" (${back.length} letters)`;
      }
      hint.hidden = false;
      hint.innerHTML = `<strong>Hint:</strong> ${esc(hintTxt)}`;
      vf.className='learn-verdict no'; vf.innerHTML = 'Not quite. Try again — or skip and I\'ll show it.';
      inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),450);
      inp.value=''; inp.focus();
      return;
    }
    // second miss: reveal and re-queue
    trackGrade(card, 1);
    session.reviewed++;
    hint.hidden = true;
    vf.className='learn-verdict no'; vf.innerHTML = `Answer: <b>${esc(card.back)}</b>. It'll come back around.`;
    setTimeout(nextCard, 1800);
  };
}

/* test */
function buildDistractors(s, card){
  const others = s.cards.filter(c=>c.id!==card.id).map(c=>c.back);
  shuffle(others);
  const opts = [card.back];
  for(const o of others){ if(opts.length<4) opts.push(o); }
  return shuffle(opts);
}
function renderTestQ(stage, s, card){
  const kindRoll = Math.random();
  const kind = kindRoll<0.55 ? 'mc' : kindRoll<0.8 ? 'tf' : 'written';
  let html = `<div class="test-q"><span class="kind">${kind==='mc'?'Multiple choice':kind==='tf'?'True or false':'Written'}</span><h3>${esc(card.front)}</h3>`;
  if(kind === 'mc'){
    buildDistractors(s, card).forEach(o=>{ html += `<button class="opt" data-val="${esc(o)}"><span class="radio"></span>${esc(o)}</button>`; });
    stage.innerHTML = html;
    stage.querySelectorAll('.opt').forEach(o=>{ o.onclick = ()=> answerTest(card, o.dataset.val, o.dataset.val===card.back); });
  } else if(kind === 'tf'){
    const showRight = Math.random() < 0.55;
    const stmt = showRight ? card.back : (s.cards.find(c=>c.id!==card.id)?.back || card.back);
    html += `<p style="font-size:15px;color:var(--ink-soft);margin-bottom:14px">${esc(stmt)}</p><button class="opt" data-v="t"><span class="radio"></span>True</button><button class="opt" data-v="f"><span class="radio"></span>False</button>`;
    stage.innerHTML = html;
    stage.querySelectorAll('.opt').forEach(o=>{ o.onclick = ()=> answerTest(card, o.dataset.v, (o.dataset.v==='t') === showRight); });
  } else {
    html += `<form id="test-written" class="learn-form"><input class="learn-input" id="test-inp" placeholder="Your answer…" autocomplete="off"/><button type="submit" class="btn-primary full">Check</button></form>`;
    stage.innerHTML = html; $('#test-inp').focus();
    $('#test-written').onsubmit = e=>{ e.preventDefault(); answerTest(card, $('#test-inp').value, fuzzyMatch(normalize($('#test-inp').value), normalize(card.back))); };
  }
}
function answerTest(card, given, ok){
  trackGrade(card, ok ? 3 : 1);
  session.reviewed++;
  if(ok) session.correct++;
  $$('.opt').forEach(o=>{ o.style.pointerEvents='none'; if(normalize(o.textContent) === normalize(String(card.back))){ o.style.background='var(--acc-tint)'; o.style.borderColor='var(--acc-line)'; o.style.color='var(--acc-ink)'; } });
  setTimeout(nextCard, ok ? 700 : 1400);
}

/* match */
function renderMatch(stage, s){
  const pool = s.cards.slice(0, Math.min(6, s.cards.length));
  shuffle(pool);
  const items = [];
  pool.forEach((c,i)=>{ items.push({k:i, txt:c.front, side:'q'}); items.push({k:i, txt:c.back, side:'a'}); });
  shuffle(items);
  const start = Date.now();
  let picks = [];
  stage.innerHTML = `<div class="match-head"><span class="score" id="match-count">0/${pool.length} matched</span><span class="time" id="match-time">0.0s</span></div><div class="match-board">${items.map(i=>`<button class="match-tile" data-k="${i.k}" data-side="${i.side}">${esc(i.txt)}</button>`).join('')}</div>`;
  const timer = setInterval(()=>{ $('#match-time').textContent = ((Date.now()-start)/1000).toFixed(1)+'s'; }, 100);
  stage.querySelectorAll('.match-tile').forEach(t=>{
    t.onclick = ()=>{
      if(t.classList.contains('done')) return;
      if(t.classList.contains('sel')){ t.classList.remove('sel'); picks = picks.filter(x=>x!==t); return; }
      t.classList.add('sel'); picks.push(t);
      if(picks.length === 2){
        const [a,b] = picks;
        const ok = +a.dataset.k === +b.dataset.k && a.dataset.side !== b.dataset.side;
        setTimeout(()=>{
          if(ok){
            [a,b].forEach(x=>{ x.classList.add('done'); x.classList.remove('sel'); });
            session.matched++;
            $('#match-count').textContent = `${session.matched}/${pool.length} matched`;
            if(session.matched === pool.length){
              clearInterval(timer);
              session.reviewed = pool.length; session.correct = pool.length;
              pool.forEach(c => trackGrade(c, 3));
              setTimeout(()=> finishSession(false, Date.now()-start), 700);
            }
          } else {
            [a,b].forEach(x=>{ x.classList.add('err'); setTimeout(()=>x.classList.remove('sel','err'),400); });
          }
          picks = [];
        },180);
      }
    };
  });
}

function nextCard(){ session.idx++; if(session.idx >= session.queue.length) finishSession(false); else renderStudy(); }

function finishSession(cancelled, matchTime){
  const s = store.sets.find(x=>x.id===session.setId);
  if(session.reviewed === 0 && cancelled){ show('set'); session = null; return; }
  const pct = session.reviewed ? Math.round(session.correct/session.reviewed*100) : 0;
  store.sessions.push({ date: todayStr(), setId: session.setId, mode: session.mode, reviewed: session.reviewed, correct: session.correct });
  bumpStreak();
  save();
  renderHome();
  const sb = $('#summary-body');
  sb.innerHTML = `
    <div class="sum-circle"><svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
    <h1 class="sum-title">Session ${cancelled?'ended':'complete'}</h1>
    <p class="sum-sub">${esc(s.title)} · ${session.mode}${matchTime?` · ${(matchTime/1000).toFixed(1)}s`:''}</p>
    <div class="sum-stats">
      <div class="sum-stat"><b>${session.reviewed}</b><span>reviewed</span></div>
      <div class="sum-stat"><b>${pct}%</b><span>correct</span></div>
      <div class="sum-stat"><b>${allDue()}</b><span>still due</span></div>
    </div>
    <div class="sum-actions">
      <button class="btn-primary" id="sum-again">Study again</button>
      <button class="btn-ghost" id="sum-home">Back to library</button>
    </div>`;
  show('summary');
  $('#sum-again').onclick = ()=> startSession(session.setId, session.mode);
  $('#sum-home').onclick = ()=>{ session = null; show('home'); };
}

/* ---------- AI card generation: WebLLM in-browser + smart local fallback ---------- */
let webllmEngine = null, webllmLoading = false;
const WEBLLM_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC"; // ~600MB, fast, good enough for QA extraction

function genStatus(msg, pct){
  const g = $('#gen-status');
  if(!msg){ g.hidden = true; return; }
  g.hidden = false;
  g.innerHTML = `${esc(msg)}${pct != null ? `<div class="gen-bar"><i style="width:${Math.round(pct*100)}%"></i></div>` : ''}`;
}

async function aiGenerate(text){
  // Kick off WebLLM load in background; use smart local parser immediately
  if(!webllmEngine && !webllmLoading && 'gpu' in navigator){
    webllmLoading = true;
    genStatus('Loading AI model (~600 MB, one-time)…', 0.05);
    try {
      const mod = await import('https://esm.run/@mlc-ai/web-llm@0.2.84').catch(()=>null);
      if(mod){
        const { CreateMLCEngine } = mod;
        webllmEngine = await CreateMLCEngine(WEBLLM_MODEL, {
          initProgressCallback: r => genStatus(`Downloading AI model…`, r.progress || 0),
        });
        genStatus('AI model ready.');
      }
    } catch(e){ console.warn('WebLLM unavailable, staying local-parse', e); }
    webllmLoading = false;
  }

  if(webllmEngine){
    genStatus('AI reading your material…');
    const prompt = `Extract ${Math.min(20, Math.max(5, Math.floor(text.split(/\s+/).length/25)))} study flashcards from this text as strict JSON only. Each card: {"q":"short term or question","a":"concise answer"}. Rules: facts only from the text, no invented info, no markdown, JSON array only.\n\nTEXT:\n${text.slice(0, 3500)}`;
    try {
      const r = await webllmEngine.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 1800 });
      const raw = r.choices?.[0]?.message?.content || '';
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if(jsonMatch){
        const arr = JSON.parse(jsonMatch[0]);
        const cards = arr.filter(x=>x && x.q && x.a).slice(0,25).map(x=>mkCard(String(x.q).trim(), String(x.a).trim()));
        if(cards.length) return cards;
      }
    } catch(e){ console.warn('AI gen failed', e); }
  }
  // fallback: smarter local parser (multi-line + bullets + sentences)
  return parseLocal(text);
}

function parseLocal(text){
  const cards = [];
  const seen = new Set();
  // First: explicit pair lines
  const pairRe = [
    /^(.{2,60}?)\s*[-–—•:]\s+(.{4,})$/,
    /^(.{2,50}?)\s+(?:is|are|means|refers to|consists of|describes|was|were)\s+(.{6,})$/i,
  ];
  const lines = text.split(/\n+/).map(l=>l.trim()).filter(l=>l.length>3);
  for(const line of lines){
    if(cards.length >= 30) break;
    for(const re of pairRe){
      const m = line.match(re);
      if(m){
        const front = m[1].trim().replace(/^[-*•\d.)\s]+/,''), back = m[2].trim();
        const key = front.toLowerCase();
        if(back.length > 1 && !seen.has(key)){
          seen.add(key);
          cards.push(mkCard(titleCase(front), back));
          break;
        }
      }
    }
  }
  // Second: definition-sentence harvesting from paragraphs
  if(cards.length < 5){
    const sentences = text.replace(/\s+/g,' ').match(/[^.!?]+[.!?]/g) || [];
    for(const s of sentences){
      if(cards.length >= 15) break;
      const m = s.match(/^\s*([A-Z][\w\s'–-]{2,40})\s+(is|are|was|were|refers to|consists of|describes|functions as)\s+(.{8,200}?)[.!?]\s*$/);
      if(m){
        const front = m[1].trim(), back = `${m[2]} ${m[3].trim()}`;
        const key = front.toLowerCase();
        if(!seen.has(key)){ seen.add(key); cards.push(mkCard(front, back)); }
      }
    }
  }
  return cards;
}
function titleCase(s){ return s.replace(/\b\w/g, c=>c.toUpperCase()); }

/* ---------- AI-lite text → cards ---------- */
function generateFromText(title, text){
  // synchronous wrapper — kept for compatibility with any old callers
  return parseLocal(text);
}
function mkCard(front, back){ return { id: uid(), front, back, f: null }; }

/* ---------- share (URL self-contained, no account) ---------- */
function encodeShareSet(s){
  const payload = { v:1, title: s.title, subject: s.subject, cards: s.cards.map(c=>({f: c.front, b: c.back})) };
  const json = JSON.stringify(payload);
  return btoa(encodeURIComponent(json));
}
function decodeShareSet(str){
  try{ return JSON.parse(decodeURIComponent(atob(str))); }catch(e){ return null; }
}
function shareUrl(s){ return `${location.origin}${location.pathname}#s=${encodeShareSet(s)}`; }

function renderSharedImport(){
  const hash = location.hash;
  if(!hash.startsWith('#s=')) return false;
  const decoded = decodeShareSet(hash.slice(3));
  if(!decoded || !decoded.cards || !decoded.cards.length){ toast('Invalid shared link'); return false; }
  const existing = $('#import-shared-banner');
  if(existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'import-shared-banner';
  banner.className = 'import-banner';
  banner.innerHTML = `
    <h3>Someone shared "${esc(decoded.title)}"</h3>
    <p>${decoded.cards.length} cards · ${esc(decoded.subject || 'General')}</p>
    <button class="btn-primary" id="btn-import-shared-set">Add to my library</button>`;
  const homeView = $('#view-home');
  const head = homeView.querySelector('.home-head');
  head.after(banner);
  $('#btn-import-shared-set').onclick = ()=>{
    const set = { id: uid(), subject: decoded.subject||'Shared', title: decoded.title, color: newColor(), examDate: '', cards: decoded.cards.map(c=>mkCard(c.f, c.b)) };
    store.sets.unshift(set); save();
    history.replaceState(null,'',location.pathname);
    banner.remove();
    renderHome();
    toast(`Added ${set.cards.length} cards`);
    openSet(set.id);
  };
  return true;
}

/* ---------- sheets & actions ---------- */
const sheet = $('#sheet-newset');
function openSheet(){ sheet.hidden = false; switchTab('paste'); }
function closeSheet(){ sheet.hidden = true; }
$('#btn-new-set').onclick = openSheet;
$('#btn-empty-new').onclick = openSheet;
sheet.addEventListener('click', e=>{ if(e.target === sheet || e.target.closest('[data-close-sheet]')) closeSheet(); });

const settingsSheet = $('#sheet-settings');
$('#btn-settings').onclick = ()=>{ settingsSheet.hidden = false; };
settingsSheet.addEventListener('click', e=>{ if(e.target === settingsSheet || e.target.closest('[data-close-sheet]')) settingsSheet.hidden = true; });

const editSheet = $('#sheet-editcard');
let editingCardId = null;
function openEditSheet(cardId){
  const s = store.sets.find(x=>x.id===currentSetId);
  const card = s?.cards.find(c=>c.id===cardId);
  if(!card) return;
  editingCardId = cardId;
  $('#ec-front').value = card.front;
  $('#ec-back').value = card.back;
  editSheet.hidden = false;
}
editSheet.addEventListener('click', e=>{ if(e.target === editSheet || e.target.closest('[data-close-sheet]')) editSheet.hidden = true; });
$('#btn-save-card').onclick = ()=>{
  const s = store.sets.find(x=>x.id===currentSetId);
  const card = s?.cards.find(c=>c.id===editingCardId);
  if(!card) return;
  card.front = $('#ec-front').value.trim();
  card.back = $('#ec-back').value.trim();
  save(); editSheet.hidden = true; openSet(currentSetId);
  toast('Card saved');
};
$('#btn-delete-card').onclick = ()=>{
  const s = store.sets.find(x=>x.id===currentSetId);
  if(!s || !confirm('Delete this card?')) return;
  s.cards = s.cards.filter(c=>c.id !== editingCardId);
  save(); editSheet.hidden = true; openSet(currentSetId);
  toast('Card deleted');
};

// per-row edit/delete via event delegation
$('#card-list').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-del]');
  if(editBtn){ openEditSheet(editBtn.dataset.edit); }
  if(delBtn){
    const s = store.sets.find(x=>x.id===currentSetId);
    if(!s || !confirm('Delete this card?')) return;
    s.cards = s.cards.filter(c=>c.id !== delBtn.dataset.del);
    save(); openSet(currentSetId); toast('Card deleted');
  }
});

$('#btn-delete-set').onclick = ()=>{
  const s = store.sets.find(x=>x.id===currentSetId);
  if(!s) return;
  if(!confirm(`Delete "${s.title}" and all ${s.cards.length} cards? This can't be undone.`)) return;
  store.sets = store.sets.filter(x=>x.id !== currentSetId);
  save();
  show('home'); renderHome();
  toast('Set deleted');
};

/* search */
$('#search').addEventListener('input', e=> renderSetsList(e.target.value.trim()));

/* nav back */
document.addEventListener('click', e=>{
  const nav = e.target.closest('[data-nav]');
  if(nav) show(nav.dataset.nav);
});

/* ---------- sheet tabs ---------- */
$('#newset-tabs').addEventListener('click', e=>{
  const b = e.target.closest('.seg-btn'); if(!b) return;
  switchTab(b.dataset.tab);
});
function switchTab(t){
  $$('#newset-tabs .seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab === t));
  $('#tab-paste').classList.toggle('active', t === 'paste');
  $('#tab-manual').classList.toggle('active', t === 'manual');
  $('#tab-import').classList.toggle('active', t === 'import');
}

function addManualRow(front = '', back = ''){
  const wrap = $('#manual-rows');
  const row = document.createElement('div'); row.className = 'mrow';
  row.innerHTML = `<input placeholder="Term" value="${esc(front)}"/><input placeholder="Definition" value="${esc(back)}"/>`;
  wrap.appendChild(row);
  if(!front) row.children[0].focus();
}
$('#btn-add-row').onclick = ()=> addManualRow();

$('#btn-generate').onclick = async ()=>{
  const title = $('#np-title').value.trim() || 'Untitled set';
  const text = $('#np-text').value;
  if(!text.trim()){ toast('Paste some text first.'); return; }
  $('#btn-generate').disabled = true;
  genStatus('Reading material…');
  try{
    const cards = await aiGenerate(text);
    if(!cards.length){ genStatus(); toast('No cards found. Try clearer lines like "term - definition".'); return; }
    const set = { id: uid(), subject: title.split(/[-—–:]/)[0].trim() || 'General', title, color: newColor(), examDate: '', cards };
    store.sets.unshift(set); save(); closeSheet(); openSet(set.id);
    toast(`${cards.length} cards generated`);
    genStatus();
  } finally {
    $('#btn-generate').disabled = false;
  }
};
$('#btn-save-manual').onclick = ()=>{
  const title = $('#nm-title').value.trim() || 'Untitled set';
  const rows = $$('#manual-rows .mrow');
  const cards = [];
  rows.forEach(r=>{ const f = r.children[0].value.trim(), b = r.children[1].value.trim(); if(f && b) cards.push(mkCard(f, b)); });
  if(!cards.length){ toast('Add at least one card.'); return; }
  const set = { id: uid(), subject: title.split(/[-—–:]/)[0].trim() || 'General', title, color: newColor(), examDate: '', cards };
  store.sets.unshift(set); save(); closeSheet(); openSet(set.id);
  toast(`Saved ${cards.length} cards`);
  $('#manual-rows').innerHTML = ''; addManualRow(); addManualRow(); addManualRow();
};
$('#btn-import').onclick = ()=>{
  const title = $('#ni-title').value.trim() || 'Imported set';
  const lines = $('#ni-text').value.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const cards = [];
  lines.forEach(l=>{
    const parts = l.split(/\t|,| - | – | — |:/);
    if(parts.length >= 2) cards.push(mkCard(parts[0].trim(), parts.slice(1).join(' ').trim()));
  });
  if(!cards.length){ toast('No pairs found — use "term - definition" per line.'); return; }
  const set = { id: uid(), subject: title.split(/[-—–:]/)[0].trim() || 'General', title, color: newColor(), examDate: '', cards };
  store.sets.unshift(set); save(); closeSheet(); openSet(set.id);
  toast(`Imported ${cards.length} cards`);
};
function newColor(){ const cs = ['#3D5A3A','#7A5A38','#5A3A44','#2E4A5A','#8A4A2E']; return cs[store.sets.length % cs.length]; }

/* share */
$('#btn-share').onclick = ()=>{
  const s = store.sets.find(x=>x.id===currentSetId);
  if(!s) return;
  const url = shareUrl(s);
  const write = navigator.clipboard?.writeText(url);
  if(write){ write.then(()=> toast('Share link copied — anyone can open it, no signup')).catch(()=> toast('Copy failed — long-press the link')); }
  else toast(url);
};
$('#btn-import-shared').onclick = ()=>{
  const url = prompt('Paste a shared Recall link:');
  if(url && url.includes('#s=')){ location.href = url; }
  else if(url) toast("That doesn't look like a Recall link");
};

/* settings */
function applySettings(){
  const r = store.settings.retention;
  setRetention(r);
  const sel = $('#set-retention'); if(sel) sel.value = String(r);
  const npd = $('#set-newperday'); if(npd) npd.value = String(store.settings.newPerDay);
  const th = $('#set-theme'); if(th) th.value = store.settings.theme || 'auto';
  document.documentElement.dataset.theme = store.settings.theme || 'auto';
  renderCalibration();
}
function renderCalibration(){
  const block = $('#calibration-block'); if(!block) return;
  const all = store.sets.flatMap(s=>s.cards).flatMap(c=>c.confHistory||[]);
  if(all.length < 5){ block.hidden = true; return; }
  block.hidden = false;
  const sure = all.filter(h=>h.conf===3), guessed = all.filter(h=>h.conf===1);
  const sureAcc = sure.length ? Math.round(sure.filter(h=>h.r>=3).length/sure.length*100) : null;
  const guessAcc = guessed.length ? Math.round(guessed.filter(h=>h.r>=3).length/guessed.length*100) : null;
  let msg = '';
  if(sureAcc !== null && sureAcc < 70) msg = `⚠️ When you felt sure, you were right ${sureAcc}% — overconfident. Trust the algorithm's "Again" more.`;
  else if(guessAcc !== null && guessAcc > 60) msg = `☑ Your "guessed" cards were right ${guessAcc}% — you know more than you think.`;
  else msg = `Calibration looks healthy — your certainty matches your performance.`;
  $('#calibration-readout').innerHTML = `<p style="margin-bottom:6px"><b>${all.length}</b> confidence marks recorded.</p><p>${msg}</p>`;
}
$('#set-theme').addEventListener('change', e=>{
  store.settings.theme = e.target.value;
  document.documentElement.dataset.theme = store.settings.theme;
  save();
});
$('#set-retention').onchange = e=>{
  store.settings.retention = parseFloat(e.target.value);
  save(); setRetention(store.settings.retention);
  toast(`Retention target: ${Math.round(store.settings.retention*100)}%`);
};
$('#set-newperday').onchange = e=>{ store.settings.newPerDay = +e.target.value; save(); };

$('#btn-export').onclick = ()=>{
  const rows = [['set','subject','term','definition','reps','lapses','stability','due']];
  store.sets.forEach(s=>{
    s.cards.forEach(c=>{
      rows.push([s.title, s.subject, c.front.replace(/"/g,'""'), c.back.replace(/"/g,'""'), c.f?.reps||0, c.f?.lapses||0, c.f?.stability||0, c.f?.due? new Date(c.f.due).toISOString() : '']);
    });
  });
  const csv = rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `recall-export-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Export downloaded');
};
$('#btn-reset-streak').onclick = ()=>{
  if(!confirm('Reset your streak to 0?')) return;
  store.streak = { count: 0, lastDate: '' }; save(); renderHome();
  toast('Streak reset');
};
$('#btn-wipe').onclick = ()=>{
  if(!confirm('Erase ALL sets, cards, sessions, and settings?')) return;
  localStorage.removeItem(LS_KEY);
  location.hash = '';
  location.reload();
};

/* keyboard shortcuts */
document.addEventListener('keydown', e=>{
  if(session && session.mode === 'flashcards' && ['1','2','3','4'].includes(e.key) && $('#grade-row') && $('#grade-row').style.pointerEvents === 'auto'){
    const b = $('#grade-row').querySelector(`[data-g="${e.key}"]`);
    if(b) b.click();
  }
  if(e.key === 'Escape'){
    if(!sheet.hidden) closeSheet();
    if(!settingsSheet.hidden) settingsSheet.hidden = true;
    if(!editSheet.hidden) editSheet.hidden = true;
  }
});

/* ---------- boot ---------- */
load();
applySettings();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
addManualRow(); addManualRow(); addManualRow();

const hadShared = renderSharedImport();
renderHome();
show('home');

})();
