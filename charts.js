/* ============================================================
   HRBP HUB — графики.

   Все линии строятся «период к периоду»: прошлый период идёт бледной линией
   без подписей, текущий — тёмной с подписями значений. Периода два и они
   вложены друг в друга, как обзор и зум на карте:
     • год к году — двенадцать месяцев, текущий год против прошлого. Обзор:
       видно сезон и то, где метрика была год назад;
     • неделя к неделе — последние двенадцать недель против предыдущих
       двенадцати. Зум: в помесячной линии июньский разворот — одна точка,
       в недельной — три, и сразу ясно, когда именно он случился.
   Ориентир (цель или база) один и тот же на обоих: цель — плоская линия,
   и сравнивать её со скользящим окном было бы не с чем.

   Правила дизайн-системы, которые здесь обязательны:
     • подписи одного кегля и одного цвета, с белым halo;
     • заголовок слева, легенда справа — не накладываются;
     • обе линии — линии: заливка под одной из них делала бы её другим
       типом графика, и глаз сравнивал бы площадь с линией;
     • у столбиков шкала ВСЕГДА от нуля — длина столбика и есть значение;
     • у линий шкала подбирается по данным, и тогда ось Y обязательна
       (см. valueAxis — там же написано, почему это не двойной стандарт).
   ============================================================ */
(function(){
const FONT='Inter, Helvetica, Arial, sans-serif';
const C_LABEL='#2b2b2b', C_AXIS='#8a909c', C_AXIS_LINE='#9ba4b5';
const C_CUR='#3a3f4a', C_PREV='#c7c8cc', C_BENCH='#9aa0ac', C_KPI='#2b6cff';
const C_NOW='#b0b7c4';   // «вы здесь»: отметка текущего месяца
const C_GRID='#eef0f4';  // сетка значений: видна, но не спорит с линиями
const SERIES_PALETTE=['#5f86c2','#97dece','#ac87c5','#cdbf97','#85cdfd','#9fae6a','#c98aa6','#686d76'];
const VAL_SZ=11;
const HEAD_H=22;   // полоса заголовка и легенды: график под неё не заезжает

const D=window.HRBPDATA;

/* ---- Шкала значений для ЛИНИЙ ----
   Почему здесь нет обязательного нуля, хотя у столбиков он обязателен.
   У столбика значение — длина, и срез низа искажает саму длину. У линии
   значение — положение точки, а читают в ней НАКЛОН. Закрепляемость 76–80%
   на шкале 0–100 — прямая под потолком: три четверти полотна пустуют, а вся
   история метрики жмётся в верхнюю пятнадцатую. Это не осторожность, это
   потеря сигнала.
   Плата за подобранную шкалу ровно одна: диапазон обязан быть виден. Поэтому
   вместе со срезом появляется ось Y — но ровно три подписи: низ коридора,
   верх коридора и цель. Промежуточные деления здесь лишние: значения и так
   подписаны у точек, а лишние подписи цепляются за январскую — она стоит
   у самого края полотна. Цель подписана синим, тем же цветом, что и её линия.
   Ноль возвращается в кадр сам, когда данные подошли к нему ближе
   собственного размаха: у прогулов и текучести расстояние до нуля — это и
   есть смысл метрики. */
function niceStep(raw){
  const pow=Math.pow(10,Math.floor(Math.log10(Math.max(raw,1e-9))));
  const n=raw/pow;
  return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*pow;
}
/* Общая одежда шкалы значений: бледная сетка, подписи делений, никакой
   вертикальной черты — линию оси заменяет сама сетка. */
function axisSkin(metricKey,step,extra){
  return Object.assign({type:'value',interval:step,
    axisLine:{show:false},axisTick:{show:false},
    /* margin отодвигает подписи шкалы от полотна: январская точка стоит
       вплотную к оси, и её подпись иначе смыкается с подписью коридора. */
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,margin:13,formatter:axisFmt(metricKey)},
    splitLine:{lineStyle:{color:C_GRID,width:1}}},extra);
}
/* Шкала для СТОЛБИКОВ — всегда от нуля: у столбика значение закодировано
   длиной, и срезанный низ врёт прямо пропорционально срезу. */
function zeroAxis(metricKey,maxVal){
  const mx=Math.max(maxVal,1e-6);
  const step=niceStep(mx/4);
  return axisSkin(metricKey,step,{min:0,max:Math.ceil(mx/step)*step});
}
/* Подпись деления. Дробная часть — только у тех делений, где она есть:
   «5,0%» рядом с «7,5%» обещает точность, которой на сетке нет, а округление
   7,5 до «8» ставит подпись, не совпадающую с линией. */
function axisFmt(metricKey){
  const m=D.METRIC_BY_KEY[metricKey];
  return v=>{
    if(m.fmt==='int')return D.fmtInt(v);
    const s=Math.abs(v%1)<1e-9?String(Math.round(v)):v.toFixed(1).replace('.',',');
    return m.fmt==='days'?s+D.THIN+'дн':s+'%';
  };
}
/* Возвращает МАССИВ осей: основная (низ и верх коридора) и, если цель попала
   внутрь коридора, вторая — невидимая, ради единственной синей подписи на
   уровне цели. Своих делений у ECharts на произвольном значении нет, поэтому
   шаг второй оси подобран так, чтобы её первое деление легло ровно на цель. */
function valueAxis(metricKey,values,kpi){
  const v=values.filter(x=>x!=null&&isFinite(x));
  let lo=Math.min(...v), hi=Math.max(...v);
  if(!isFinite(lo)||!isFinite(hi)){lo=0;hi=1}
  let span=hi-lo;
  if(!(span>0))span=Math.max(Math.abs(hi)*0.15,1);
  const pad=span*0.15;
  const zeroBased=lo<=span;                 // ноль ближе размаха — держим его
  const step=niceStep(((hi+pad)-(zeroBased?0:lo-pad))/3);
  let min=zeroBased?0:Math.max(0,Math.floor((lo-pad)/step)*step);
  let max=Math.ceil((hi+pad)/step)*step;
  if(D.isShare(metricKey)&&max>100)max=100; // доля выше 100% не бывает
  const main=axisSkin(metricKey,max-min,{min,max});
  if(kpi==null||kpi<=min||kpi>=max)return [main];
  const gap=kpi-min;
  if((max-min)/gap>40)return [main];        // цель у самого низа: делений станут сотни
  const fmt=axisFmt(metricKey);
  return [main,{type:'value',min,max,interval:gap,position:'left',offset:0,
    axisLine:{show:false},axisTick:{show:false},splitLine:{show:false},
    axisLabel:{fontFamily:FONT,fontSize:VAL_SZ,color:C_KPI,fontWeight:700,margin:13,
      formatter:x=>Math.abs(x-kpi)<1e-9?fmt(x):''}}];
}
/* Ось периодов — месяцев или недель. Засечки под каждым делением: без них
   подписи висят под сплошной чертой, и точка на линии не привязана глазом
   к своему месяцу.
   nowIdx — последний закрытый период: он подписан жирным и тёмным, чтобы
   «где мы сейчас» читалось без пересчёта делений от начала года. */
function catAxis(labels,nowIdx){
  return {type:'category',data:labels,boundaryGap:false,
    axisLine:{lineStyle:{color:C_AXIS_LINE}},
    axisTick:{show:true,alignWithLabel:true,length:4,lineStyle:{color:C_AXIS_LINE}},
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,interval:0,
      formatter:(v,i)=>i===nowIdx?'{now|'+v+'}':v,
      rich:{now:{fontFamily:FONT,fontSize:VAL_SZ,fontWeight:800,color:C_LABEL}}}};
}
/* Вертикальная отметка текущего месяца. Тонкая и сплошная: пунктиром на
   полотне уже сказаны цель и база, четвёртый пунктирный объект перестаёт
   что-либо выделять. Стрелки у оси нет — жирная подпись месяца показывает
   то же самое и не добавляет фигуры.
   Живёт на фоновой серии: линия текущего года проходит поверх неё. */
function nowMark(idx){
  if(idx==null||idx<0)return undefined;
  return {silent:true,symbol:['none','none'],
    label:{show:false},emphasis:{disabled:true},animation:false,
    lineStyle:{type:'solid',width:1,color:C_NOW,opacity:1},
    data:[{xAxis:idx}]};
}
function valueLabel(metricKey){
  return {show:true,position:'top',distance:7,
    fontFamily:FONT,fontSize:VAL_SZ,fontWeight:700,color:C_LABEL,
    textBorderColor:'#fff',textBorderWidth:3.2,
    formatter:p=>p.value==null?'':D.fmtVal(metricKey,p.value)};
}
function head(title,legendData){
  return {
    title:title?{text:title,left:0,top:0,
      textStyle:{fontFamily:FONT,fontSize:13,fontWeight:700,color:'#1f1f1f'}}:undefined,
    legend:{data:legendData,right:0,top:0,itemWidth:18,itemHeight:8,itemGap:14,
      icon:'roundRect',textStyle:{fontFamily:FONT,fontSize:11,color:'#8a909c'}}
  };
}
function tooltipBase(){
  return {trigger:'axis',axisPointer:{type:'line',lineStyle:{color:'#cfd3da'}},
    backgroundColor:'#fff',borderColor:'#e7e9ee',borderWidth:1,
    extraCssText:'box-shadow:0 10px 30px rgba(24,33,50,.18);border-radius:9px;',
    textStyle:{fontFamily:FONT,color:'#3a3f4a',fontSize:12}};
}
/* Подсказка. Жирным и чёрным — только текущий период: он тот, о котором
   спрашивают, остальные строки в подсказке отвечают «относительно чего».
   Прошлый период и ориентиры уходят в серый, а у текущего значения появляется
   та же пилюля оценки, что и в таблице: цвет заводится один раз в дизайн-
   системе, и подсказка не изобретает второй язык для того же светофора.
   opts: {primary, head:i=>строка, sub:(name,i)=>строка, state:(i,v)=>оценка} */
function tooltipRows(metricKey,opts){
  opts=opts||{};
  return function(ps){
    const i=ps[0].dataIndex;
    const title=opts.head?opts.head(i):ps[0].axisValueLabel;
    let s='<div style="font-family:'+FONT+';min-width:190px">'+
      '<div style="color:#8a909c;font-size:10.5px;margin-bottom:6px">'+title+'</div>';
    /* Текущий период — первой строкой: подсказку читают сверху вниз, и
       отвечать она должна с того, о чём спросили. */
    const rank=p=>{
      if(opts.primary&&p.seriesName===opts.primary)return 0;
      return (p.seriesName==='Цель'||p.seriesName.indexOf('База')===0)?2:1;
    };
    ps.slice().sort((a,b)=>rank(a)-rank(b)).forEach(p=>{
      if(p.value==null)return;
      const dash=p.seriesName==='Цель'||p.seriesName.indexOf('База')===0;
      const primary=opts.primary?p.seriesName===opts.primary:!dash;
      const sub=opts.sub?opts.sub(p.seriesName,i):'';
      const st=primary&&opts.state?opts.state(i,p.value):null;
      const val=D.fmtVal(metricKey,p.value);
      s+='<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:4px">'+
        '<span style="color:'+(primary?'#3a3f4a':'#8a909c')+'">'+
        '<span style="display:inline-block;width:12px;height:'+(dash?'0':'9px')+';'+
        (dash?'border-top:2px dashed '+p.color+';vertical-align:middle;':'border-radius:3px;background:'+p.color+';')+
        'margin-right:7px"></span>'+p.seriesName+
        (sub?'<span style="display:block;color:#aab0bb;font-size:10px;margin-left:19px">'+sub+'</span>':'')+
        '</span>'+
        (st?'<span class="cell '+st+'" style="font-size:11.5px;padding:3px 7px">'+val+'</span>'
           :'<b style="font-variant-numeric:tabular-nums;font-weight:'+(primary?700:600)+
             ';color:'+(primary?'#1f1f1f':'#8a909c')+'">'+val+'</b>')+
        '</div>';
    });
    return s+'</div>';
  };
}

/* Точки текущего периода.
   Крайние подписи прижимаются к полотну и налезают на шкалу: у первой точки
   подпись уходит влево от оси, у последней — за правый край. Сдвигаем внутрь
   ровно эти две, остальные стоят по центру над точкой.
   sparse — режим для длинных рядов: двенадцать подписей подряд слипаются в
   строку цифр, из которой ничего не читается. Оставляем те четыре, ради
   которых на график и смотрят: начало, конец, пик и провал. Остальные
   значения никуда не делись — они в подсказке. */
function pointData(arr,sparse,flipFirst){
  const live=[];
  arr.forEach((v,i)=>{if(v!=null)live.push({v,i})});
  if(!live.length)return arr;
  const first=live[0].i, last=live[live.length-1].i;
  let keep=null;
  if(sparse){
    let mn=live[0], mx=live[0];
    live.forEach(x=>{if(x.v<mn.v)mn=x;if(x.v>mx.v)mx=x});
    keep=[first,last,mn.i,mx.i];
  }
  return arr.map((v,i)=>{
    if(v==null)return v;
    if(keep&&keep.indexOf(i)<0)return {value:v,label:{show:false}};
    /* Первая точка встала вровень с целью — её подпись уходит под точку:
       сдвига вправо тут мало, синяя подпись цели стоит на той же высоте. */
    if(i===first)return {value:v,label:flipFirst?{offset:[13,0],position:'bottom'}:{offset:[13,0]}};
    if(i===last)return {value:v,label:{offset:[-13,0]}};
    return v;
  });
}

/* ---- Общий конструктор сравнения «период к периоду» ----
   Год к году и неделя к неделе — один и тот же приём: тёмная линия текущего
   периода с подписями, бледная — предыдущего, и общий для обоих ориентир.
   Разное у них только календарь по оси X, поэтому и код у них общий: иначе
   два графика об одной метрике начнут расходиться в мелочах.
   cfg:  {labels, curName, prevName, cur, prev, boldIdx, markIdx, sparse, head, sub}
   opts: {kpi, bench, benchLabel, title}
   Цель и база взаимоисключающи: есть утверждённая цель — сравниваемся только
   с ней, второй ориентир рядом заставлял бы выбирать, по какому судить. */
function comparisonOption(metricKey,cfg,opts){
  opts=opts||{};
  const legend=[cfg.curName,cfg.prevName];
  /* Шкалу считаем по ВСЕМУ, что нарисовано, включая ориентир: цель, ушедшая
     за край полотна, — это «мы не дотягиваем» без единого свидетельства. */
  const scaleVals=cfg.prev.filter(v=>v!=null).concat(cfg.cur.filter(v=>v!=null));
  if(opts.kpi!=null)scaleVals.push(opts.kpi);
  else if(opts.bench)opts.bench.filter(v=>v!=null).forEach(v=>scaleVals.push(v));
  const kpiLine=opts.kpi!=null?opts.kpi:null;
  const yAxes=valueAxis(metricKey,scaleVals,kpiLine);
  /* Подпись первой точки и синяя подпись цели встают на одной высоте — разводим.
     Сравниваем не сами значения, а высоту ПОДПИСИ: она висит над точкой, и
     точка ниже цели на полтора пункта даёт подпись ровно на уровне цели. */
  const firstVal=cfg.cur.find(v=>v!=null);
  const span=yAxes[0].max-yAxes[0].min;
  const flipFirst=kpiLine!=null&&firstVal!=null&&
    Math.abs(firstVal+span*0.09-kpiLine)<span*0.085;

  /* Прошлый период — та же форма записи, что и текущий: линия с точками.
     Разделяют их вес и цвет, а не тип графика. */
  const data=[
    {name:cfg.prevName,type:'line',smooth:false,symbol:'circle',symbolSize:4,
      lineStyle:{width:2,color:C_PREV},itemStyle:{color:C_PREV},
      data:cfg.prev,z:2,label:{show:false},markLine:nowMark(cfg.markIdx)},
    {name:cfg.curName,type:'line',smooth:false,symbol:'circle',symbolSize:5,
      lineStyle:{width:2.6,color:C_CUR},itemStyle:{color:C_CUR},
      data:pointData(cfg.cur,cfg.sparse,flipFirst),z:5,connectNulls:false,
      label:valueLabel(metricKey)}
  ];
  let stateOf=null;
  if(opts.kpi!=null){
    legend.push('Цель');
    data.push({name:'Цель',type:'line',symbol:'none',data:cfg.labels.map(()=>opts.kpi),z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_KPI},itemStyle:{color:C_KPI},label:{show:false}});
    stateOf=(i,v)=>D.stateForKpi(metricKey,v,opts.kpi);
  }else if(opts.bench){
    const b=opts.bench;
    const nm='База · '+(opts.benchLabel||'вся компания');
    legend.push(nm);
    data.push({name:nm,type:'line',symbol:'none',data:b,z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_BENCH},itemStyle:{color:C_BENCH},label:{show:false}});
    stateOf=(i,v)=>b[i]==null?null:D.compareState(metricKey,v,b[i]);
  }
  return Object.assign(head(opts.title,legend),{
    /* Поля по краям — не про красоту: подпись значения шире точки, над которой
       стоит, и у крайних точек она уходит на шкалу. Запас держит их порознь. */
    grid:{left:30,right:26,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{formatter:tooltipRows(metricKey,
      {primary:cfg.curName,head:cfg.head,sub:cfg.sub,state:stateOf})}),
    xAxis:catAxis(cfg.labels,cfg.boldIdx),
    yAxis:yAxes,
    series:data,animationDuration:600,animationEasing:'cubicOut'
  });
}

/* ---- Год к году: двенадцать месяцев, текущий год против прошлого ---- */
function yoyOption(metricKey,series,opts){
  opts=opts||{};
  return comparisonOption(metricKey,{
    labels:D.MONTH_ABBR,
    curName:String(D.YEAR_CUR), prevName:String(D.YEAR_PREV),
    cur:D.curYearOf(series), prev:D.prevYearOf(series),
    boldIdx:D.CUR_LEN-1, markIdx:D.CUR_LEN-1,
    head:i=>cap(D.MONTH_FULL[i])
  },Object.assign({},opts,{bench:opts.bench?D.curYearOf(opts.bench):null}));
}

/* ---- Неделя к неделе: последние двенадцать недель против предыдущих ----
   Тот же зум, что и в картах Amazon: обзор слева, крупный план справа.
   По оси X — календарь ТЕКУЩИХ двенадцати недель; предыдущие двенадцать
   лежат на тех же позициях, а их собственные даты живут в подсказке.
   Иначе на одной оси пришлось бы держать двадцать четыре даты, и обе линии
   стали бы одной длинной. */
function wowOption(metricKey,weeks,opts){
  opts=opts||{};
  const cur=D.curWeeksOf(weeks), prev=D.prevWeeksOf(weeks);
  const bench=opts.bench?D.curWeeksOf(opts.bench):null;
  return comparisonOption(metricKey,{
    labels:D.weekAxisLabels(),
    curName:'текущие', prevName:'предыдущие',
    cur,prev,
    /* Вертикальной отметки здесь нет: в окне двенадцати недель все двенадцать
       уже закрыты, будущего на полотне нет — отмечать нечего. Последняя
       неделя названа жирным, и этого хватает. */
    boldIdx:cur.length-1, markIdx:null, sparse:true,
    head:i=>'Неделя '+D.weekRangeLabel(i,'cur'),
    sub:(name,i)=>name==='предыдущие'?D.weekRangeLabel(i,'prev'):''
  },Object.assign({},opts,{bench}));
}
function cap(s){return s?s[0].toUpperCase()+s.slice(1):s}

/* ---- Группированные бары: одна серия на значение разреза, по месяцам окна ----
   Группы остаются на своих местах — полотну добавлены поля слева и справа:
   крайние группы упирались в рамку и читались как обрезанные. */
function groupedBarOption(seriesDefs,monthsLabels,metricKey,title){
  const mx=Math.max(...seriesDefs.map(s=>Math.max(...s.data)));
  return Object.assign(head(title,seriesDefs.map(s=>s.name)),{
    grid:{left:44,right:44,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{axisPointer:{type:'shadow'},formatter:tooltipRows(metricKey)}),
    /* последний месяц окна — текущий: подписан жирным так же, как на линиях */
    xAxis:Object.assign(catAxis(monthsLabels,monthsLabels.length-1),{boundaryGap:true}),
    yAxis:zeroAxis(metricKey,mx),
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',barMaxWidth:16,barGap:'12%',
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:[3,3,0,0]},
      legendHoverLink:false,emphasis:{itemStyle:{opacity:1}},blur:{itemStyle:{opacity:1}},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  });
}

window.HRBPCHARTS={yoyOption,wowOption,groupedBarOption,SERIES_PALETTE};
})();
