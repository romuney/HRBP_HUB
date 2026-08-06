/* ============================================================
   HRBP HUB — общий слой UI (дизайн-система TeamPulse).
   Экраны не пишут разметку компонентов сами: любой переиспользуемый
   элемент сначала появляется здесь. Иначе одинаковые по смыслу вещи
   расходятся между вкладками.
   ============================================================ */
(function(){
'use strict';
const D=window.HRBPDATA;

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

/* ---------- Подсказки: один механизм на весь отчёт ----------
   Атрибут title= запрещён: он появляется через секунду, выглядит системным
   и не умеет в вёрстку. Содержимое собирает единый конструктор — руками
   теги в подсказке не клеим, иначе строки расходятся по кеглю и порядку. */
function tipHtml(o){
  if(o==null)return '';
  if(typeof o==='string')return esc(o);
  let s='';
  if(o.title)s+='<span class="t-h">'+esc(o.title)+'</span>';
  if(o.text) s+='<span class="t-x">'+esc(o.text)+'</span>';
  (o.rows||[]).forEach(r=>{
    if(!r)return;
    const mk=r.color?'<i class="t-m'+(r.dash?' dash':'')+'" style="'+
      (r.dash?'border-top-color:':'background:')+r.color+'"></i>':'';
    s+='<span class="t-r'+(r.dash?' bench':'')+'">'+mk+
       '<span class="t-l">'+esc(r.label)+'</span>'+
       '<b class="t-v">'+esc(r.value)+'</b></span>';
  });
  const ns=o.note==null?[]:(Array.isArray(o.note)?o.note:[o.note]);
  ns.forEach(n=>{if(n)s+='<span class="t-n">'+esc(n)+'</span>'});
  return s;
}
/* единственный способ поставить подсказку в разметке */
function tip(o){return ' data-tip="'+esc(tipHtml(o))+'"'}

(function bindTip(){
  let el=null, cur=null;
  function node(){
    if(!el){el=document.createElement('div');el.className='tip';el.setAttribute('role','tooltip');document.body.appendChild(el)}
    return el;
  }
  function place(n,x,y){
    const w=n.offsetWidth||220,h=n.offsetHeight||60;
    let l=x+16,t=y-h-14;
    if(l+w>innerWidth-10)l=x-w-16;
    if(l<10)l=10;
    if(t<10)t=y+20;
    n.style.left=Math.round(l)+'px';n.style.top=Math.round(t)+'px';
  }
  function hide(){if(el)el.classList.remove('on');cur=null}
  document.addEventListener('mousemove',e=>{
    const t=e.target.closest?e.target.closest('[data-tip]'):null;
    if(!t){if(cur)hide();return}
    const n=node();
    if(cur!==t){cur=t;n.innerHTML=t.getAttribute('data-tip')||''}
    n.classList.add('on');place(n,e.clientX,e.clientY);
  },{passive:true});
  document.addEventListener('mouseleave',hide,true);
  document.addEventListener('click',hide,true);
  addEventListener('scroll',hide,true);
})();

/* ---------- Пилюля изменения ----------
   Направление — знаком, оценка — классом, база сравнения — внутри пилюли. */
function deltaChip(metricKey,dv,vsShort,tipText){
  const cls=D.deltaClass(metricKey,dv);
  return '<span class="delta '+cls+'"'+tip({title:'Изменение',text:tipText||'',
      rows:[{label:'значение',value:D.fmtDelta(metricKey,dv)}]})+'>'+
    D.fmtDelta(metricKey,dv)+(vsShort?'<span class="d-vs">'+esc(vsShort)+'</span>':'')+'</span>';
}
function momChip(metricKey,dv){return deltaChip(metricKey,dv,'к '+D.PREV_LABEL.split(' ')[0],'Сравнение с предыдущим месяцем ('+D.PREV_LABEL+').')}
function yoyChip(metricKey,dv){return deltaChip(metricKey,dv,'год к году','Сравнение с тем же месяцем прошлого года ('+D.YEAR_LABEL+').')}

/* метрика, которую с базой сравнивать бессмысленно, помечается словами,
   а не прочерком: прочерк читается как «данных нет» */
function noCmpMark(reason){
  return '<span class="nocmp"'+tip({title:'Сравнение отключено',
    text:reason||'Абсолютная величина: сравнение со средней по компании показывало бы масштаб, а не оценку.'})+
    '>не сравнивается</span>';
}
function infoDot(o){return '<span class="info"'+tip(o)+' aria-hidden="true">i</span>'}

/* ---------- Метка цели ----------
   «Фокус» — цель стоит на самом юните. «Фокус через родителя» — юнит
   наследует цель сверху; в подсказке написано, откуда именно. */
function focusTag(bl){
  if(!bl||bl.kind!=='kpi')return '';
  /* Своя цель — жёлтая метка со звездой. Дизайн-система запрещает жёлтый
     в СВЕТОФОРЕ, но это не оценка: метка отвечает на вопрос «чей это фокус»,
     а не «хорошо или плохо». Отдельный канал — отдельный цвет, и своя цель
     находится в списке мгновенно. */
  if(!bl.inherited)return '<span class="kpi-tag own"'+tip({title:'Фокус юнита',
    text:'Цель установлена на этом юните и уходит вниз по всей его ветке.',
    rows:[{label:'юнит',value:bl.owner.name}]})+'>★ Фокус</span>';
  return '<span class="kpi-tag inh"'+tip({title:'Фокус через родителя',
    text:'Своей цели у юнита нет — он наследует её сверху. Появится своя — начнёт работать она, и вниз пойдёт уже новое значение.',
    rows:[{label:'цель с уровня',value:bl.owner.name}]})+'>Фокус через родителя</span>';
}
/* Подсказка про цели, закрытые фильтрами.
   Раньше она говорила «примените фильтры» и не говорила КАКИЕ — HRBP видел,
   что фокус есть, но не знал, куда идти. Теперь цели перечислены поимённо:
   разрез, метрика и значение. */
function multiFocusHint(rules,withMetric){
  if(!rules||!rules.length)return '';
  const D=window.HRBPDATA;
  const rows=rules.slice(0,3).map(r=>({
    label:(withMetric?D.METRIC_BY_KEY[r.metric].short+' · ':'')+D.filterLabel(r.filters),
    value:D.fmtVal(r.metric,r.target)
  }));
  const notes=['Примените эти разрезы в фильтрах слева — тогда цель станет фокусом отчёта.'];
  if(rules.length>3)notes.unshift('Показаны 3 из '+rules.length+'.');
  return '<span class="more-focus"'+tip({
    title:'Ещё '+rules.length+' '+plural(rules.length,'цель','цели','целей')+' по разрезам численности',
    rows:rows,note:notes})+'>+'+rules.length+' по разрезам</span>';
}

function plural(n,one,few,many){
  const m10=n%10,m100=n%100;
  if(m10===1&&m100!==11)return one;
  if(m10>=2&&m10<=4&&(m100<10||m100>=20))return few;
  return many;
}

/* ---------- KPI-карточка ----------
   Карточка рисует РОВНО ЧЕТЫРЕ строки всегда, даже если четвёртая пустая:
   иначе значения соседних карточек съезжают друг относительно друга. */
function kpiCard(o){
  return '<div class="kpi">'+
    '<div class="k-label">'+esc(o.label)+(o.q||'')+'</div>'+
    '<div class="k-val'+(o.small?' sm':'')+'">'+(o.raw?o.value:esc(o.value))+'</div>'+
    '<div class="k-row">'+(o.row1||'')+'</div>'+
    '<div class="k-row">'+(o.row2||'')+'</div>'+
    '</div>';
}
function kpis(cards,cls){
  return '<div class="kpis compact'+(cards.length<=5?' n'+cards.length:'')+(cls?' '+cls:'')+'">'+cards.join('')+'</div>';
}

/* ---------- Панель ---------- */
function panel(o){
  return '<div class="panel'+(o.cls?' '+o.cls:'')+'">'+
    '<div class="panel-h'+(o.tabs?' with-tabs':'')+'"><div class="h-txt"><span>'+esc(o.title)+'</span>'+
    (o.sub?'<span class="sub">'+esc(o.sub)+'</span>':'')+'</div>'+(o.tabs||'')+'</div>'+
    '<div class="panel-b'+(o.bodyCls?' '+o.bodyCls:'')+'">'+o.body+'</div></div>';
}
function subTabs(list,active,attr){
  return '<div class="sub-tabs">'+list.map(t=>
    '<button class="sub-tab'+(t[0]===active?' active':'')+'" data-'+(attr||'sub')+'="'+t[0]+'">'+esc(t[1])+
    (t[2]!=null?'<span class="sub-badge">'+t[2]+'</span>':'')+'</button>').join('')+'</div>';
}
/* каретка раскрытия — своя колонка, не приклеена к тексту.
   Строки без детей получают распорку: имена стоят на одной вертикали. */
function caret(open,attr,val,label,tipObj){
  return '<button class="caret-btn"'+(open?' data-open="1"':'')+' data-'+attr+'="'+esc(val)+'"'+
    ' aria-expanded="'+(open?'true':'false')+'" aria-label="'+esc(label)+'"'+(tipObj?tip(tipObj):'')+'>'+
    (open?'▾':'▸')+'</button>';
}
const caretSpacer='<span class="caret-spacer"></span>';

/* пустое состояние всегда говорит, ЧТО СДЕЛАТЬ */
function empty(title,text){
  return '<div class="empty"><b>'+esc(title)+'</b>'+esc(text)+'</div>';
}
function note(html){return '<div class="note-inline">'+html+'</div>'}
function tblNote(html){return '<div class="tbl-note">'+html+'</div>'}
function trafficLegend(){
  return '<div class="legend">'+
    '<span class="sw"><span class="dot" style="background:var(--green-bg)"></span> лучше цели или базы</span>'+
    '<span class="sw"><span class="dot" style="background:var(--red-bg)"></span> хуже цели или базы</span>'+
    '<span class="sw"><span class="dot" style="background:#f3f4f6"></span> в пределах ±5% или без оценки</span>'+
    '</div>';
}

/* ---------- Цветная ячейка сравнения ---------- */
function cell(state,text,sub,tipObj){
  return '<span class="cell '+state+'"'+(tipObj?tip(tipObj):'')+'>'+text+
    (sub?'<span class="cell-sub">'+esc(sub)+'</span>':'')+'</span>';
}

/* ---------- Спарклайн ----------
   Тренд в строке таблицы. Ось от нуля, и цвет несёт КАЖДЫЙ бар, а не только
   последний: месяц, в котором команда вышла за цель, должен быть виден в
   строке, иначе спарклайн показывает форму, но молчит про оценку. */
function spark(series,states){
  const w=150,h=30,n=series.length,pad=3;
  const mx=Math.max(...series,0)||1;
  const bw=(w-pad*2)/n;
  let bars='';
  series.forEach((v,i)=>{
    const bh=Math.max(1.5,(v/mx)*(h-4));
    const x=pad+i*bw, y=h-bh;
    bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+Math.max(1,bw-2).toFixed(1)+
      '" height="'+bh.toFixed(1)+'" rx="1.5" class="sb '+(states[i]||'neutral')+'"/>';
  });
  return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" aria-hidden="true">'+bars+'</svg>';
}

window.HRBPUI={esc,tipHtml,tip,deltaChip,momChip,yoyChip,noCmpMark,infoDot,
  focusTag,multiFocusHint,plural,kpiCard,kpis,panel,subTabs,caret,caretSpacer,
  empty,note,tblNote,trafficLegend,cell,spark};
})();
