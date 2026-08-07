/* ============================================================
   HRBP HUB — графики.

   Все линии строятся «год к году»: ось X — двенадцать месяцев, прошлый год
   идёт бледной линией без подписей, текущий — тёмной с подписями значений.
   Так на одном полотне видно и как метрика изменилась относительно себя же
   год назад, и где проходит ориентир: цель — плоская линия, и сравнивать её
   со скользящим окном было бы не с чем.

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
   вместе со срезом появляется ось Y — четыре круглых деления и бледная сетка.
   Ось не дублирует подписи у точек: точки говорят «сколько», ось — «в каком
   коридоре мы это читаем».
   Ноль всё равно возвращается в кадр сам, когда данные подошли к нему ближе
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
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,formatter:axisFmt(metricKey)},
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
function valueAxis(metricKey,values){
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
  return axisSkin(metricKey,step,{min,max});
}
/* Ось месяцев. Засечки под каждым месяцем: без них подписи висят под сплошной
   чертой, и точка на линии не привязана глазом к своему месяцу.
   nowIdx — последний закрытый месяц: он подписан жирным и тёмным, чтобы
   «где мы сейчас» читалось без пересчёта месяцев от начала года. */
function monthAxis(labels,nowIdx){
  return {type:'category',data:labels,boundaryGap:false,
    axisLine:{lineStyle:{color:C_AXIS_LINE}},
    axisTick:{show:true,alignWithLabel:true,length:4,lineStyle:{color:C_AXIS_LINE}},
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,interval:0,
      formatter:(v,i)=>i===nowIdx?'{now|'+v+'}':v,
      rich:{now:{fontFamily:FONT,fontSize:VAL_SZ,fontWeight:800,color:C_LABEL}}}};
}
/* Вертикальная пунктирная отметка текущего месяца со стрелкой у оси.
   Живёт на фоновой серии: линия текущего года должна проходить поверх неё. */
function nowMark(idx){
  if(idx==null||idx<0)return undefined;
  return {silent:true,symbol:['arrow','none'],symbolSize:7,
    label:{show:false},emphasis:{disabled:true},animation:false,
    lineStyle:{type:'dashed',width:1.2,color:C_NOW,opacity:1},
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
function tooltipRows(metricKey){
  return function(ps){
    let s='<div style="font-family:'+FONT+';min-width:170px">'+
      '<div style="color:#8a909c;font-size:10.5px;margin-bottom:6px">'+ps[0].axisValueLabel+'</div>';
    ps.forEach(p=>{
      if(p.value==null)return;
      const dash=p.seriesName==='Цель'||p.seriesName.indexOf('База')===0;
      s+='<div style="display:flex;justify-content:space-between;gap:14px;margin-top:3px">'+
        '<span style="color:'+(dash?'#8a909c':'#3a3f4a')+'">'+
        '<span style="display:inline-block;width:12px;height:'+(dash?'0':'9px')+';'+
        (dash?'border-top:2px dashed '+p.color+';vertical-align:middle;':'border-radius:3px;background:'+p.color+';')+
        'margin-right:7px"></span>'+p.seriesName+'</span>'+
        '<b style="font-variant-numeric:tabular-nums;color:'+(dash?'#8a909c':'#1f1f1f')+'">'+
        D.fmtVal(metricKey,p.value)+'</b></div>';
    });
    return s+'</div>';
  };
}

/* ---- Линия «год к году» ----
   opts: {kpi, bench, benchLabel, title}
   Цель и база взаимоисключающи: есть утверждённая цель — сравниваемся только
   с ней, второй ориентир рядом заставлял бы выбирать, по какому судить. */
function yoyOption(metricKey,series,opts){
  opts=opts||{};
  const prev=D.prevYearOf(series), cur=D.curYearOf(series);
  const labels=D.MONTH_ABBR;
  const legend=[String(D.YEAR_CUR),String(D.YEAR_PREV)];
  /* Шкалу считаем по ВСЕМУ, что нарисовано, включая ориентир: цель, ушедшая
     за край полотна, — это «мы не дотягиваем» без единого свидетельства. */
  const scaleVals=prev.concat(cur.filter(v=>v!=null));

  /* Прошлый год — та же форма записи, что и текущий: линия с точками.
     Разделяют их вес и цвет, а не тип графика. Точки нужны и по делу:
     без них не видно, что бледная кривая — это те же двенадцать замеров. */
  const data=[
    {name:String(D.YEAR_PREV),type:'line',smooth:false,symbol:'circle',symbolSize:4,
      lineStyle:{width:2,color:C_PREV},itemStyle:{color:C_PREV},
      data:prev,z:2,label:{show:false},markLine:nowMark(D.CUR_LEN-1)},
    {name:String(D.YEAR_CUR),type:'line',smooth:false,symbol:'circle',symbolSize:5,
      lineStyle:{width:2.6,color:C_CUR},itemStyle:{color:C_CUR},
      data:cur,z:5,connectNulls:false,label:valueLabel(metricKey)}
  ];
  if(opts.kpi!=null){
    scaleVals.push(opts.kpi);
    legend.push('Цель');
    data.push({name:'Цель',type:'line',symbol:'none',data:labels.map(()=>opts.kpi),z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_KPI},itemStyle:{color:C_KPI},label:{show:false}});
  }else if(opts.bench){
    const b=D.curYearOf(opts.bench);
    b.filter(v=>v!=null).forEach(v=>scaleVals.push(v));
    const nm='База · '+(opts.benchLabel||'вся компания');
    legend.push(nm);
    data.push({name:nm,type:'line',symbol:'none',data:b,z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_BENCH},itemStyle:{color:C_BENCH},label:{show:false}});
  }
  return Object.assign(head(opts.title,legend),{
    /* Поля по краям — не про красоту: подпись значения шире точки, над которой
       стоит, и у январской точки она уходит влево, на подписи шкалы. Запас
       по краям держит их порознь. */
    grid:{left:30,right:26,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{formatter:tooltipRows(metricKey)}),
    xAxis:monthAxis(labels,D.CUR_LEN-1),
    yAxis:valueAxis(metricKey,scaleVals),
    series:data,animationDuration:600,animationEasing:'cubicOut'
  });
}

/* ---- Группированные бары: одна серия на значение разреза, по месяцам окна ----
   Группы остаются на своих местах — полотну добавлены поля слева и справа:
   крайние группы упирались в рамку и читались как обрезанные. */
function groupedBarOption(seriesDefs,monthsLabels,metricKey,title){
  const mx=Math.max(...seriesDefs.map(s=>Math.max(...s.data)));
  return Object.assign(head(title,seriesDefs.map(s=>s.name)),{
    grid:{left:34,right:34,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{axisPointer:{type:'shadow'},formatter:tooltipRows(metricKey)}),
    /* последний месяц окна — текущий: подписан жирным так же, как на линиях */
    xAxis:Object.assign(monthAxis(monthsLabels,monthsLabels.length-1),{boundaryGap:true}),
    yAxis:zeroAxis(metricKey,mx),
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',barMaxWidth:16,barGap:'12%',
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:[3,3,0,0]},
      legendHoverLink:false,emphasis:{itemStyle:{opacity:1}},blur:{itemStyle:{opacity:1}},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  });
}

window.HRBPCHARTS={yoyOption,groupedBarOption,SERIES_PALETTE};
})();
