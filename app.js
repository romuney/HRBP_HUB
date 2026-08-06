/* ===== HRBP HUB — логика прототипа ===== */
const D=window.HRBPDATA, CH=window.HRBPCHARTS;
const state={
  tab:'onepager',          // onepager | teams | transformer | catalog
  hrbpId:'anna',
  teamFilter:null,         // path из фильтра «Команда зоны» (зона HRBP + −1) | null = вся зона
  fullUnit:null,           // path из фильтра «Все юниты (вся глубина)» | null. Переопределяет зону.
  focusOnly:false,         // глобальный тоггл «Только фокусные юниты» (популяция = union листьев корневых фокусных)
  bench:'company',
  hq:'all',                // all | hq | nonhq  (фильтр HQ / non-HQ)
  seg:'all',               // all | IT | nonIT  (фильтр типа направления)
  metricSel:new Set(D.METRICS.map(m=>m.key)), // выбранные метрики (по умолчанию все) — глобальный фокус
  metricOpen:false,        // развёрнут ли чеклист метрик на полке
  blockTab:'retention',    // под-вкладка «Команды» = логический блок OnePager
  teamSub:'focus',         // под-вкладка «Команды»: focus (фокусные юниты) | level1 (уровень −1)
  selTeam:null,            // выбранная команда (динамика справа)
  openMetric:null,         // раскрытая метрика в OnePager
  tf:{mode:'dyn', cut:'IT / nonIT', metric:'regret'}
};
// активный фокусный узел: «Все юниты» переопределяют фильтр зоны
function focusPath(){return state.fullUnit||state.teamFilter||null}
const charts={}; // id -> echarts instance
function mkChart(id,opt){if(charts[id]){charts[id].dispose()}const el=document.getElementById(id);if(!el)return;const c=echarts.init(el);c.setOption(opt);charts[id]=c;return c}
function disposeCharts(){Object.values(charts).forEach(c=>c.dispose());for(const k in charts)delete charts[k]}
window.addEventListener('resize',()=>{Object.values(charts).forEach(c=>c.resize())});

/* ---- информация по фокусным юнитам зоны (union листьев + корневые), с учётом фильтра команды ---- */
function focusInfo(){return D.focusLeafUnion(state.hrbpId,focusPath());}

/* ---- базовый набор листьев (до атрибутов) ----
   focusOnly → union листьев КОРНЕВЫХ фокусных юнитов зоны (дедуп вложенных), пересечённый с фильтром команды.
   иначе: fullUnit (вся глубина) игнорирует зону HRBP; либо зона, суженная фильтром команды. */
function baseLeaves(){
  if(state.focusOnly)return focusInfo().leaves;
  if(state.fullUnit)return D.leavesUnder(state.fullUnit).map(l=>l.path);
  let all=D.scopeLeaves(state.hrbpId);
  if(state.teamFilter){
    const set=new Set(D.leavesUnder(state.teamFilter).map(l=>l.path));
    all=all.filter(p=>set.has(p));
  }
  return all;
}
/* ---- эффективный набор листьев = baseLeaves + атрибуты HQ/segment ---- */
function effectiveLeaves(){
  return baseLeaves().filter(p=>D.leafPassesAttr(p,state.hq,state.seg));
}
function populationLabel(){
  if(state.fullUnit)return D.NODE_BY_PATH[state.fullUnit].name+' (вся глубина)';
  if(state.teamFilter)return D.NODE_BY_PATH[state.teamFilter].name;
  return D.zoneLabel(state.hrbpId);
}
// краткое описание состояния глобального фокус-фильтра
function focusSummary(){
  if(!state.focusOnly)return'';
  const fi=focusInfo();
  return ' · фокусные: '+fi.roots.length+' корневых';
}
// краткое описание активных фильтров полки (для подзаголовков листов)
function filterSummary(){
  const parts=[];
  if(state.hq==='hq')parts.push('HQ');else if(state.hq==='nonhq')parts.push('non-HQ');
  if(state.seg==='IT')parts.push('IT');else if(state.seg==='nonIT')parts.push('nonIT');
  return parts.length?(' · фильтр: '+parts.join(' + ')):'';
}

/* ---- агрегаты по произвольному набору листьев ---- */
function aggLeaves(leafPaths,metricKey){
  const out=new Array(D.N).fill(0);
  if(metricKey==='headcount'){for(let i=0;i<D.N;i++)out[i]=leafPaths.reduce((s,p)=>s+D.metricSeries(p,'headcount')[i],0);return out}
  for(let i=0;i<D.N;i++){let num=0,den=0;leafPaths.forEach(p=>{const w=D.metricSeries(p,'headcount')[i];num+=D.metricSeries(p,metricKey)[i]*w;den+=w});out[i]=den?+(num/den).toFixed(1):0}
  return out;
}
function scopeSeries(metricKey){return aggLeaves(effectiveLeaves(),metricKey)}

/* ---- глобальный фильтр метрик ---- */
function selMetricsOfBlock(blockKey){return D.metricsOfBlock(blockKey).filter(m=>state.metricSel.has(m.key))}
function anySelInBlock(blockKey){return D.metricsOfBlock(blockKey).some(m=>state.metricSel.has(m.key))}
function selMetrics(){return D.METRICS.filter(m=>state.metricSel.has(m.key))}

/* ---- классы дельт по «направлению лучше» ---- */
function deltaClass(metricKey,v){
  const m=D.METRIC_BY_KEY[metricKey];
  if(v===0)return'flat';
  if(m.better==='flat')return'neu-up';
  const good=(m.better==='lower'&&v<0)||(m.better==='higher'&&v>0);
  return good?'up':'down';
}
function arrow(v){return v>0?'↑':(v<0?'↓':'→')}
function emptyNote(){
  return `<div class="note-inline">По выбранным фильтрам (${state.hq==='all'&&state.seg==='all'?'—':[state.hq!=='all'?state.hq:'',state.seg!=='all'?state.seg:''].filter(Boolean).join(' + ')}) нет ни одной команды в зоне видимости. Снимите часть фильтров на левой полке.</div>`;
}

/* ================= ВЫПАДАЮЩИЕ СПИСКИ ФИЛЬТРОВ ================= */
// Фильтр «Команда зоны»: верхние узлы зоны HRBP + их прямые дети (уровень −1). Ограничен зоной.
function teamOptionsHTML(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const rootSet=new Set(h.scope);
  const nodes=D.teamFilterNodes(state.hrbpId);
  let html=`<option value="">— Вся зона HRBP —</option>`;
  nodes.forEach(n=>{
    const ind=rootSet.has(n.path)?'':'\u00A0\u00A0';
    html+=`<option value="${n.path}" ${n.path===state.teamFilter?'selected':''}>${ind}${n.name}</option>`;
  });
  return html;
}
// Фильтр «Все юниты компании»: ВСЁ дерево на любую глубину (не ограничен зоной).
function fullOptionsHTML(){
  let html=`<option value="">— Вся компания (вся глубина) —</option>`;
  D.NODES.filter(n=>n.path!=='T').slice().sort((a,b)=>a.sort-b.sort).forEach(n=>{
    const ind='\u00A0\u00A0'.repeat(Math.max(0,n.level-2)); // корень=1, блоки=2 — блоки без отступа
    const foc=n.is_focus?' ★':'';
    html+=`<option value="${n.path}" ${n.path===state.fullUnit?'selected':''}>${ind}${n.name}${foc}</option>`;
  });
  return html;
}
// HRBP-селектор, сгруппированный по роли (Senior / Middle / Junior)
function hrbpOptionsHTML(){
  const roles=[['Senior','Senior HRBP'],['Middle','Middle HRBP'],['Junior','Junior HRBP']];
  return roles.map(([rk,rl])=>{
    const items=D.HRBP.filter(h=>h.role===rk);
    if(!items.length)return'';
    const sub=id=>{const c=D.hrbpSubordinateCount(id);return c?` (⊳${c})`:''};
    return `<optgroup label="${rl}">`+items.map(h=>`<option value="${h.id}" ${h.id===state.hrbpId?'selected':''}>${h.name}${sub(h.id)}</option>`).join('')+`</optgroup>`;
  }).join('');
}

/* ================= ЛЕВАЯ ПОЛКА ФИЛЬТРОВ (всё — выпадашки) ================= */
function renderShelf(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const opt=(arr,val,k,l)=>arr.map(o=>`<option value="${o[k]}" ${o[k]===val?'selected':''}>${o[l]}</option>`).join('');
  const fi=focusInfo();
  const focCntZone=D.focusNodesInZone(state.hrbpId).length;
  const focHint=state.focusOnly
    ? `${fi.roots.length} корневых · ${fi.leaves.length} юнитов в популяции`
    : `в зоне ${focCntZone} фокусных · юниты с выставленным KPI`;
  let mlist='';
  D.BLOCKS.forEach(b=>{
    mlist+=`<div class="mf-blk">${b.name}</div>`;
    D.metricsOfBlock(b.key).forEach(m=>{
      const on=state.metricSel.has(m.key);
      mlist+=`<label class="mf-item" title="${m.name}"><input type="checkbox" data-metric="${m.key}" ${on?'checked':''}><span>${m.short}</span></label>`;
    });
  });
  const total=D.METRICS.length, sel=state.metricSel.size;
  const caret=state.metricOpen?'&#9650;':'&#9660;';
  document.getElementById('shelf').innerHTML=`
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>HRBP</div>
      <div class="ctl"><select id="hrbpSel">${hrbpOptionsHTML()}</select></div>
      <div class="role-row"><span class="role-chip role-${h.role}">● ${h.role} HRBP · ⊳ ${D.hrbpSubordinateCount(state.hrbpId)} в подч.</span></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Фокусные юниты</div>
      <label class="focus-toggle ${state.focusOnly?'on':''}" for="focusToggle">
        <input type="checkbox" id="focusToggle" ${state.focusOnly?'checked':''}>
        <span class="ft-track"><span class="ft-knob"></span></span>
        <span class="ft-txt">Только фокусные</span>
      </label>
      <div class="ft-hint">${focHint}</div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Команда зоны · −1</div>
      <div class="ctl"><select id="teamSel">${teamOptionsHTML()}</select></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Все юниты · вся глубина</div>
      <div class="ctl"><select id="fullSel">${fullOptionsHTML()}</select></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Сравнение</div>
      <div class="ctl"><select id="benchSel">${opt(D.BENCHMARKS,state.bench,'key','name')}</select></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Головной офис</div>
      <div class="ctl"><select id="hqSel"><option value="all" ${state.hq==='all'?'selected':''}>Все</option><option value="hq" ${state.hq==='hq'?'selected':''}>Только HQ</option><option value="nonhq" ${state.hq==='nonhq'?'selected':''}>Только non-HQ</option></select></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Тип направления</div>
      <div class="ctl"><select id="segSel"><option value="all" ${state.seg==='all'?'selected':''}>Все</option><option value="IT" ${state.seg==='IT'?'selected':''}>Только IT</option><option value="nonIT" ${state.seg==='nonIT'?'selected':''}>Только nonIT</option></select></div>
    </div>
    <div class="shelf-grp">
      <div class="shelf-h"><span class="dot-acc"></span>Метрики в фокусе</div>
      <button class="mf-toggle" id="mfToggle"><span>${sel} из ${total} метрик</span><span class="mf-caret">${caret}</span></button>
      <div class="mf-drop ${state.metricOpen?'':'hidden'}">
        <div class="mf-actions"><button id="mfAll">Все</button><button id="mfNone">Снять все</button></div>
        <div class="metricfilter">${mlist}</div>
      </div>
    </div>`;
  document.getElementById('hrbpSel').onchange=e=>{state.hrbpId=e.target.value;state.teamFilter=null;state.fullUnit=null;state.selTeam=null;state.openMetric=null;rerender()};
  document.getElementById('focusToggle').onchange=e=>{state.focusOnly=e.target.checked;state.selTeam=null;state.openMetric=null;rerender()};
  document.getElementById('teamSel').onchange=e=>{state.teamFilter=e.target.value||null;state.fullUnit=null;state.selTeam=null;state.openMetric=null;rerender()};
  document.getElementById('fullSel').onchange=e=>{state.fullUnit=e.target.value||null;state.teamFilter=null;state.selTeam=null;state.openMetric=null;rerender()};
  document.getElementById('benchSel').onchange=e=>{state.bench=e.target.value;rerender()};
  document.getElementById('hqSel').onchange=e=>{state.hq=e.target.value;state.selTeam=null;rerender()};
  document.getElementById('segSel').onchange=e=>{state.seg=e.target.value;state.selTeam=null;rerender()};
  document.getElementById('mfToggle').onclick=()=>{state.metricOpen=!state.metricOpen;renderShelf()};
  document.querySelectorAll('.mf-item input').forEach(c=>c.onchange=()=>{const k=c.getAttribute('data-metric');if(c.checked)state.metricSel.add(k);else state.metricSel.delete(k);rerender()});
  document.getElementById('mfAll').onclick=()=>{D.METRICS.forEach(m=>state.metricSel.add(m.key));rerender()};
  document.getElementById('mfNone').onclick=()=>{state.metricSel.clear();rerender()};
}

/* ---- БЕЙЗЛАЙН-ПОДСВЕТКА (результат сравнения) ---- */
function isFocusMetric(m){const p=focusPath();return p?(D.teamFocus(p)[m.key]!=null):false}
function benchName(){return D.BENCHMARKS.find(b=>b.key===state.bench).name}
function resolveBaseline(m,val){
  const path=focusPath();
  if(path){
    const f=D.teamFocus(path);
    if(f[m.key]){return {kind:'kpi',isFocus:true,state:D.stateFor(m.key,val,f[m.key]),kpi:f[m.key]};}
  }
  if(state.bench!=='none' && m.fmt!=='int'){
    const bv=D.benchValue(state.bench,m.key);
    if(bv!=null)return {kind:'bench',isFocus:false,state:D.compareState(m.key,val,bv),baseVal:bv};
  }
  return {kind:'none',isFocus:false,state:'neutral'};
}
function cmpCell(m,val,b){
  const dcl=b.state==='good'?'pos':(b.state==='bad'?'neg':'neu');
  if(b.kind==='kpi'){
    const dir=m.better==='higher'?'≥':'≤';
    const diff=+(val-b.kpi.green).toFixed(1);
    return `<span class="cmp-tag">KPI команды</span>`
      +`<div class="cmp-base">цель ${dir} ${D.fmtVal(m.key,b.kpi.green)}</div>`
      +`<span class="cmp-d ${dcl}">${arrow(diff)} ${D.fmtDelta(m.key,diff)} к цели</span>`;
  }
  if(b.kind==='bench'){
    const diff=+(val-b.baseVal).toFixed(1);
    return `<div class="cmp-base">${D.fmtVal(m.key,b.baseVal)}</div>`
      +`<span class="cmp-d ${dcl}">${arrow(diff)} ${D.fmtDelta(m.key,diff)}</span>`;
  }
  return `<span class="cmp-empty">${m.fmt==='int'?'не сравнивается':(state.bench==='none'?'сравнение выкл.':'нет данных')}</span>`;
}

/* ================= ВКЛАДКА: ONEPAGER ================= */
function renderOnePager(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const leaves=effectiveLeaves();
  const people=aggLeaves(leaves,'headcount')[D.LAST];
  const bN=benchName();

  const fi=state.focusOnly?focusInfo():null;
  let html=`
  <div class="page-h"><h1>HRBP HUB · OnePager</h1>
    <p>${state.focusOnly?'<b>Только фокусные юниты.</b> ':''}Сводка по популяции${focusPath()?' ('+populationLabel()+')':''}${focusSummary()}${filterSummary()}. ${h.note}</p></div>
  <div class="scope-strip">
    <div class="kpi"><div class="k-label">Команд (листьев) в популяции</div>
      <div class="k-val">${leaves.length}</div><div class="k-sub">${state.focusOnly?('union '+fi.roots.length+' корневых фокусных (вложенные не задвоены)'):(focusPath()?'внутри выбранного юнита':'вся зона ответственности')}</div></div>
    <div class="kpi"><div class="k-label">Сотрудников в популяции</div>
      <div class="k-val">${D.fmtInt(people)}</div><div class="k-sub">на конец периода (июнь 2026)</div></div>
    <div class="kpi"><div class="k-label">Зона видимости</div>
      <div class="k-val" style="font-size:19px;line-height:1.3">${h.role==='Senior'?'Все юниты':(h.role==='Middle'?'Свои + менти':'Только свои')}</div>
      <div class="k-sub">${populationLabel()}</div></div>
    <div class="kpi"><div class="k-label">Базовое сравнение</div>
      <div class="k-val" style="font-size:19px;line-height:1.3">${bN}</div><div class="k-sub">${focusPath()?'фокусные — против KPI команды, остальные — против сравнения':'переключается на полке, отображается одно'}</div></div>
  </div>`;

  if(leaves.length===0){document.getElementById('view').innerHTML=html+emptyNote();return}
  if(state.metricSel.size===0){document.getElementById('view').innerHTML=html+`<div class="note-inline">Не выбрано ни одной метрики. Включите метрики на левой полке («Метрики в фокусе»).</div>`;return}

  const COLGROUP=`<colgroup><col style="width:27%"><col style="width:9%"><col style="width:16%"><col style="width:9%"><col style="width:9%"><col style="width:17%"><col style="width:13%"></colgroup>`;
  const cmpHdr=state.bench==='none'?'Сравнение':`Сравнение · ${bN}`;
  D.BLOCKS.forEach(block=>{
    const blockMetrics=selMetricsOfBlock(block.key).slice()
      .sort((a,b)=>(isFocusMetric(a)?0:1)-(isFocusMetric(b)?0:1));
    if(blockMetrics.length===0)return; // блок без выбранных метрик скрыт
    html+=`<div class="block-h"><span class="block-name">${block.name}</span><span class="block-hint">${block.hint}</span></div>
      <div class="panel"><table class="mtable">${COLGROUP}<thead><tr>
        <th>Метрика</th><th class="num">Значение</th><th class="cmp-h">${cmpHdr}</th><th class="num">YoY</th><th class="num">MoM</th><th>12 мес</th><th>Детально</th>
      </tr></thead><tbody>`;
    blockMetrics.forEach(m=>{
      const s=scopeSeries(m.key);const val=s[D.LAST];const d=D.deltas(s);
      const bl=resolveBaseline(m,val);
      const barSt=bl.state;const isFoc=bl.isFocus;
      const dcM=deltaClass(m.key,d.mom),dcY=deltaClass(m.key,d.yoy);
      const subText=m.better==='flat'?'нейтральная (без сравнения)':(m.better==='higher'?'выше — лучше':'ниже — лучше');
      html+=`<tr class="mrow ${isFoc?'focus-row':''}" data-metric="${m.key}">
        <td class="m-name bar-${barSt} ${isFoc?'focus':''}">${m.name}${isFoc?'<span class="focus-pill">★ Фокус</span>':''}<span class="m-sub">${subText}</span></td>
        <td class="m-val-cell"><div class="m-val">${D.fmtVal(m.key,val)}</div></td>
        <td class="cmp-cell"><div class="cmp">${cmpCell(m,val,bl)}</div></td>
        <td class="col-num"><span class="delta ${dcY}">${arrow(d.yoy)} ${D.fmtDelta(m.key,d.yoy)}</span></td>
        <td class="col-num"><span class="delta ${dcM}">${arrow(d.mom)} ${D.fmtDelta(m.key,d.mom)}</span></td>
        <td>${CH.sparkSVG(s,barSt)}</td>
        <td class="detail-cell"><button class="mini-btn" data-open="${m.key}">${state.openMetric===m.key?'Скрыть':'Динамика ▾'}</button></td>
      </tr>`;
      if(state.openMetric===m.key){
        html+=`<tr class="detail-row"><td colspan="7"><div class="detail-chart" id="dc-${m.key}"></div></td></tr>`;
      }
    });
    html+=`</tbody></table></div>`;
  });
  document.getElementById('view').innerHTML=html;

  if(state.openMetric&&state.metricSel.has(state.openMetric)){
    const m=state.openMetric;const s=scopeSeries(m);
    const bench=D.METRIC_BY_KEY[m].fmt==='int'?null:D.benchSeries(state.bench,m);
    mkChart('dc-'+m,CH.lineOption(m,s,state.bench,bench,D.METRIC_BY_KEY[m].name+' — динамика'));
  }
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=e=>{e.stopPropagation();const k=b.getAttribute('data-open');state.openMetric=state.openMetric===k?null:k;rerender()});
  document.querySelectorAll('.mrow').forEach(r=>r.onclick=()=>{const k=r.getAttribute('data-metric');state.openMetric=state.openMetric===k?null:k;rerender()});
}

/* ================= ВКЛАДКА: КОМАНДЫ ================= */
// строки уровня −1: прямые дети активного узла (или зоны HRBP). Узел-лист → он сам.
function teamRows(){
  const fp=focusPath();
  const parents=fp?[fp]:D.HRBP_BY_ID[state.hrbpId].scope;
  const set=new Set();
  parents.forEach(p=>{
    const kids=D.childrenOf(p);
    if(kids.length===0)set.add(p);
    else kids.forEach(k=>set.add(k.path));
  });
  return [...set].map(p=>D.NODE_BY_PATH[p]).sort((a,b)=>a.sort-b.sort);
}
// плоский список фокусных юнитов в зоне HRBP, суженный фильтром команды. Сорт: уровень → sort.
function focusRows(){
  let foc=D.focusNodesInZone(state.hrbpId);
  const fp=focusPath();
  if(fp)foc=foc.filter(n=>n.path===fp||n.path.startsWith(fp+'/'));
  return foc;
}
// ячейка хитмапа по ПРОИЗВОЛЬНОМУ набору листьев узла (с учётом фильтров HQ/segment).
// KPI команды (если задан) → сравнение с целью; иначе бенчмарк; иначе нейтрально.
function heatCellFor(node,m,leafPaths){
  const val=aggLeaves(leafPaths,m.key)[D.LAST];
  const focus=D.teamFocus(node.path);
  if(focus[m.key]){
    const st=D.stateFor(m.key,val,focus[m.key]);
    return`<td><div class="cell ${st}">${D.fmtVal(m.key,val)}<span class="cell-sub">KPI</span></div></td>`;
  }
  if(state.bench!=='none' && m.fmt!=='int'){
    const bv=D.benchValue(state.bench,m.key);
    if(bv!=null){
      const st=D.compareState(m.key,val,bv);
      return`<td><div class="cell ${st}">${D.fmtVal(m.key,val)}</div></td>`;
    }
  }
  return`<td><div class="cell neutral">${D.fmtVal(m.key,val)}</div></td>`;
}
function renderTeams(){
  const liveBlocks=D.BLOCKS.filter(b=>anySelInBlock(b.key));
  const isFocusSub=state.teamSub==='focus';
  let html=`<div class="page-h"><h1>HRBP HUB · Команды</h1>
    <p>Хитмап «юниты × метрики» по выбранному блоку OnePager${filterSummary()}${focusSummary()}. Под-вкладки: <b>Фокусные юниты</b> — плоский список всех фокусных юнитов зоны с бейджем уровня (вложенные показаны отдельными строками, ИТОГО считает их без задвоения); <b>Уровень −1</b> — прямые подразделения выбранного узла. Подсветка ячейки = результат <b>сравнения</b>: у фокусных метрик команды — с её KPI (метка «KPI»), у остальных — с бенчмарком «${benchName()}».</p></div>`;
  if(liveBlocks.length===0){document.getElementById('view').innerHTML=html+`<div class="note-inline">Не выбрано ни одной метрики. Включите метрики на левой полке.</div>`;return}
  if(!liveBlocks.find(b=>b.key===state.blockTab))state.blockTab=liveBlocks[0].key;
  const block=D.BLOCKS.find(b=>b.key===state.blockTab);
  const blockMetrics=selMetricsOfBlock(block.key);
  const effSet=new Set(effectiveLeaves());

  // под-вкладки представления
  const focCnt=focusRows().length;
  html+=`<div class="sub-tabs">
    <button class="sub-tab ${isFocusSub?'active':''}" data-sub="focus">★ Фокусные юниты <span class="sub-badge">${focCnt}</span></button>
    <button class="sub-tab ${!isFocusSub?'active':''}" data-sub="level1">Уровень −1</button>
  </div>`;

  if(effSet.size===0){document.getElementById('view').innerHTML=html+emptyNote();return}

  // строки в зависимости от под-вкладки + спецификация ИТОГО
  let rows,totalLeaves,totalLabel,emptyRowsMsg;
  if(isFocusSub){
    rows=focusRows();
    const fi=focusInfo();
    totalLeaves=fi.leaves.filter(p=>effSet.has(p));
    totalLabel=`ИТОГО · фокусные (без задвоения · ${fi.roots.length} корневых)`;
    emptyRowsMsg='В зоне HRBP нет фокусных юнитов под текущим фильтром. Снимите фильтр команды или выберите другого HRBP.';
  }else{
    rows=teamRows();
    const fp=focusPath();
    totalLeaves=[...effSet];
    totalLabel=`ИТОГО · ${fp?D.NODE_BY_PATH[fp].name:'зона '+D.HRBP_BY_ID[state.hrbpId].name}`;
    emptyRowsMsg=null;
  }
  if(state.selTeam&&!rows.find(r=>r.path===state.selTeam))state.selTeam=null;
  if(!state.selTeam&&rows[0])state.selTeam=rows[0].path;

  html+=`<div class="note-inline">Если у юнита по метрике задан KPI (цель Senior HRBP) — ячейка сравнивается с целью (метка «KPI»). Иначе — с бенчмарком по направлению метрики (выше/ниже — лучше). Метрики без сравнения (численность, выкл. бенчмарк) — нейтральные.${isFocusSub?' Фокусные юниты могут быть вложены друг в друга — строки самодостаточны, а ИТОГО берёт только корневые (без двойного счёта людей).':''}</div>
  <div class="tabs">
    ${liveBlocks.map(b=>`<button class="tab ${b.key===state.blockTab?'active':''}" data-block="${b.key}">${b.name}</button>`).join('')}
  </div>
  <div class="legend-note">
    <span class="sw"><span class="dot" style="background:#bff2cd"></span> лучше / в норме</span>
    <span class="sw"><span class="dot" style="background:#ffe6a0"></span> зона внимания (KPI)</span>
    <span class="sw"><span class="dot" style="background:#ffcccc"></span> хуже / вне нормы</span>
    <span class="sw"><span class="dot" style="background:#f3f4f6"></span> нейтрально / нет сравнения</span>
  </div>
  <div class="matrix-wrap">
    <div class="panel"><div class="panel-h">${block.name} · ${isFocusSub?'фокусные юниты':'уровень −1'} × метрики<span class="dots">⋮</span></div>
    <div style="overflow:auto"><table class="htable"><thead><tr><th class="unit-h">Юнит</th>`;
  blockMetrics.forEach(m=>html+=`<th title="${m.hint}">${m.short}</th>`);
  html+=`</tr></thead><tbody>`;

  // строка ИТОГО (по дедуплицированному набору для фокусных)
  html+=`<tr class="total"><td class="unit">${totalLabel}</td>`;
  blockMetrics.forEach(m=>{
    const val=aggLeaves(totalLeaves,m.key)[D.LAST];
    if(m.fmt==='int'||state.bench==='none'){html+=`<td><div class="cell neutral">${D.fmtVal(m.key,val)}</div></td>`;return}
    const bv=D.benchValue(state.bench,m.key);
    if(bv==null){html+=`<td><div class="cell neutral">${D.fmtVal(m.key,val)}</div></td>`;return}
    const st=D.compareState(m.key,val,bv);
    html+=`<td><div class="cell ${st}">${D.fmtVal(m.key,val)}</div></td>`;
  });
  html+=`</tr>`;

  // строки данных
  let shown=0;
  rows.forEach(node=>{
    const rowLeaves=D.leavesUnder(node.path).map(l=>l.path).filter(p=>effSet.has(p));
    if(rowLeaves.length===0)return;
    shown++;
    const sel=state.selTeam===node.path?'sel':'';
    const badge=isFocusSub?`<span class="lvl-badge" title="${D.levelLabel(node.level)}">ур. ${node.level}</span>`:'';
    html+=`<tr class="urow ${sel}" data-team="${node.path}"><td class="unit">${badge}${node.name}<span class="unit-sub">${rowLeaves.length} ${rowLeaves.length===1?'юнит':'юнитов'}</span></td>`;
    blockMetrics.forEach(m=>html+=heatCellFor(node,m,rowLeaves));
    html+=`</tr>`;
  });
  if(shown===0&&emptyRowsMsg){html+=`<tr><td class="unit" colspan="${blockMetrics.length+1}"><span style="color:var(--muted);font-weight:600">${emptyRowsMsg}</span></td></tr>`;}
  html+=`</tbody></table></div></div>`;

  const sel=state.selTeam?D.NODE_BY_PATH[state.selTeam]:null;
  const selLevel=sel&&isFocusSub?` <span class="lvl-badge">ур. ${sel.level}</span>`:'';
  html+=`<div class="panel dyn-panel"><div class="panel-h">${sel?('Динамика · '+sel.name):'Выберите юнит'}${selLevel}<span class="dots">⋮</span></div>`;
  if(sel){
    blockMetrics.forEach(m=>{
      html+=`<div class="dyn-block"><h4>${m.name}</h4><div class="dyn-chart" id="dyn-${m.key}"></div></div>`;
    });
  }
  html+=`</div></div>`;
  document.getElementById('view').innerHTML=html;

  if(sel){
    blockMetrics.forEach(m=>{
      const s=D.metricSeries(sel.path,m.key);const bench=m.fmt==='int'?null:D.benchSeries(state.bench,m.key);
      mkChart('dyn-'+m.key,CH.lineOption(m.key,s,state.bench,bench,null));
    });
  }
  document.querySelectorAll('[data-sub]').forEach(b=>b.onclick=()=>{state.teamSub=b.getAttribute('data-sub');state.selTeam=null;rerender()});
  document.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>{state.blockTab=b.getAttribute('data-block');state.selTeam=null;rerender()});
  document.querySelectorAll('[data-team]').forEach(r=>r.onclick=()=>{state.selTeam=r.getAttribute('data-team');rerender()});
}

/* ================= ВКЛАДКА: ТРАНСФОРМЕРЫ ================= */
const CUTS={
  'IT / nonIT':['IT','nonIT'],
  'HQ / Line / Support':['HQ','Line','Support'],
  'Регион':['Москва','СПб','Регионы','Зарубеж'],
  'Сениорити':['Junior','Middle','Senior','Lead']
};
const CUT_SHARES={
  'IT / nonIT':[0.62,0.38],
  'HQ / Line / Support':[0.34,0.45,0.21],
  'Регион':[0.42,0.18,0.34,0.06],
  'Сениорити':[0.30,0.40,0.22,0.08]
};
function cutMonthlySeries(metricKey,cutKey){
  const vals=CUTS[cutKey],shares=CUT_SHARES[cutKey];
  const base=scopeSeries(metricKey);
  const m=D.METRIC_BY_KEY[metricKey];
  return vals.map((cv,ci)=>{
    const off=Math.sin((ci+1)*2.3)*(m.fmt==='int'?0:(m.fmt==='days'?1.6:2.4));
    const data=base.map((b,i)=>{
      if(m.fmt==='int')return Math.round(b*shares[ci]);
      const jitter=Math.sin((i+1)*(ci+2)*0.7)*(m.fmt==='days'?0.9:1.5);
      let v=b+off+jitter;
      return +(Math.max(0,v)).toFixed(1);
    });
    return{name:cv,data};
  });
}
function renderTransformer(){
  const tf=state.tf;
  const avail=selMetrics();
  let html=`<div class="page-h"><h1>HRBP HUB · Трансформеры</h1>
    <p>Произвольная раскладка метрики по выбранному разрезу: динамика по месяцам или сводная таблица${filterSummary()}.</p></div>`;
  if(avail.length===0){document.getElementById('view').innerHTML=html+`<div class="note-inline">Не выбрано ни одной метрики. Включите метрики на левой полке.</div>`;return}
  if(!avail.find(x=>x.key===tf.metric))tf.metric=avail[0].key;
  const m=D.METRIC_BY_KEY[tf.metric];
  html+=`<div class="tf-controls">
    <div class="ctl"><label>Режим</label>
      <div class="seg">
        <button class="seg-b ${tf.mode==='dyn'?'on':''}" data-mode="dyn">Динамика по разрезу</button>
        <button class="seg-b ${tf.mode==='pivot'?'on':''}" data-mode="pivot">Сводная таблица</button>
      </div></div>
    <div class="ctl"><label>Метрика</label><select id="tfm">${avail.map(x=>`<option value="${x.key}" ${x.key===tf.metric?'selected':''}>${x.name}</option>`).join('')}</select></div>
    <div class="ctl"><label>Разрез</label><select id="tfc">${Object.keys(CUTS).map(k=>`<option ${k===tf.cut?'selected':''}>${k}</option>`).join('')}</select></div>
    <div class="gspacer"></div>
  </div>`;

  const series=cutMonthlySeries(tf.metric,tf.cut);
  const labels=D.MONTHS.map(mo=>mo.isYearStart?('{y|'+mo.y+'}'):mo.label);

  if(tf.mode==='dyn'){
    html+=`<div class="panel"><div class="panel-h">${m.name} · по разрезу «${tf.cut}» — динамика по месяцам<span class="dots">⋮</span></div>
      <div style="padding:12px 14px"><div class="tf-chart" id="tfChart"></div></div></div>`;
    document.getElementById('view').innerHTML=html;
    mkChart('tfChart',CH.groupedBarOption(series,labels,tf.metric));
  }else{
    html+=`<div class="panel"><div class="panel-h">${m.name} · сводная по разрезу «${tf.cut}»<span class="dots">⋮</span></div>
      <div style="overflow:auto"><table class="pivot"><thead><tr><th class="txt">${tf.cut}</th>`;
    D.MONTHS.forEach(mo=>html+=`<th>${mo.isYearStart?mo.label+' '+String(mo.y).slice(2):mo.label}</th>`);
    html+=`<th class="dcol">Δ за год</th></tr></thead><tbody>`;
    series.forEach(s=>{
      const dy=+(s.data[D.LAST]-s.data[0]).toFixed(1);
      html+=`<tr><td class="txt">${s.name}</td>`;
      s.data.forEach((v,i)=>{html+=`<td class="${i===D.LAST?'cur':''}">${D.fmtVal(tf.metric,v)}</td>`});
      html+=`<td class="dcol"><span class="delta ${deltaClass(tf.metric,dy)}">${arrow(dy)} ${D.fmtDelta(tf.metric,dy)}</span></td></tr>`;
    });
    html+=`<tr class="total"><td class="txt">ИТОГО</td>`;
    const total=scopeSeries(tf.metric);
    total.forEach((v,i)=>{html+=`<td class="${i===D.LAST?'cur':''}">${D.fmtVal(tf.metric,v)}</td>`});
    const dyt=+(total[D.LAST]-total[0]).toFixed(1);
    html+=`<td class="dcol"><span class="delta ${deltaClass(tf.metric,dyt)}">${arrow(dyt)} ${D.fmtDelta(tf.metric,dyt)}</span></td></tr>`;
    html+=`</tbody></table></div></div>`;
    document.getElementById('view').innerHTML=html;
  }

  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.tf.mode=b.getAttribute('data-mode');rerender()});
  document.getElementById('tfm').onchange=e=>{state.tf.metric=e.target.value;rerender()};
  document.getElementById('tfc').onchange=e=>{state.tf.cut=e.target.value;rerender()};
}

/* ================= ВКЛАДКА: КАТАЛОГ МЕТРИК ================= */
function renderCatalog(){
  let html=`<div class="page-h"><h1>HRBP HUB · Каталог метрик</h1>
    <p>Senior HRBP выбирает <b>действующие</b> метрики — они выходят на 1-ю страницу (OnePager) с бенчмарками и цветной подсветкой результата сравнения. Метки «в фокусе» показывают метрики, включённые сейчас на левой полке.</p></div>`;
  html+=`<div class="cat-grid">`;
  D.BLOCKS.forEach(b=>{
    html+=`<div class="panel cat-panel"><div class="panel-h">${b.name} <span class="cat-badge active">действующие</span></div><ul class="cat-list">`;
    D.metricsOfBlock(b.key).forEach(m=>{
      const thr=m.threshold?`цель: ${m.better==='higher'?'≥':'≤'} ${m.threshold.green}${m.fmt==='days'?' дн':(m.fmt==='pct'?'%':'')}`:'без порога';
      const foc=state.metricSel.has(m.key)?'<span class="cat-badge want" style="margin-left:6px">в фокусе</span>':'';
      html+=`<li><span class="cat-name">${m.name}${foc}</span><span class="cat-meta">${thr}</span></li>`;
    });
    html+=`</ul></div>`;
  });
  html+=`<div class="panel cat-panel"><div class="panel-h">Прочие <span class="cat-badge dev">в разработке</span></div><ul class="cat-list">`;
  D.DEV_METRICS.forEach(m=>html+=`<li><span class="cat-name">${m.name}</span><span class="cat-meta">${m.note}</span></li>`);
  html+=`</ul></div>`;
  html+=`<div class="panel cat-panel"><div class="panel-h">Прочие <span class="cat-badge want">хотим разработать</span></div><ul class="cat-list">`;
  D.WANTED_METRICS.forEach(m=>html+=`<li><span class="cat-name">${m.name}</span><span class="cat-meta">${m.note}</span></li>`);
  html+=`</ul></div>`;
  html+=`</div>`;
  document.getElementById('view').innerHTML=html;
}

/* ================= РОУТИНГ ================= */
function rerender(){
  disposeCharts();
  renderShelf();
  document.querySelectorAll('.tab-top').forEach(n=>n.classList.toggle('active',n.getAttribute('data-tab')===state.tab));
  if(state.tab==='onepager')renderOnePager();
  else if(state.tab==='teams')renderTeams();
  else if(state.tab==='transformer')renderTransformer();
  else renderCatalog();
}
document.querySelectorAll('.tab-top').forEach(n=>n.onclick=()=>{state.tab=n.getAttribute('data-tab');state.openMetric=null;rerender()});
rerender();
