/* ============ RECALL — engine + features ============ */
(() => {
'use strict';

/* ---------- persistence ---------- */
const LS_KEY = 'recall_v1';
const store = {
  sets: [],          // {id, title, subject, examDate, cards:[...]}
  sessions: [],      // {date, setId, mode, reviewed, correct}
  streak: { count: 3, lastDate: '' },  // lastDate updated on each session
  activeDays: [],    // ['2026-09-14', ...] for heatmap
};
function bumpStreak(){
  const t = todayStr();
  if(!store.activeDays.includes(t)) store.activeDays.push(t);
  if(store.streak.lastDate !== t){
    const yest = todayStr(new Date(Date.now()-DAY));
    store.streak.count = (store.streak.lastDate === yest) ? store.streak.count+1 : 1;
    store.streak.lastDate = t;
  }
  save();
}
function save(){ localStorage.setItem(LS_KEY, JSON.stringify(store)); }
function load(){
  try{ const raw = localStorage.getItem(LS_KEY); if(raw){ const d=JSON.parse(raw); Object.assign(store, d); store.activeDays = store.activeDays||[]; seedIfEmpty(); return; } }catch(e){}
  seed(); save();
}
function seedIfEmpty(){ if(!store.sets.length){ seed(); save(); } }

const DAY = 86400000;
function todayStr(d){
  const dt = d || new Date();
  const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), day=String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function uid(){ return Math.random().toString(36).slice(2,10); }

/* ---------- FSRS-lite scheduler ---------- */
/* Each card: stab (0..1 strength), due (epoch), lapses, reviews, conf (1-3) */
function grade(card, g){ // g 1=Again 2=Hard 3=Good 4=Easy
  const now = Date.now();
  card.reviews = (card.reviews||0)+1;
  if(g===1){ card.lapses=(card.lapses||0)+1; card.stab = Math.max(0.05, (card.stab||0.5)*0.35); card.due = now + 60000; }      // re-queue 1 min
  else if(g===2){ card.stab = Math.max(0.15, (card.stab||0.5)*0.72); card.due = now + 3*60000; }
  else if(g===3){ card.stab = Math.min(1, (card.stab||0.5)*1.18 + 0.04); card.due = now + (card.stab>0.85 ? DAY : 6*3600000); }
  else { card.stab = Math.min(1, (card.stab||0.5)*1.4 + 0.06); card.due = now + (card.stab>0.9 ? 2*DAY : DAY); }
  save();
}
function retrievability(card){
  const now = Date.now();
  const t = Math.max(0,(now - (card.due - DAY))/DAY); // rough elapsed since last interval anchor
  return Math.pow(0.9, t/Math.max(0.2,(card.stab||0.5)*4)); // decay curve
}
function masteryOf(set){ return Math.round(set.cards.reduce((a,c)=>a+(card_score(c)),0)/set.cards.length*100); }
function card_score(c){ return c.stab==null?0.5:c.stab; }
function dueCards(set){ const now=Date.now(); return set.cards.filter(c=>!c.due || c.due<=now); }
function allDue(){ return store.sets.reduce((n,s)=>n+dueCards(s).length,0); }
function weakest(n){
  const all=[]; store.sets.forEach(s=>s.cards.forEach(c=>all.push({set:s,card:c,p:retrievability(c)})));
  return all.sort((a,b)=>a.p-b.p).slice(0,n);
}

/* ---------- seed data ---------- */
function seed(){
  const mk=(front,back,stab=0.5)=>({id:uid(),front,back,stab,due:Date.now()-Math.random()*DAY,lapses:Math.floor(Math.random()*3),reviews:2+Math.floor(Math.random()*5),conf:2});
  store.sets=[
    {id:uid(),subject:'Biology',title:'Biology — Ch. 4 Cell Structure',color:'#3D5A3A',cards:[
      mk('mitochondria','Organelle that produces ATP through cellular respiration; "powerhouse of the cell"',0.82),
      mk('ribosome','Site of protein synthesis; found free in cytoplasm or bound to rough ER',0.74),
      mk('Golgi apparatus','Modifies, sorts, and packages proteins into vesicles for transport',0.61),
      mk('lysosome','Contains digestive enzymes that break down waste and worn-out organelles',0.45),
      mk('nucleus','Membrane-bound organelle holding DNA; control center of the cell',0.9),
      mk('rough ER','Studded with ribosomes; synthesizes proteins destined for secretion',0.58),
      mk('smooth ER','Synthesizes lipids and detoxifies; lacks ribosomes',0.42),
      mk('cell membrane','Phospholipid bilayer controlling what enters and exits the cell',0.77),
      mk('cytoplasm','Gel-like cytosol plus organelles; site of most metabolic activity',0.66),
      mk('chloroplast','Site of photosynthesis in plant cells; contains chlorophyll',0.84),
      mk('vacuole','Large storage sac; central vacuole maintains turgor pressure in plants',0.39),
      mk('cytoskeleton','Network of protein fibers giving shape, support, and movement',0.5),
    ]},
    {id:uid(),subject:'Spanish',title:'Spanish — Unit 3 IR verbs',color:'#7A5A38',cards:[
      mk('escribir','to write',0.88),
      mk('vivir','to live',0.79),
      mk('abrir','to open',0.56),
      mk('asistir','to attend',0.44),
      mk('decidir','to decide',0.71),
      mk('recibir','to receive',0.62),
      mk('subir','to go up / to climb',0.37),
      mk('discutir','to discuss / to argue',0.29),
    ]},
    {id:uid(),subject:'History',title:'History — Civil War dates',color:'#8A4A2E',cards:[
      mk('1861','Fort Sumter fired upon; Civil War begins',0.68),
      mk('1862','Battle of Antietam — bloodiest single day; enables Emancipation Proclamation',0.52),
      mk('1863','Gettysburg and Vicksburg — turning point of the war',0.74),
      mk('1864','Sherman\'s March to the Sea; total war doctrine',0.46),
      mk('1865','Appomattox surrender; war ends; Lincoln assassinated',0.81),
    ]},
  ];
}

/* ---------- DOM utils ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function show(view){
  $$('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+view));
  window.scrollTo(0,0);
}
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._to); t._to=setTimeout(()=>t.classList.remove('show'),2600);
}

/* ---------- render: HOME ---------- */
function renderHome(){
  const due = allDue();
  $('#today-headline').textContent = due===0 ? 'All caught up' : `${due} card${due===1?'':'s'} due`;
  const firstSet = store.sets.map(s=>({s,pending:dueCards(s).length})).filter(x=>x.pending>0).sort((a,b)=>b.pending-a.pending)[0];
  $('#today-sub').textContent = firstSet ? `${firstSet.s.subject} · ${firstSet.s.title}` : 'Review any set to keep your streak';
  $('#continue-label').textContent = due===0 ? 'Review anyway' : firstSet && firstSet.pending>0 ? `Continue — ${firstSet.s.title}` : 'Start studying';
  $('#stat-due').textContent = due;
  $('#stat-streak').textContent = store.streak.count;
  // retention = average retrievability across all cards
  const allCards = store.sets.flatMap(s=>s.cards);
  const avg = allCards.length? Math.round(allCards.reduce((a,c)=>a+retrievability(c),0)/allCards.length*100) : 0;
  $('#stat-retention').textContent = avg+'%';
  // mastery ring
  const m = store.sets.length? Math.round(store.sets.reduce((a,s)=>a+masteryOf(s),0)/store.sets.length) : 0;
  $('#ring-pct').textContent = m;
  drawRing($('#mastery-ring'), m);
  $('#today-date').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
  // set rows
  const list = $('#sets-list'); list.innerHTML='';
  store.sets.forEach(s=>{
    const pending = dueCards(s).length;
    const row = document.createElement('button');
    row.className='set-row'; row.setAttribute('aria-label', s.title);
    row.innerHTML = `
      <div class="set-chip" style="background:${s.color}1a;color:${s.color};border:1px solid ${s.color}33">${s.title.slice(0,2).toUpperCase()}</div>
      <div class="set-info">
        <div class="set-name">${esc(s.title)}</div>
        <div class="set-detail">${s.cards.length} cards · ${masteryOf(s)}% mastery</div>
      </div>
      ${pending>0?`<span class="set-due">${pending} due</span>`:`<span class="set-due zero">done</span>`}`;
    row.onclick=()=>{ openSet(s.id); };
    list.appendChild(row);
  });
  // weakest
  const wl = $('#weakest-list'); wl.innerHTML='';
  weakest(4).forEach(({set,card,p})=>{
    const r=document.createElement('div'); r.className='weak-row';
    r.innerHTML=`<span class="weak-term">${esc(card.front)}</span><span class="weak-set">${esc(set.subject)}</span><div class="weak-meter"><i style="width:${Math.round(p*100)}%"></i></div>`;
    r.onclick=()=>{ openSet(set.id); startSession(set.id,'flashcards'); };
    r.style.cursor='pointer';
    wl.appendChild(r);
  });
  renderHeatmap();
}

function renderHeatmap(){
  const hm=$('#heatmap'); hm.innerHTML='';
  const today=new Date(); today.setHours(0,0,0,0);
  const weeks=12;
  const todayDow=(today.getDay()+6)%7; // Mon=0..Sun=6
  const counts={};
  store.sessions.forEach(s=>{ counts[s.date]=(counts[s.date]||0)+(s.reviewed||0); });
  for(let w=weeks-1;w>=0;w--){
    for(let d=0;d<7;d++){
      const dt=new Date(today);
      dt.setDate(dt.getDate() - (w*7 + (todayDow-d)));
      const key=todayStr(dt);
      const c=counts[key]||0;
      const cell=document.createElement('div');
      cell.className='hm-cell'+(c===0?'':c<10?' l1':c<25?' l2':c<50?' l3':' l4');
      if(key===todayStr()) cell.classList.add('today');
      cell.title=`${key}: ${c} cards reviewed`;
      if(dt>today) cell.style.visibility='hidden';
      hm.appendChild(cell);
    }
  }
}

function drawRing(svg, pct){
  const C=2*Math.PI*50;
  svg.innerHTML=`
    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line-soft)" stroke-width="8"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--acc)" stroke-width="8"
      stroke-linecap="round" stroke-dasharray="${(pct/100*C).toFixed(1)} ${C.toFixed(1)}"
      style="transition:stroke-dasharray 800ms cubic-bezier(.3,.7,.3,1)"/>
    ${Array.from({length:12},(_,i)=>{
      const a=i/12*Math.PI*2 - Math.PI/2;
      const major = i%3===0;
      const r1=44, r2=major?37.5:41.5;
      return `<line x1="${(60+Math.cos(a)*r1).toFixed(1)}" y1="${(60+Math.sin(a)*r1).toFixed(1)}" x2="${(60+Math.cos(a)*r2).toFixed(1)}" y2="${(60+Math.sin(a)*r2).toFixed(1)}" stroke="var(--line)" stroke-width="${major?2:1}" opacity="${major?0.9:0.5}"/>`;
    }).join('')}
  `;
}

/* ---------- SET DETAIL ---------- */
let currentSetId=null;
function openSet(id){
  currentSetId=id;
  const s=store.sets.find(x=>x.id===id); if(!s)return show('home');
  $('#set-title').textContent = s.title;
  $('#set-meta').innerHTML=`
    <span class="meta-pill"><b>${s.cards.length}</b> cards</span>
    <span class="meta-pill"><b>${masteryOf(s)}%</b> mastery</span>
    <span class="meta-pill"><b>${dueCards(s).length}</b> due</span>`;
  // exam date
  const examInput=$('#exam-date'), pill=$('#exam-pill');
  examInput.value = s.examDate||'';
  examInput.onchange=()=>{ s.examDate = examInput.value; save(); updateExamPill(s,pill); };
  updateExamPill(s,pill);
  $('#card-count').textContent=`${s.cards.length} total`;
  const cl=$('#card-list'); cl.innerHTML='';
  s.cards.forEach(c=>{
    const stab = c.stab==null?0.5:c.stab;
    const dotColor = stab>=0.75?'var(--good)':stab>=0.45?'var(--hard)':'var(--bad)';
    const row=document.createElement('div'); row.className='card-row';
    row.innerHTML=`
      <div class="card-side"><span class="lab">Term</span><div class="txt">${esc(c.front)}</div></div>
      <div class="card-side"><span class="lab">Answer</span><div class="txt">${esc(c.back)}</div></div>
      <div class="card-stab"><span class="stab-dot" style="background:${dotColor}" title="strength"></span><span style="font-size:10px;color:var(--muted);font-family:var(--f-mono)">${Math.round(stab*100)}%</span></div>`;
    cl.appendChild(row);
  });
  show('set');
}

function updateExamPill(s, pill){
  if(!s.examDate){ pill.hidden=true; return; }
  const exam=new Date(s.examDate+'T12:00:00');
  const days=Math.ceil((exam - Date.now())/DAY);
  if(days<0){ pill.hidden=false; pill.textContent='Exam passed — time to review for the final'; pill.style.color='var(--muted)'; return; }
  const unm = s.cards.filter(c=>(c.stab==null?0.5:c.stab)<0.8).length;
  const per = days>0 ? Math.ceil(unm/days) : unm;
  pill.hidden=false;
  pill.style.color='';
  pill.textContent = `${days} day${days===1?'':'s'} · ${per} cards/day to master`;
}

/* ---------- STUDY SESSION ---------- */
let session=null; // {setId, mode, queue, idx, correct, reviewed, startTime}
const modes=['flashcards','learn','test','match'];

document.addEventListener('click', e=>{
  const mc=e.target.closest('.mode-card');
  if(mc){ startSession(currentSetId, mc.dataset.mode); }
});
$('#btn-continue').onclick=()=>{
  const top = store.sets.map(s=>({s,pending:dueCards(s).length})).filter(x=>x.pending>0).sort((a,b)=>b.pending-a.pending)[0];
  const target = top? top.s : store.sets[0];
  openSet(target.id);
  startSession(target.id,'flashcards');
};
$('#btn-exit-study').onclick=()=>{ if(session){ finishSession(true); } };

function startSession(setId, mode){
  const s=store.sets.find(x=>x.id===setId); if(!s)return;
  let cards = mode==='flashcards'||mode==='learn' ? dueCards(s) : s.cards.slice();
  if(!cards.length){ cards = s.cards.slice(); toast('No cards due — reviewing all anyway'); }
  shuffle(cards);
  session={setId, mode, queue:cards, idx:0, correct:0, reviewed:0, answered:new Map(), mistakes:[], paired:new Set(), matchedCount:0};
  show('study');
  renderStudy();
}

function renderStudy(){
  const s = store.sets.find(x=>x.id===session.setId);
  const {mode, queue, idx} = session;
  $('#study-progress').style.width = `${(idx/queue.length*100)}%`;
  $('#study-count').textContent=`${Math.min(idx+1,queue.length)}/${queue.length}`;
  const stage=$('#study-stage'); stage.innerHTML='';
  if(mode==='flashcards') renderFlashcard(stage, s, queue[idx]);
  else if(mode==='learn') renderLearn(stage, s, queue[idx]);
  else if(mode==='test') renderTestQ(stage, s, queue[idx]);
  else if(mode==='match') renderMatch(stage, s);
}

/* ----- flashcards ----- */
function renderFlashcard(stage, s, card){
  stage.innerHTML=`
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
  const fc=$('#fc-card'), gr=$('#grade-row');
  fc.onclick=()=>{ fc.classList.add('flipped'); gr.style.opacity=1; gr.style.pointerEvents='auto'; };
  fc.onkeydown=e=>{ if(e.key===' '||e.key==='Enter'){e.preventDefault();fc.click();} };
  gr.querySelectorAll('.grade-btn').forEach(b=>{
    b.onclick=()=>{
      const g=+b.dataset.g;
      grade(card,g);
      session.reviewed++; if(g>=3)session.correct++;
      nextCard();
    };
  });
}

/* ----- learn (typed) ----- */
function renderLearn(stage, s, card){
  stage.innerHTML=`
    <div class="learn-q">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">${esc(s.subject)}</div>
      <h2>${esc(card.front)}</h2>
      <form class="learn-form" id="learn-form">
        <input class="learn-input" id="learn-input" type="text" placeholder="Type your answer…" autocomplete="off" autocapitalize="off" spellcheck="false"/>
        <button type="submit" class="btn-primary full">Check</button>
      </form>
      <div class="learn-verdict" id="learn-verdict"></div>
    </div>`;
  const inp=$('#learn-input'), vf=$('#learn-verdict');
  inp.focus();
  $('#learn-form').onsubmit=e=>{
    e.preventDefault();
    const got = normalize(inp.value), want = normalize(card.back);
    const ok = fuzzyMatch(got, want);
    session.reviewed++;
    if(ok){
      session.correct++; grade(card,3);
      vf.className='learn-verdict ok'; vf.textContent='Correct — well recalled.';
      setTimeout(nextCard,900);
    } else {
      session.mistakes.push(card);
      grade(card,1);
      vf.className='learn-verdict no'; vf.innerHTML=`Not quite — <b>${esc(card.back)}</b>. It'll come back around.`;
      inp.classList.add('shake'); setTimeout(()=>inp.classList.remove('shake'),450);
      setTimeout(nextCard,1700);
    }
  };
}

/* ----- test (MC/TF/match mix, graded at end) ----- */
function renderTestQ(stage, s, card){
  const kindRoll = Math.random();
  const kind = kindRoll<0.55 ? 'mc' : kindRoll<0.8 ? 'tf' : 'written';
  let html = `<div class="test-q"><span class="kind">${kind==='mc'?'Multiple choice':kind==='tf'?'True or false':'Written'}</span><h3>${esc(card.front)}</h3>`;
  if(kind==='mc'){
    const options = buildDistractors(s, card);
    options.forEach((opt,i)=>{ html+=`<button class="opt" data-val="${esc(opt)}"><span class="radio"></span>${esc(opt)}</button>`; });
    stage.innerHTML=html;
    stage.querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ answerTest(card, o.dataset.val, o.dataset.val===card.back); }; });
  } else if(kind==='tf'){
    const showCorrect = Math.random()<0.55;
    const stmt = showCorrect ? card.back : buildWrongStmt(s, card);
    html+=`<p style="font-size:15px;color:var(--ink-soft);margin-bottom:14px">${esc(stmt)}</p>`;
    html+=`<button class="opt" data-v="t"><span class="radio"></span>True</button><button class="opt" data-v="f"><span class="radio"></span>False</button>`;
    stage.innerHTML=html;
    stage.querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ const pick=o.dataset.v==='t'; answerTest(card, pick, pick===showCorrect); }; });
  } else {
    html+=`<form id="test-written" class="learn-form"><input class="learn-input" id="test-inp" placeholder="Your answer…" autocomplete="off"/><button type="submit" class="btn-primary full">Check</button></form>`;
    stage.innerHTML=html; $('#test-inp').focus();
    $('#test-written').onsubmit=e=>{ e.preventDefault(); const ok=fuzzyMatch(normalize($('#test-inp').value),normalize(card.back)); answerTest(card,$('#test-inp').value,ok); };
  }
}

function answerTest(card, given, ok){
  session.reviewed++; if(ok)session.correct++;
  grade(card, ok?3:1);
  const opts = $$('.opt');
  opts.forEach(o=>{ o.style.pointerEvents='none'; if(normalize(o.textContent)===normalize(String(card.back))){ o.style.background='var(--acc-tint)'; o.style.borderColor='var(--acc-line)'; o.style.color='var(--acc-ink)'; } });
  if(!ok){ setTimeout(nextCard,1400); } else { setTimeout(nextCard,700); }
}

/* ----- match game ----- */
function renderMatch(stage, s){
  const pool = s.cards.slice(0, Math.min(6, s.cards.length));
  shuffle(pool);
  const items=[];
  pool.forEach((c,i)=>{ items.push({key:i, txt:c.front, side:'q'}); items.push({key:i, txt:c.back, side:'a'}); });
  shuffle(items);
  const start = Date.now();
  let picks=[];
  stage.innerHTML=`<div class="match-head"><span class="score" id="match-count">0/${pool.length} matched</span><span class="time" id="match-time">0.0s</span></div><div class="match-board">${items.map(i=>`<button class="match-tile" data-k="${i.key}" data-side="${i.side}">${esc(i.txt)}</button>`).join('')}</div>`;
  const timer = setInterval(()=>{ $('#match-time').textContent=((Date.now()-start)/1000).toFixed(1)+'s'; },100);
  stage.querySelectorAll('.match-tile').forEach(t=>{
    t.onclick=()=>{
      if(t.classList.contains('done'))return;
      if(t.classList.contains('sel')){ t.classList.remove('sel'); picks=picks.filter(x=>x!==t); return; }
      t.classList.add('sel'); picks.push(t);
      if(picks.length===2){
        const [a,b]=picks;
        const k1=+a.dataset.k, k2=+b.dataset.k;
        const matchOk = k1===k2 && a.dataset.side!==b.dataset.side;
        setTimeout(()=>{
          if(matchOk){
            [a,b].forEach(x=>{x.classList.add('done');x.classList.remove('sel');});
            session.matchedCount++; $('#match-count').textContent=`${session.matchedCount}/${pool.length} matched`;
            if(session.matchedCount===pool.length){
              clearInterval(timer);
              session.reviewed=pool.length; session.correct=pool.length; // counts as full pass
              setTimeout(()=>finishSession(false,(Date.now()-start)),700);
            }
          } else {
            [a,b].forEach(x=>{x.classList.add('err'); setTimeout(()=>x.classList.remove('sel','err'),400);});
          }
          picks=[];
        },180);
      }
    };
  });
}

function nextCard(){
  session.idx++;
  if(session.idx >= session.queue.length){ finishSession(false); return; }
  renderStudy();
}

function finishSession(cancelled, matchTime){
  const s=store.sets.find(x=>x.id===session.setId);
  if(session.reviewed===0 && cancelled){ show('set'); session=null; return; }
  const pct = session.reviewed?Math.round(session.correct/session.reviewed*100):0;
  store.sessions.push({date:todayStr(), setId:session.setId, mode:session.mode, reviewed:session.reviewed, correct:session.correct});
  bumpStreak();
  save();
  renderHome();
  const sb=$('#summary-body');
  sb.innerHTML=`
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
  $('#sum-again').onclick=()=>startSession(session.setId, session.mode);
  $('#sum-home').onclick=()=>{ session=null; show('home'); };
}

/* ---------- AI-lite generation from pasted text ---------- */
function generateFromText(title, text){
  const lines = text.split(/\n+/).map(l=>l.trim()).filter(l=>l.length>3);
  const cards=[];
  const seen=new Set();
  for(const line of lines){
    if(cards.length>=25) break;
    // patterns: "term - def", "term: def", "term — def", sentence with "is/are/means/refers to"
    let m = line.match(/^(.{2,60}?)\s*[-–—:]\s+(.{4,})$/);
    if(!m){ m = line.match(/^(.{2,50}?)\s+(?:is|are|means|refers to|consists of)\s+(.{6,})$/i); }
    if(m){
      const front=m[1].trim(), back=m[2].trim();
      const key=front.toLowerCase();
      if(!seen.has(key)){ seen.add(key); cards.push(mkCard(front,back)); }
    } else if(line.includes(' ') && line.length<140 && /^[A-Z0-9]/.test(line) && cards.length<12){
      // vocab line: split at first em-space or first 2-word group
      const w = line.split(/\s{2,}|\t/);
      if(w.length>=2 && w[0].length<40 && !seen.has(w[0].toLowerCase())){ seen.add(w[0].toLowerCase()); cards.push(mkCard(w[0],w.slice(1).join(' '))); }
    }
  }
  return cards;
}
function mkCard(front,back){ return {id:uid(),front,back,stab:0.5,due:Date.now(),lapses:0,reviews:0,conf:2}; }

/* ---------- helpers ---------- */
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function normalize(s){ return String(s).toLowerCase().replace(/[\u2018\u2019']/g,"'").replace(/[^a-z0-9\s]/g,'').replace(/\b(the|a|an|of|in|on|to|for|and|or)\b/g,'').replace(/\s+/g,' ').trim(); }
function fuzzyMatch(a,b){ if(!a||!b) return false; if(a===b) return true; const wa=new Set(a.split(' ')), wb=new Set(b.split(' ')); let hit=0; for(const t of wa) if(wb.has(t)) hit++; return hit/Math.max(wa.size,wb.size) >= 0.6; }
function buildDistractors(s, card){
  const others = s.cards.filter(c=>c.id!==card.id).map(c=>c.back);
  shuffle(others);
  const ds = [card.back];
  for(const o of others){ if(ds.length<4){ ds.push(o); } if(ds.length===4)break; }
  shuffle(ds); return ds;
}
function buildWrongStmt(s, card){
  const others = s.cards.filter(c=>c.id!==card.id);
  if(!others.length) return card.back;
  return others[Math.floor(Math.random()*others.length)].back;
}

/* ---------- NEW SET sheet ---------- */
const sheet=$('#sheet-newset');
function openSheet(){ sheet.hidden=false; switchTab('paste'); }
function closeSheet(){ sheet.hidden=true; }
$('#btn-new-set').onclick=openSheet;
sheet.addEventListener('click',e=>{ if(e.target===sheet || e.target.closest('[data-close-sheet]')) closeSheet(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !sheet.hidden) closeSheet(); });

$('#newset-tabs').addEventListener('click',e=>{
  const b=e.target.closest('.seg-btn'); if(!b)return; switchTab(b.dataset.tab);
});
function switchTab(t){
  $$('#newset-tabs .seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
  $('#tab-paste').classList.toggle('active',t==='paste');
  $('#tab-manual').classList.toggle('active',t==='manual');
  $('#tab-import').classList.toggle('active',t==='import');
}

// manual rows
function addManualRow(front='',back=''){
  const wrap = $('#manual-rows');
  const row = document.createElement('div'); row.className='mrow';
  row.innerHTML=`<input placeholder="Term" value="${esc(front)}"/><input placeholder="Definition" value="${esc(back)}"/>`;
  wrap.appendChild(row);
  row.children[0].focus();
}
$('#btn-add-row').onclick=()=>addManualRow();

$('#btn-generate').onclick=()=>{
  const title=$('#np-title').value.trim()||'Untitled set';
  const text=$('#np-text').value;
  const cards = generateFromText(title, text);
  if(!cards.length){ toast('Couldn\'t find term–definition pairs. Try "term - definition" lines.'); return; }
  const subject = title.split(/[-—–:]/)[0].trim()||'General';
  const set={id:uid(),subject,title,color:newColor(),cards};
  store.sets.unshift(set); save();
  closeSheet(); openSet(set.id);
  toast(`${cards.length} cards generated`);
};
$('#btn-save-manual').onclick=()=>{
  const title=$('#nm-title').value.trim()||'Untitled set';
  const rows=$$('#manual-rows .mrow');
  const cards=[];
  rows.forEach(r=>{ const f=r.children[0].value.trim(), b=r.children[1].value.trim(); if(f&&b) cards.push(mkCard(f,b)); });
  if(!cards.length){ toast('Add at least one card first.'); return; }
  const set={id:uid(),subject:title.split(/[-—–:]/)[0].trim()||'General',title,color:newColor(),cards};
  store.sets.unshift(set); save(); closeSheet(); openSet(set.id);
  toast(`Saved ${cards.length} cards`);
};
$('#btn-import').onclick=()=>{
  const title=$('#ni-title').value.trim()||'Imported set';
  const lines=$('#ni-text').value.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  const cards=[];
  lines.forEach(l=>{
    const parts=l.split(/\t|,| - | – | — |:/);
    if(parts.length>=2){ cards.push(mkCard(parts[0].trim(), parts.slice(1).join(' ').trim())); }
  });
  if(!cards.length){ toast('No pairs found — use "term, definition" or "term - definition" per line.'); return; }
  const set={id:uid(),subject:title.split(/[-—–:]/)[0].trim()||'General',title,color:newColor(),cards};
  store.sets.unshift(set); save(); closeSheet(); openSet(set.id);
  toast(`Imported ${cards.length} cards`);
};
function newColor(){ const cs=['#3D5A3A','#7A5A38','#5A3A44','#2E4A5A','#8A4A2E']; return cs[store.sets.length % cs.length]; }

$('#btn-share').onclick=()=>{
  const s=store.sets.find(x=>x.id===currentSetId); if(!s)return;
  const txt = s.cards.map(c=>`${c.front} - ${c.back}`).join('\n');
  navigator.clipboard?.writeText(txt).then(()=>toast('Set copied — paste anywhere to share')).catch(()=>toast('Copy failed'));
};

// keyboard shortcuts for flashcards
document.addEventListener('keydown',e=>{
  if(session && session.mode==='flashcards' && ['1','2','3','4'].includes(e.key) && $('#grade-row') && $('#grade-row').style.pointerEvents==='auto'){
    const b=$('#grade-row').querySelector(`[data-g="${e.key}"]`); if(b)b.click();
  }
});

/* ---------- boot ---------- */
$('#btn-settings').onclick=()=>toast('Settings coming soon — streaks reset, export soon');
load();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
addManualRow(); addManualRow(); addManualRow();
renderHome();
show('home');

})();
