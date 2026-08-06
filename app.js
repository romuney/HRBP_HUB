/* ============================================================
   HRBP HUB — логика прототипа.
   Слои: data.js → charts.js → ui.js → app.js (этот файл).
   Экран собирает данные и зовёт общие элементы из HRBPUI; своей вёрстки
   компонентов здесь нет.
   ============================================================ */
const D=window.HRBPDATA, CH=window.HRBPCHARTS, U=window.HRBPUI;
const esc=U.esc;

const state={
  tab:'onepager',              // onepager | teams | transformer | catalog
  hrbpId:'anna',
  teamFilter:null,             // юнит из фильтра «Юнит зоны · −1» | null = вся зона
  fullUnit:null,               // юнит из фильтра «Все юниты (вся глубина)». Переопределяет зону.
  focusOnly:false,             // «Только фокусные»: на OnePager — метрики с целью,
                               // на «Командах» — юниты, где хоть по одной метрике есть цель
  bench:'company',
  /* разрезы численности — те же поля, что и условия применения целей */
  paint:'all', itSeg:'all', stream:'all', spec:'all', staffType:'all', hcType:'all',
  metricSel:new Set(D.METRICS.map(m=>m.key)),  // метрики для отображения
  metricOpen:false,
  blockTab:'retention',
  selTeam:null,
  openMetric:null,
  tf:{mode:'dyn', cut:'IT / nonIT', metric:'regret'},
  kpiOpen:false,
  kpiDraft:null
};
const openRows=new Set();      // раскрытые строки сводной таблицы «Команды»

/* активный юнит: «Все юниты» переопределяют фильтр зоны */
function focusPath(){return state.fullUnit||state.teamFilter||null}
/* юнит, от которого считается наследование целей: выбранный или корень зоны HRBP */
function activeUnit(){return focusPath()||D.HRBP_BY_ID[state.hrbpId].scope[0]}

const charts={};
/* Если библиотека графиков не подгрузилась (автономный просмотр без сети),
   отчёт обязан остаться читаемым: значения и таблицы важнее графиков. */
function mkChart(id,opt){
  const el=document.getElementById(id);
  if(!el)return;
  if(typeof echarts==='undefined'){
    el.innerHTML='<div class="chart-off">График недоступен без подключения к сети. Значения читаются в таблице.</div>';
    return;
  }
  if(charts[id])charts[id].dispose();
  const c=echarts.init(el);c.setOption(opt);charts[id]=c;return c;
}
function disposeCharts(){Object.values(charts).forEach(c=>c.dispose());for(const k in charts)delete charts[k]}
window.addEventListener('resize',()=>{Object.values(charts).forEach(c=>c.resize())});

/* ================= ПОПУЛЯЦИЯ ================= */
/* базовый набор листьев: выбранный юнит (вся глубина) либо зона HRBP, суженная фильтром */
function baseLeaves(){
  if(state.fullUnit)return D.leavesUnder(state.fullUnit).map(l=>l.path);
  let all=D.scopeLeaves(state.hrbpId);
  if(state.teamFilter){
    const set=new Set(D.leavesUnder(state.teamFilter).map(l=>l.path));
    all=all.filter(p=>set.has(p));
  }
  return all;
}
/* эффективный набор = базовый + разрезы численности */
function effectiveLeaves(){return baseLeaves().filter(p=>D.leafPasses(p,state))}
function rowLeaves(path){return D.leavesUnder(path).map(l=>l.path).filter(p=>D.leafPasses(p,state))}
function aggLeaves(leafPaths,metricKey){return D.aggMetricLeaves(leafPaths,metricKey)}
function scopeSeries(metricKey){return aggLeaves(effectiveLeaves(),metricKey)}

function populationLabel(){
  if(state.fullUnit)return D.NODE_BY_PATH[state.fullUnit].name;
  if(state.teamFilter)return D.NODE_BY_PATH[state.teamFilter].name;
  return D.zoneLabel(state.hrbpId);
}
function benchName(){return D.BENCHMARKS.find(b=>b.key===state.bench).name}

/* ---- выбранные метрики ---- */
function selMetricsOfBlock(blockKey){return D.metricsOfBlock(blockKey).filter(m=>state.metricSel.has(m.key))}
function anySelInBlock(blockKey){return D.metricsOfBlock(blockKey).some(m=>state.metricSel.has(m.key))}
function selMetrics(){return D.METRICS.filter(m=>state.metricSel.has(m.key))}
/* главная метрика сводной таблицы: первая сравнимая среди выбранных метрик блока */
function blockMain(blockKey){
  const mets=selMetricsOfBlock(blockKey);
  return ((mets.find(m=>D.comparable(m.key))||mets[0])||{}).key;
}

/* ---- ориентир метрики для активного юнита ---- */
function baselineOf(metricKey,val,unitPath){
  return D.baselineFor(unitPath||activeUnit(),metricKey,val,state,state.bench);
}
/* сколько целей юнита сейчас скрыто фильтрами (свои + унаследованные от владельца) */
function hiddenFocus(metricKey,bl,unitPath){
  const u=unitPath||activeUnit();
  let n=D.hiddenKpiCount(u,state,metricKey);
  if(bl&&bl.kind==='kpi'&&bl.inherited&&bl.owner.path!==u)n+=D.hiddenKpiCount(bl.owner.path,state,metricKey);
  return n;
}

/* ================= ВЫПАДАЮЩИЕ СПИСКИ ================= */
function teamOptionsHTML(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const rootSet=new Set(h.scope);
  const nodes=D.teamFilterNodes(state.hrbpId);
  let html='<option value="">— Вся зона HRBP —</option>';
  nodes.forEach(n=>{
    const ind=rootSet.has(n.path)?'':'  ';
    html+='<option value="'+n.path+'" '+(n.path===state.teamFilter?'selected':'')+'>'+ind+esc(n.name)+
      (D.hasOwnKpi(n.path)?' ●':'')+'</option>';
  });
  return html;
}
function fullOptionsHTML(){
  let html='<option value="">— Вся компания (вся глубина) —</option>';
  D.NODES.filter(n=>n.path!=='T').slice().sort((a,b)=>a.sort-b.sort).forEach(n=>{
    const ind='  '.repeat(Math.max(0,n.level-2));
    html+='<option value="'+n.path+'" '+(n.path===state.fullUnit?'selected':'')+'>'+ind+esc(n.name)+
      (D.hasOwnKpi(n.path)?' ●':'')+'</option>';
  });
  return html;
}
function hrbpOptionsHTML(){
  const roles=[['Senior','Senior HRBP'],['Middle','Middle HRBP'],['Junior','Junior HRBP']];
  return roles.map(([rk,rl])=>{
    const items=D.HRBP.filter(h=>h.role===rk);
    if(!items.length)return'';
    const sub=id=>{const c=D.hrbpSubordinateCount(id);return c?' ('+c+' в подч.)':''};
    return '<optgroup label="'+rl+'">'+items.map(h=>'<option value="'+h.id+'" '+(h.id===state.hrbpId?'selected':'')+'>'+
      esc(h.name)+sub(h.id)+'</option>').join('')+'</optgroup>';
  }).join('');
}

/* ================= ЛЕВАЯ ПОЛКА ФИЛЬТРОВ ================= */
function renderShelf(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const focusHint=state.tab==='teams'
    ? 'оставляет юниты, где хотя бы по одной показанной метрике проставлен свой KPI'
    : 'оставляет метрики, по которым на юните есть цель — своя или унаследованная';
  let mlist='';
  D.BLOCKS.forEach(b=>{
    mlist+='<div class="mf-blk">'+esc(b.name)+'</div>';
    D.metricsOfBlock(b.key).forEach(m=>{
      const on=state.metricSel.has(m.key);
      mlist+='<label class="mf-item"'+U.tip({title:m.name,text:m.hint})+'>'+
        '<input type="checkbox" data-metric="'+m.key+'" '+(on?'checked':'')+'><span>'+esc(m.short)+'</span></label>';
    });
  });
  const total=D.METRICS.length, sel=state.metricSel.size;

  /* разрезы численности — один список определений на фильтры и на окно целей */
  const cuts=D.FILTER_DEFS.map(f=>
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>'+esc(f.label)+'</div>'+
      '<div class="ctl"><select data-cut="'+f.key+'">'+
        f.list.map(o=>'<option value="'+o.key+'" '+(state[f.key]===o.key?'selected':'')+'>'+esc(o.name)+'</option>').join('')+
      '</select></div>'+
    '</div>').join('');

  document.getElementById('shelf').innerHTML=
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>HRBP</div>'+
      '<div class="ctl"><select id="hrbpSel" aria-label="HRBP">'+hrbpOptionsHTML()+'</select></div>'+
      '<div class="role-row"><span class="role-chip role-'+h.role+'">'+h.role+' HRBP · '+D.hrbpSubordinateCount(state.hrbpId)+' в подчинении</span></div>'+
    '</div>'+
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>Фокус</div>'+
      '<label class="focus-toggle '+(state.focusOnly?'on':'')+'" for="focusToggle">'+
        '<input type="checkbox" id="focusToggle" '+(state.focusOnly?'checked':'')+'>'+
        '<span class="ft-track"><span class="ft-knob"></span></span>'+
        '<span class="ft-txt">Только фокусные</span></label>'+
      '<div class="ft-hint">'+focusHint+'</div>'+
    '</div>'+
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>Юнит зоны · −1</div>'+
      '<div class="ctl"><select id="teamSel" aria-label="Юнит зоны">'+teamOptionsHTML()+'</select></div>'+
    '</div>'+
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>Все юниты · вся глубина</div>'+
      '<div class="ctl"><select id="fullSel" aria-label="Все юниты компании">'+fullOptionsHTML()+'</select></div>'+
      '<div class="ft-hint">● — на юните стоит своя цель</div>'+
    '</div>'+
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>Сравнение</div>'+
      '<div class="ctl"><select id="benchSel" aria-label="База сравнения">'+
        D.BENCHMARKS.map(o=>'<option value="'+o.key+'" '+(o.key===state.bench?'selected':'')+'>'+esc(o.name)+'</option>').join('')+
      '</select></div>'+
    '</div>'+
    '<div class="shelf-sep">Разрезы численности</div>'+
    cuts+
    '<div class="shelf-grp">'+
      '<div class="shelf-h"><span class="dot-acc"></span>Метрики для отображения</div>'+
      '<button class="mf-toggle" id="mfToggle" aria-expanded="'+(state.metricOpen?'true':'false')+'">'+
        '<span>'+sel+' из '+total+' метрик</span><span class="mf-caret" aria-hidden="true">'+(state.metricOpen?'▾':'▸')+'</span></button>'+
      '<div class="mf-drop '+(state.metricOpen?'':'hidden')+'">'+
        '<div class="mf-actions"><button id="mfAll">Все</button><button id="mfNone">Снять все</button></div>'+
        '<div class="metricfilter">'+mlist+'</div>'+
      '</div>'+
    '</div>';

  document.getElementById('hrbpSel').onchange=e=>{state.hrbpId=e.target.value;state.teamFilter=null;state.fullUnit=null;state.selTeam=null;state.openMetric=null;openRows.clear();rerender()};
  document.getElementById('focusToggle').onchange=e=>{state.focusOnly=e.target.checked;state.selTeam=null;state.openMetric=null;rerender()};
  document.getElementById('teamSel').onchange=e=>{state.teamFilter=e.target.value||null;state.fullUnit=null;state.selTeam=null;state.openMetric=null;openRows.clear();rerender()};
  document.getElementById('fullSel').onchange=e=>{state.fullUnit=e.target.value||null;state.teamFilter=null;state.selTeam=null;state.openMetric=null;openRows.clear();rerender()};
  document.getElementById('benchSel').onchange=e=>{state.bench=e.target.value;rerender()};
  document.querySelectorAll('[data-cut]').forEach(s=>s.onchange=e=>{state[s.getAttribute('data-cut')]=e.target.value;state.selTeam=null;rerender()});
  document.getElementById('mfToggle').onclick=()=>{state.metricOpen=!state.metricOpen;renderShelf()};
  document.querySelectorAll('.mf-item input').forEach(c=>c.onchange=()=>{const k=c.getAttribute('data-metric');if(c.checked)state.metricSel.add(k);else state.metricSel.delete(k);rerender()});
  document.getElementById('mfAll').onclick=()=>{D.METRICS.forEach(m=>state.metricSel.add(m.key));rerender()};
  document.getElementById('mfNone').onclick=()=>{state.metricSel.clear();rerender()};
}

/* ---- шапка отчёта: чипы активных разрезов и база сравнения ---- */
function renderChips(){
  const chips=D.filterChips(state).map(c=>
    '<span class="chip">'+esc(D.FILTER_BY_KEY[c.k].label)+': '+esc(c.label)+
    '<button class="x" data-unchip="'+c.k+'" aria-label="Снять фильтр">×</button></span>').join('');
  const unit='<span class="chip bench">Юнит: <b>'+esc(populationLabel())+'</b></span>';
  const bench=state.bench==='none'?'':'<span class="chip bench">База сравнения: <b>'+esc(benchName())+'</b></span>';
  document.getElementById('chips').innerHTML=unit+chips+bench;
  document.getElementById('periodBadge').textContent=D.PERIOD_LABEL;
  document.querySelectorAll('[data-unchip]').forEach(b=>b.onclick=()=>{state[b.getAttribute('data-unchip')]='all';rerender()});
}

/* ================= ЯЧЕЙКА СРАВНЕНИЯ ================= */
function cmpCell(m,val,bl){
  if(bl.kind==='kpi'){
    const dir=m.better==='higher'?'не ниже':'не выше';
    const diff=+(val-bl.target).toFixed(1);
    return '<div class="tgt"><b>'+D.fmtVal(m.key,bl.target)+'</b>цель, '+dir+'</div>'+
      '<span class="cell '+bl.state+'"'+U.tip({title:'Сравнение с целью',
        text:'У метрики есть утверждённая цель, поэтому база сравнения рядом не показывается.',
        rows:[{label:'факт',value:D.fmtVal(m.key,val)},{label:'цель',value:D.fmtVal(m.key,bl.target)},
              {label:'отклонение',value:D.fmtDelta(m.key,diff)}],
        note:'Цель с уровня «'+bl.owner.name+'».'})+'>'+D.fmtDelta(m.key,diff)+'</span>';
  }
  if(bl.kind==='bench'){
    const diff=+(val-bl.base).toFixed(1);
    return '<div class="tgt"><b>'+D.fmtVal(m.key,bl.base)+'</b>база: '+esc(benchName())+'</div>'+
      '<span class="cell '+bl.state+'"'+U.tip({title:'Сравнение с базой',
        rows:[{label:'факт',value:D.fmtVal(m.key,val)},{label:benchName(),value:D.fmtVal(m.key,bl.base),dash:true,color:'#9aa0ac'},
              {label:'отклонение',value:D.fmtDelta(m.key,diff)}],
        note:'Мёртвая зона ±5%: внутри неё отклонение серое.'})+'>'+D.fmtDelta(m.key,diff)+'</span>';
  }
  if(!D.comparable(m.key))return U.noCmpMark(m.better==='flat'
    ?'У этой метрики «больше» не значит «лучше»: оценивать её цветом было бы враньём.'
    :null);
  return U.noCmpMark('База сравнения выключена на левой полке.');
}

/* ================= ВКЛАДКА: ONEPAGER ================= */
function renderOnePager(){
  const h=D.HRBP_BY_ID[state.hrbpId];
  const leaves=effectiveLeaves();
  const unit=activeUnit();
  const unitNode=D.NODE_BY_PATH[unit];

  let html='<div class="page-h"><div class="ph-row"><h2>Сводка HRBP</h2></div>'+
    '<p>'+esc(h.note)+' Разрезы численности: <b>'+esc(D.filterLabel(state))+'</b>.'+
    (state.bench!=='none'?' Метрики без утверждённой цели сравниваются с базой <b>'+esc(benchName())+'</b>.':'')+
    ' У метрик с целью сравнение идёт с целью, а не с базой.</p></div>';

  if(leaves.length===0){
    document.getElementById('view').innerHTML=html+
      U.empty('Нет данных по выбранным разрезам','Снимите один из разрезов на левой полке — под текущим набором в зоне видимости не осталось ни одного юнита.');
    return;
  }
  if(state.metricSel.size===0){
    document.getElementById('view').innerHTML=html+
      U.empty('Не выбрано ни одной метрики','Включите метрики на левой полке — блок «Метрики для отображения».');
    return;
  }

  /* карточки шапки */
  const people=aggLeaves(leaves,'headcount')[D.LAST];
  const ownK=D.ownKpis(unit).length;
  const inhCount=selMetrics().filter(m=>{const b=baselineOf(m.key,scopeSeries(m.key)[D.LAST]);return b.kind==='kpi'&&b.inherited}).length;
  const ownShown=selMetrics().filter(m=>{const b=baselineOf(m.key,scopeSeries(m.key)[D.LAST]);return b.kind==='kpi'&&!b.inherited}).length;
  html+=U.kpis([
    U.kpiCard({label:'Юнит отчёта',value:populationLabel(),small:true,
      q:U.infoDot({title:'Юнит отчёта',text:'Выбирается фильтрами «Юнит зоны» и «Все юниты». От него считается наследование целей.'}),
      row1:'<span class="k-sub">'+(unitNode?D.levelLabel(unitNode.level):'зона HRBP')+'</span>',
      row2:'<span class="k-sub">'+leaves.length+' '+U.plural(leaves.length,'юнит','юнита','юнитов')+' в популяции</span>'}),
    U.kpiCard({label:'Сотрудников',value:D.fmtInt(people),
      row1:'<span class="k-sub">на конец периода</span>',
      row2:'<span class="k-sub">разрез: '+esc(D.filterLabel(state))+'</span>'}),
    U.kpiCard({label:'Целей на юните',value:String(ownK),
      q:U.infoDot({title:'Цели юнита',text:'Цели, поставленные именно на этот юнит. Часть из них может быть привязана к отдельным разрезам численности — тогда они видны только при выборе того же разреза.'}),
      row1:ownShown?'<span class="kpi-tag">'+ownShown+' в фокусе сейчас</span>':'<span class="k-sub">ни одна не подходит под фильтры</span>',
      row2:'<span class="k-sub">'+(ownK?'нажмите «Настроить KPI», чтобы изменить':'цели наследуются сверху')+'</span>'}),
    U.kpiCard({label:'Наследуемых целей',value:String(inhCount),
      q:U.infoDot({title:'Наследование',text:'Цель, поставленная выше по дереву, действует на всю ветку вниз, пока не встретится своя.'}),
      row1:inhCount?'<span class="kpi-tag inh">Фокус через родителя</span>':'<span class="k-sub">—</span>',
      row2:'<div></div>'})
  ]);

  /* таблицы блоков */
  let anyRow=false;
  D.BLOCKS.forEach(block=>{
    let blockMetrics=selMetricsOfBlock(block.key);
    /* «Только фокусные» на OnePager оставляет метрики, по которым есть цель */
    const withBl=blockMetrics.map(m=>{
      const s=scopeSeries(m.key);
      return {m,s,val:s[D.LAST],bl:baselineOf(m.key,s[D.LAST])};
    }).filter(x=>!state.focusOnly||x.bl.kind==='kpi');
    /* метрики с целью — наверх: с них начинается разговор */
    withBl.sort((a,b)=>(a.bl.kind==='kpi'?0:1)-(b.bl.kind==='kpi'?0:1));
    if(withBl.length===0)return;
    anyRow=true;

    let rows='';
    withBl.forEach(({m,s,val,bl})=>{
      const d=D.deltas(s);
      const hid=hiddenFocus(m.key,bl);
      rows+='<tr class="mrow'+(bl.kind==='kpi'?' focus-row':'')+'" data-metric="'+m.key+'" tabindex="0" role="button"'+
          ' aria-expanded="'+(state.openMetric===m.key?'true':'false')+'">'+
        '<td class="txt"><span class="row-label">'+
          U.caret(state.openMetric===m.key,'openm',m.key,'Показать динамику')+
          '<span class="row-body">'+esc(m.name)+U.infoDot({title:m.name,text:m.hint})+
          (bl.kind==='kpi'?' '+U.focusTag(bl):'')+
          (hid?' '+U.multiFocusHint(hid):'')+
          '<span class="unit-sub">'+(m.better==='flat'?'больше не значит лучше'
            :(m.better==='higher'?'выше — лучше':'ниже — лучше'))+'</span></span></span></td>'+
        '<td class="lead">'+D.fmtVal(m.key,val)+'</td>'+
        '<td class="vs">'+cmpCell(m,val,bl)+'</td>'+
        '<td>'+U.momChip(m.key,d.mom)+'</td>'+
        '<td>'+U.yoyChip(m.key,d.yoy)+'</td>'+
        '<td class="sparkcell">'+U.spark(s,bl.state)+'</td></tr>';
      if(state.openMetric===m.key){
        rows+='<tr class="detail-row"><td colspan="6"><div class="detail-chart" id="dc-'+m.key+'"></div></td></tr>';
      }
    });

    const tbl='<table class="ptable dense"><colgroup><col style="width:34%"><col style="width:11%">'+
      '<col style="width:19%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>'+
      '<thead><tr><th class="txt">Метрика</th><th>Значение</th>'+
      '<th class="vs">Ориентир<span class="hint-col">цель или база</span></th>'+
      '<th>Изменение<span class="hint-col">к '+esc(D.PREV_LABEL)+'</span></th>'+
      '<th>За год<span class="hint-col">к '+esc(D.YEAR_LABEL)+'</span></th>'+
      '<th>12 мес</th></tr></thead><tbody>'+rows+'</tbody></table>';

    html+='<div class="block-gap">'+
      U.panel({title:block.name,sub:block.hint+' · клик по строке раскрывает динамику',
        body:tbl,bodyCls:'tbl-wrap'})+'</div>';
  });

  if(!anyRow){
    html+=U.empty('Под фильтром «Только фокусные» метрик не осталось',
      'На этом юните и выше по ветке цели по выбранным метрикам не заданы. Выключите тумблер слева или поставьте цель кнопкой «Настроить KPI».');
  }
  document.getElementById('view').innerHTML=html;

  if(state.openMetric&&state.metricSel.has(state.openMetric)){
    const k=state.openMetric;
    const s=scopeSeries(k);
    const bl=baselineOf(k,s[D.LAST]);
    const bench=(bl.kind==='bench')?D.benchSeries(state.bench,k):null;
    mkChart('dc-'+k,CH.lineOption(k,s,bench,benchName(),
      bl.kind==='kpi'?bl.target:null,D.METRIC_BY_KEY[k].name+' — динамика'));
  }
  bindRowToggle('.mrow','metric',k=>{state.openMetric=state.openMetric===k?null:k;rerender()});
  /* каретка делает то же, что клик по строке, но не даёт событию всплыть:
     иначе строка тут же вернула бы состояние обратно */
  document.querySelectorAll('[data-openm]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const k=b.getAttribute('data-openm');
    state.openMetric=state.openMetric===k?null:k;rerender();
  });
}

/* строка-кнопка: клик и клавиатура зовут один обработчик */
function bindRowToggle(sel,attr,fn){
  document.querySelectorAll(sel).forEach(r=>{
    const k=r.getAttribute('data-'+attr);
    r.onclick=()=>fn(k);
    r.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn(k)}};
  });
}

/* ================= ВКЛАДКА: КОМАНДЫ ================= */
/* строки сводной таблицы: юниты −1 от активного, раскрытые — со своими детьми (−1 от строки) */
function pivotRows(root){
  const rows=[];
  D.nodesBelow(root,1).forEach(n=>{
    rows.push({n,depth:1});
    if(openRows.has(n.path))D.childrenOf(n.path).forEach(c=>rows.push({n:c,depth:2}));
  });
  return rows;
}
/* сколько СВОИХ целей юнита сейчас видно под текущими разрезами */
function ownFocusCount(path,metKeys){
  return D.ownKpis(path).filter(r=>metKeys.indexOf(r.metric)>=0&&D.ruleMatches(r,state)).length;
}
function expandableRows(root){
  return D.nodesBelow(root,1).filter(n=>D.childrenOf(n.path).length).map(n=>n.path);
}
/* ячейка метрики в строке юнита: цель этого юнита (своя или унаследованная) либо база */
function unitCell(node,m,lp){
  const val=aggLeaves(lp,m.key)[D.LAST];
  const bl=D.baselineFor(node.path,m.key,val,state,state.bench);
  const txt=D.fmtVal(m.key,val);
  if(bl.kind==='kpi'){
    return '<td class="kpi-cell"><span class="v">'+txt+'</span>'+
      '<span class="cell '+bl.state+'"'+U.tip({title:'Цель '+m.name,
        text:bl.inherited?'Унаследована с уровня «'+bl.owner.name+'».':'Стоит на этом юните.',
        rows:[{label:'факт',value:D.fmtVal(m.key,val)},{label:'цель',value:D.fmtVal(m.key,bl.target)}]})+
      '>'+D.fmtVal(m.key,bl.target)+'</span></td>';
  }
  return '<td>'+txt+'</td>';
}
function renderTeams(){
  const liveBlocks=D.BLOCKS.filter(b=>anySelInBlock(b.key));
  let html='<div class="page-h"><div class="ph-row"><h2>Команды</h2></div>'+
    '<p>Сводная таблица по юнитам. Каретка у строки раскрывает её детализацию — юниты уровнем ниже. '+
    'У метрики с утверждённой целью в ячейке подписана цель и её выполнение; у остальных — сравнение с базой '+
    (state.bench==='none'?'выключено':'<b>'+esc(benchName())+'</b>')+'.</p></div>';

  if(liveBlocks.length===0){
    document.getElementById('view').innerHTML=html+
      U.empty('Не выбрано ни одной метрики','Включите метрики на левой полке — блок «Метрики для отображения».');
    return;
  }
  if(!liveBlocks.find(b=>b.key===state.blockTab))state.blockTab=liveBlocks[0].key;
  const block=D.BLOCK_BY_KEY[state.blockTab];
  const mets=selMetricsOfBlock(block.key);
  const mainK=blockMain(block.key);
  const mainM=D.METRIC_BY_KEY[mainK];
  const effSet=new Set(effectiveLeaves());

  html+=U.subTabs(liveBlocks.map(b=>[b.key,b.name]),state.blockTab,'block');

  if(effSet.size===0){
    document.getElementById('view').innerHTML=html+
      U.empty('Нет данных по выбранным разрезам','Снимите один из разрезов на левой полке.');
    return;
  }

  const root=activeUnit();
  let rows=pivotRows(root).filter(r=>rowLeaves(r.n.path).length>0);
  /* «Только фокусные» на «Командах»: юниты, у которых по какой-то из показанных
     метрик проставлена СВОЯ цель. Унаследованная сюда не годится: цель блока
     есть у всей ветки, и фильтр не убрал бы ни одной строки. */
  const metKeys=mets.map(m=>m.key);
  if(state.focusOnly)rows=rows.filter(r=>ownFocusCount(r.n.path,metKeys)>0);

  if(state.selTeam&&!rows.find(r=>r.n.path===state.selTeam))state.selTeam=null;
  if(!state.selTeam&&rows[0])state.selTeam=rows[0].n.path;
  const sel=state.selTeam?D.NODE_BY_PATH[state.selTeam]:D.NODE_BY_PATH[root];

  const expandable=expandableRows(root);
  const allOpen=expandable.length>0&&expandable.every(p=>openRows.has(p));
  const totalLeaves=[...effSet];
  const blMain=D.baselineFor(root,mainK,aggLeaves(totalLeaves,mainK)[D.LAST],state,state.bench);
  const showVs=blMain.kind!=='none';

  /* ИТОГО первой строкой: при длинном списке итог не должен уезжать под скролл.
     Каретка у ИТОГО раскрывает и сворачивает всё дерево разом. */
  let tbl='<table class="ptable dense"><thead><tr><th class="txt">Юнит</th>'+
    mets.map(m=>'<th'+U.tip({title:m.name,text:m.hint})+'>'+esc(m.short)+'</th>').join('')+
    (showVs?'<th class="vs">'+(blMain.kind==='kpi'?'К цели':'К базе')+'<span class="hint-col">'+esc(mainM.short)+'</span></th>':'')+
    '</tr></thead><tbody>';
  tbl+='<tr class="total top"><td class="txt"><span class="row-label">'+
    (expandable.length
      ? U.caret(allOpen,'expall',allOpen?'0':'1',allOpen?'Свернуть всё':'Развернуть всё',
          {title:allOpen?'Свернуть всё':'Развернуть всё',text:'Детализация всех юнитов сразу.'})
      : U.caretSpacer)+
    '<span class="row-body">ИТОГО · '+esc(D.NODE_BY_PATH[root]?D.NODE_BY_PATH[root].name:populationLabel())+
    '<span class="unit-sub">'+D.fmtInt(aggLeaves(totalLeaves,'headcount')[D.LAST])+' чел</span></span></span></td>'+
    mets.map(m=>'<td'+(m.key===mainK?' class="lead"':'')+'>'+D.fmtVal(m.key,aggLeaves(totalLeaves,m.key)[D.LAST])+'</td>').join('')+
    (showVs?'<td class="vs"><span class="cell neutral">'+D.fmtVal(mainK,blMain.kind==='kpi'?blMain.target:blMain.base)+'</span></td>':'')+
    '</tr>';

  rows.forEach(r=>{
    const lp=rowLeaves(r.n.path);
    const v=aggLeaves(lp,mainK)[D.LAST];
    const bl=D.baselineFor(r.n.path,mainK,v,state,state.bench);
    const kids=D.childrenOf(r.n.path).length, canExp=r.depth===1&&kids>0;
    const own=D.ownKpis(r.n.path).filter(x=>metKeys.indexOf(x.metric)>=0);
    const shownOwn=ownFocusCount(r.n.path,metKeys);
    const hiddenOwn=own.length-shownOwn;
    tbl+='<tr class="urow'+(r.depth===2?' lvl2':'')+(state.selTeam===r.n.path?' sel':'')+
        '" data-node="'+r.n.path+'" tabindex="0" role="button">'+
      '<td class="txt"><span class="row-label">'+
      (canExp?U.caret(openRows.has(r.n.path),'exp',r.n.path,'Раскрыть детализацию',
          {title:'Детализация',text:'Юниты уровнем ниже внутри «'+r.n.name+'».'})
        :U.caretSpacer)+
      '<span class="row-body">'+esc(r.n.name)+
        (shownOwn?' <span class="kpi-tag"'+U.tip({title:'Фокус',text:'На юните стоят свои цели.',
            rows:[{label:'целей в фокусе',value:String(shownOwn)}]})+'>Фокус</span>':'')+
        (hiddenOwn?' '+U.multiFocusHint(hiddenOwn):'')+
        '<span class="unit-sub">'+D.levelLabel(r.n.level)+' · '+D.fmtInt(aggLeaves(lp,'headcount')[D.LAST])+' чел</span>'+
      '</span></span></td>'+
      mets.map(m=>unitCell(r.n,m,lp)).join('')+
      (showVs?'<td class="vs">'+(bl.kind==='none'
        ?'<span class="cell neutral">—</span>'
        :'<span class="cell '+bl.state+'">'+D.fmtDelta(mainK,+(v-(bl.kind==='kpi'?bl.target:bl.base)).toFixed(1))+'</span>')+'</td>':'')+
      '</tr>';
  });
  if(!rows.length){
    tbl+='<tr><td class="txt" colspan="'+(mets.length+1+(showVs?1:0))+'">'+
      '<span class="row-body muted-row">'+(state.focusOnly
        ?'Под фильтром «Только фокусные» юнитов не осталось: ни по одной выбранной метрике целей здесь нет.'
        :'Внутри выбранного юнита нет подразделений, проходящих текущие разрезы.')+'</span></td></tr>';
  }
  tbl+='</tbody></table>';

  html+=U.trafficLegend()+'<div class="split">'+
    U.panel({cls:'split-l',title:'Юниты',sub:'клик по строке меняет динамику справа',body:tbl,bodyCls:'tbl-wrap'});

  let right='';
  mets.forEach(m=>{right+='<div class="dyn-block"><h4>'+esc(m.name)+'</h4><div class="dyn-chart" id="dyn-'+m.key+'"></div></div>'});
  html+=U.panel({cls:'split-r',title:'Динамика',sub:sel?sel.name:'—',body:right});
  html+='</div>'+U.tblNote('Данные прототипа сгенерированы детерминированно и не являются фактическими показателями. '+
    'Цели наследуются вниз по дереву: значение юнита сравнивается с ближайшей целью на нём самом или выше по ветке.');

  document.getElementById('view').innerHTML=html;

  if(sel){
    mets.forEach(m=>{
      const s=D.metricSeries(sel.path,m.key);
      const bl=D.baselineFor(sel.path,m.key,s[D.LAST],state,state.bench);
      const bench=(bl.kind==='bench')?D.benchSeries(state.bench,m.key):null;
      mkChart('dyn-'+m.key,CH.lineOption(m.key,s,bench,benchName(),bl.kind==='kpi'?bl.target:null,null));
    });
  }
  document.querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>{state.blockTab=b.getAttribute('data-block');state.selTeam=null;rerender()});
  document.querySelectorAll('[data-exp]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();const p=b.getAttribute('data-exp');
    openRows.has(p)?openRows.delete(p):openRows.add(p);rerender();
  });
  document.querySelectorAll('[data-expall]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    if(b.getAttribute('data-expall')==='1')expandableRows(root).forEach(p=>openRows.add(p));
    else openRows.clear();
    rerender();
  });
  bindRowToggle('.urow','node',p=>{state.selTeam=p;rerender()});
}

/* ================= ВКЛАДКА: ТРАНСФОРМЕРЫ ================= */
const CUTS={
  'IT / nonIT':['IT','nonIT'],
  'Покраска':['HQ','Line','Support'],
  'Стрим':D.STREAMS.slice(1).map(s=>s.key),
  'Специализация':D.SPECS.slice(1).map(s=>s.key),
  'Штат / не штат':['Штат','Не штат'],
  'Тип численности':['Основной состав','Совместители','Проектные','Стажёры']
};
const CUT_SHARES={
  'IT / nonIT':[0.62,0.38],
  'Покраска':[0.42,0.36,0.22],
  'Стрим':[0.24,0.23,0.19,0.18,0.16],
  'Специализация':[0.22,0.18,0.17,0.16,0.14,0.13],
  'Штат / не штат':[0.86,0.14],
  'Тип численности':[0.72,0.12,0.10,0.06]
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
      return +(Math.max(0,b+off+jitter)).toFixed(1);
    });
    return{name:cv,data};
  });
}
function renderTransformer(){
  const tf=state.tf;
  const avail=selMetrics();
  let html='<div class="page-h"><div class="ph-row"><h2>Трансформеры</h2></div>'+
    '<p>Произвольная раскладка метрики по разрезу: динамика по месяцам или сводная таблица. '+
    'Разрезы численности с левой полки уже применены — здесь выбирается только ось разбивки.</p></div>';
  if(avail.length===0){
    document.getElementById('view').innerHTML=html+
      U.empty('Не выбрано ни одной метрики','Включите метрики на левой полке.');
    return;
  }
  if(!avail.find(x=>x.key===tf.metric))tf.metric=avail[0].key;
  const m=D.METRIC_BY_KEY[tf.metric];
  html+='<div class="toolbar">'+
    '<div class="ctl"><label>Метрика</label><select id="tfm">'+
      avail.map(x=>'<option value="'+x.key+'" '+(x.key===tf.metric?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div>'+
    '<div class="ctl"><label>Разрез</label><select id="tfc">'+
      Object.keys(CUTS).map(k=>'<option '+(k===tf.cut?'selected':'')+'>'+esc(k)+'</option>').join('')+'</select></div>'+
    '<div class="sp"></div>'+
    U.subTabs([['dyn','Динамика по разрезу'],['pivot','Сводная таблица']],tf.mode,'mode')+
    '</div>';

  const series=cutMonthlySeries(tf.metric,tf.cut);
  const labels=D.MONTHS.map(mo=>mo.isYearStart?('{y|'+mo.y+'}'):mo.label);

  if(tf.mode==='dyn'){
    html+=U.panel({title:m.name+' · разрез «'+tf.cut+'»',sub:'динамика по месяцам',
      body:'<div class="tf-chart" id="tfChart"></div>'});
    document.getElementById('view').innerHTML=html;
    mkChart('tfChart',CH.groupedBarOption(series,labels,tf.metric));
  }else{
    let t='<table class="ptable dense"><thead><tr><th class="txt">'+esc(tf.cut)+'</th>';
    D.MONTHS.forEach(mo=>t+='<th>'+esc(mo.isYearStart?mo.label+' '+String(mo.y).slice(2):mo.label)+'</th>');
    t+='<th class="vs">За год<span class="hint-col">к '+esc(D.YEAR_LABEL)+'</span></th></tr></thead><tbody>';
    const total=scopeSeries(tf.metric);
    const dyt=+(total[D.LAST]-total[0]).toFixed(1);
    t+='<tr class="total top"><td class="txt"><span class="row-label"><span class="caret-spacer"></span>'+
      '<span class="row-body">ИТОГО</span></span></td>'+
      total.map((v,i)=>'<td class="'+(i===D.LAST?'cur':'')+'">'+D.fmtVal(tf.metric,v)+'</td>').join('')+
      '<td class="vs">'+U.deltaChip(tf.metric,dyt,'за год','Изменение с начала окна ('+D.YEAR_LABEL+').')+'</td></tr>';
    series.forEach(s=>{
      const dy=+(s.data[D.LAST]-s.data[0]).toFixed(1);
      t+='<tr><td class="txt"><span class="row-label"><span class="caret-spacer"></span>'+
        '<span class="row-body">'+esc(s.name)+'</span></span></td>'+
        s.data.map((v,i)=>'<td class="'+(i===D.LAST?'cur':'')+'">'+D.fmtVal(tf.metric,v)+'</td>').join('')+
        '<td class="vs">'+U.deltaChip(tf.metric,dy,'за год','Изменение с начала окна ('+D.YEAR_LABEL+').')+'</td></tr>';
    });
    t+='</tbody></table>';
    html+=U.panel({title:m.name+' · сводная по разрезу «'+tf.cut+'»',sub:'последний месяц выделен',
      body:t,bodyCls:'tbl-wrap'});
    document.getElementById('view').innerHTML=html;
  }
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.tf.mode=b.getAttribute('data-mode');rerender()});
  document.getElementById('tfm').onchange=e=>{state.tf.metric=e.target.value;rerender()};
  document.getElementById('tfc').onchange=e=>{state.tf.cut=e.target.value;rerender()};
}

/* ================= ВКЛАДКА: КАТАЛОГ МЕТРИК ================= */
function renderCatalog(){
  let html='<div class="page-h"><div class="ph-row"><h2>Каталог метрик</h2></div>'+
    '<p>Senior HRBP выбирает действующие метрики — они выходят на сводку с ориентирами и оценкой. '+
    'Метка «показывается» отмечает метрики, включённые сейчас на левой полке.</p></div>';
  html+='<div class="cat-grid">';
  D.BLOCKS.forEach(b=>{
    let list='<ul class="cat-list">';
    D.metricsOfBlock(b.key).forEach(m=>{
      const ref=m.ref==null?'ориентира нет — больше не значит лучше'
        :('ориентир компании: '+(m.better==='higher'?'не ниже ':'не выше ')+D.fmtVal(m.key,m.ref));
      const cnt=D.KPI_RULES.filter(r=>r.metric===m.key).length;
      list+='<li><span class="cat-name">'+esc(m.name)+
        (state.metricSel.has(m.key)?'<span class="cat-badge want">показывается</span>':'')+'</span>'+
        '<span class="cat-meta">'+esc(ref)+(cnt?' · целей в реестре: '+cnt:'')+'</span></li>';
    });
    list+='</ul>';
    html+=U.panel({cls:'cat-panel',title:b.name,sub:'действующие',body:list});
  });
  html+=U.panel({cls:'cat-panel',title:'Прочие',sub:'в разработке',
    body:'<ul class="cat-list">'+D.DEV_METRICS.map(m=>'<li><span class="cat-name">'+esc(m.name)+
      '</span><span class="cat-meta">'+esc(m.note)+'</span></li>').join('')+'</ul>'});
  html+=U.panel({cls:'cat-panel',title:'Прочие',sub:'хотим разработать',
    body:'<ul class="cat-list">'+D.WANTED_METRICS.map(m=>'<li><span class="cat-name">'+esc(m.name)+
      '</span><span class="cat-meta">'+esc(m.note)+'</span></li>').join('')+'</ul>'});
  html+='</div>';
  document.getElementById('view').innerHTML=html;
}

/* ================= ОКНО НАСТРОЙКИ KPI ================= */
function openKpi(){
  const unit=activeUnit();
  const owner=D.hrbpOfUnit(unit)||D.HRBP_BY_ID[state.hrbpId];
  state.kpiDraft={hrbpId:owner.id,unit:unit,metric:'regret',target:'',
    filters:Object.assign({},D.EMPTY_FILTERS)};
  state.kpiOpen=true;
  renderKpiModal();
}
function closeKpi(){state.kpiOpen=false;state.kpiDraft=null;document.getElementById('kpiOvl').classList.add('hidden')}

function kpiUnitOptions(sel){
  return D.NODES.slice().sort((a,b)=>a.sort-b.sort).map(n=>
    '<option value="'+n.path+'" '+(n.path===sel?'selected':'')+'>'+
    '  '.repeat(Math.max(0,n.level-1))+esc(n.name)+
    (D.hasOwnKpi(n.path)?' ●':'')+'</option>').join('');
}
function renderKpiModal(){
  const ovl=document.getElementById('kpiOvl');
  if(!state.kpiOpen){ovl.classList.add('hidden');return}
  const d=state.kpiDraft;
  const m=D.METRIC_BY_KEY[d.metric];
  const unitNode=D.NODE_BY_PATH[d.unit];
  const lp=D.leavesUnder(d.unit).map(l=>l.path).filter(p=>D.leafPasses(p,d.filters));
  const cur=D.resolveKpi(d.unit,d.metric,d.filters);

  /* Что цель накроет: сколько юнитов и людей попадает под выбранные разрезы.
     Без этого числа «поставить KPI на HQ департамента» — действие вслепую. */
  const preview='<b>'+esc(unitNode?unitNode.name:d.unit)+'</b> — '+lp.length+' '+
    U.plural(lp.length,'юнит','юнита','юнитов')+', '+D.fmtInt(D.lastVal(lp,'headcount'))+' чел под выбранными разрезами.<br>'+
    'Факт по метрике сейчас: <b>'+(lp.length?D.fmtVal(d.metric,D.lastVal(lp,d.metric)):'—')+'</b>. '+
    (cur?('Действующая цель: <b>'+D.fmtVal(d.metric,cur.rule.target)+'</b>'+
      (cur.inherited?' (наследуется с уровня «'+esc(cur.owner.name)+'»)':' (стоит на этом юните)')+'.')
     :'Цели на этой ветке пока нет.')+
    '<br>Новая цель начнёт действовать с этого юнита и вниз по всей ветке, пока ниже не встретится своя.';

  const cutsHtml=D.FILTER_DEFS.map((f,i)=>
    '<div class="fgrp"><label>'+(i+3)+' · '+esc(f.label)+'</label>'+
    '<div class="ctl"><select data-kcut="'+f.key+'">'+
      f.list.map(o=>'<option value="'+o.key+'" '+(d.filters[f.key]===o.key?'selected':'')+'>'+esc(o.name)+'</option>').join('')+
    '</select></div></div>').join('');

  /* реестр целей выбранного юнита */
  const own=D.ownKpis(d.unit);
  const list=own.length
    ? '<table class="ptable dense kpi-list"><thead><tr><th class="txt">Метрика</th><th class="txt">Разрезы</th><th>Цель</th><th></th></tr></thead><tbody>'+
      own.map(r=>'<tr><td class="txt"><span class="row-body">'+esc(D.METRIC_BY_KEY[r.metric].name)+'</span></td>'+
        '<td class="txt"><span class="row-body">'+esc(D.filterLabel(r.filters))+'</span></td>'+
        '<td class="lead">'+D.fmtVal(r.metric,r.target)+'</td>'+
        '<td><button class="btn ghost xs" data-kdel="'+r.id+'" aria-label="Удалить цель">×</button></td></tr>').join('')+
      '</tbody></table>'
    : '<div class="fhint">На этом юните пока нет своих целей — он наследует цели сверху.</div>';

  ovl.classList.remove('hidden');
  ovl.innerHTML=
    '<div class="modal wide" role="dialog" aria-modal="true" aria-label="Настройка KPI">'+
      '<div class="modal-h"><h3>Настроить KPI</h3>'+
      '<p>Цель ставится на юнит и наследуется вниз по всей его ветке. Если ниже поставить свою цель — начиная с того уровня работает она. '+
      'Разрезы численности сужают, к какой части людей цель применяется: пока тот же разрез не выбран в фильтрах отчёта, такая цель в отчёте не показывается.</p></div>'+
      '<div class="modal-b setup-cols">'+
        '<div class="sc-col">'+
          '<div class="fgrp"><label>1 · HRBP</label><div class="ctl"><select id="kHrbp">'+
            D.HRBP.map(x=>'<option value="'+x.id+'" '+(x.id===d.hrbpId?'selected':'')+'>'+esc(x.name)+' · '+x.role+'</option>').join('')+
          '</select></div><div class="fhint">Кто ставит цель. По умолчанию — HRBP, в чью зону входит юнит.</div></div>'+
          '<div class="fgrp"><label>2 · Юнит</label><div class="ctl"><select id="kUnit">'+kpiUnitOptions(d.unit)+'</select></div>'+
            '<div class="fhint">● — на юните уже стоят свои цели. '+esc(unitNode?D.pathLabel(d.unit):'')+'</div></div>'+
          cutsHtml+
        '</div>'+
        '<div class="sc-col">'+
          '<div class="fgrp"><label>9 · Метрика</label><div class="ctl"><select id="kMetric">'+
            D.BLOCKS.map(b=>'<optgroup label="'+esc(b.name)+'">'+
              D.metricsOfBlock(b.key).filter(x=>D.targetable(x.key)).map(x=>
                '<option value="'+x.key+'" '+(x.key===d.metric?'selected':'')+'>'+esc(x.name)+'</option>').join('')+
              '</optgroup>').join('')+
          '</select></div><div class="fhint">В списке только метрики, у которых «лучше» имеет направление. На нейтральные цель не ставится.</div></div>'+
          '<div class="fgrp"><label>10 · Целевое значение</label>'+
            '<div class="ctl kpi-val"><input type="number" step="0.1" id="kTarget" value="'+esc(d.target)+'" placeholder="'+(m.ref==null?'':m.ref)+'">'+
            '<span class="kpi-unit">'+esc(m.unit)+'</span></div>'+
            '<div class="fhint">'+(m.better==='higher'?'Выше — лучше: цель считается выполненной при значении не ниже цели.'
              :'Ниже — лучше: цель считается выполненной при значении не выше цели.')+
            (m.ref!=null?' Ориентир компании — '+D.fmtVal(d.metric,m.ref)+'.':'')+'</div></div>'+
          '<div class="bench-preview">'+preview+'</div>'+
          '<div class="fgrp last"><label>Цели этого юнита</label>'+list+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="modal-f"><div class="sp"></div>'+
        '<button class="btn" id="kCancel">Закрыть</button>'+
        '<button class="btn primary" id="kApply">Поставить цель</button></div>'+
    '</div>';

  document.getElementById('kHrbp').onchange=e=>{d.hrbpId=e.target.value};
  document.getElementById('kUnit').onchange=e=>{d.unit=e.target.value;renderKpiModal()};
  document.getElementById('kMetric').onchange=e=>{d.metric=e.target.value;renderKpiModal()};
  document.getElementById('kTarget').oninput=e=>{d.target=e.target.value};
  document.querySelectorAll('[data-kcut]').forEach(s=>s.onchange=e=>{
    d.filters[s.getAttribute('data-kcut')]=e.target.value;renderKpiModal();
  });
  document.querySelectorAll('[data-kdel]').forEach(b=>b.onclick=()=>{
    D.removeKpi(b.getAttribute('data-kdel'));renderKpiModal();rerenderKeepModal();
  });
  document.getElementById('kCancel').onclick=closeKpi;
  document.getElementById('kApply').onclick=()=>{
    const v=parseFloat(String(d.target).replace(',','.'));
    if(!isFinite(v)){document.getElementById('kTarget').focus();return}
    D.addKpi({hrbpId:d.hrbpId,unit:d.unit,metric:d.metric,target:v,filters:d.filters});
    d.target='';
    renderKpiModal();rerenderKeepModal();
  };
}
/* перерисовка отчёта, не трогая открытое окно */
function rerenderKeepModal(){
  disposeCharts();renderShelf();renderChips();renderView();
}

/* ================= РОУТИНГ ================= */
function renderView(){
  document.querySelectorAll('.tab-top').forEach(n=>{
    const on=n.getAttribute('data-tab')===state.tab;
    n.classList.toggle('active',on);
    if(on)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');
  });
  if(state.tab==='onepager')renderOnePager();
  else if(state.tab==='teams')renderTeams();
  else if(state.tab==='transformer')renderTransformer();
  else renderCatalog();
}
function rerender(){
  disposeCharts();
  renderShelf();
  renderChips();
  renderView();
  renderKpiModal();
}
document.querySelectorAll('.tab-top').forEach(n=>n.onclick=()=>{state.tab=n.getAttribute('data-tab');state.openMetric=null;rerender()});
document.getElementById('btnKpi').onclick=openKpi;
document.getElementById('kpiOvl').onclick=e=>{if(e.target.id==='kpiOvl')closeKpi()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.kpiOpen)closeKpi()});
rerender();
