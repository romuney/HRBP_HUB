/* ============================================================
   HRBP HUB — графики.

   Все линии строятся «год к году»: ось X — двенадцать месяцев, прошлый год
   идёт бледной линией без подписей, текущий — тёмной с подписями значений.
   Так на одном полотне видно и как метрика изменилась относительно себя же
   год назад, и где проходит ориентир: цель — плоская линия, и сравнивать её
   со скользящим окном было бы не с чем.

   Правила дизайн-системы, которые здесь обязательны:
     • ось значений ВСЕГДА от нуля;
     • ось Y не рисуем — значения подписаны у точек;
     • подписи одного кегля и одного цвета, с белым halo;
     • заголовок слева, легенда справа — не накладываются.
   ============================================================ */
(function(){
const FONT='Inter, Helvetica, Arial, sans-serif';
const C_LABEL='#2b2b2b', C_AXIS='#8a909c', C_AXIS_LINE='#9ba4b5';
const C_CUR='#3a3f4a', C_PREV='#c7c8cc', C_BENCH='#9aa0ac', C_KPI='#2b6cff';
const SERIES_PALETTE=['#5f86c2','#97dece','#ac87c5','#cdbf97','#85cdfd','#9fae6a','#c98aa6','#686d76'];
const VAL_SZ=11;
const HEAD_H=34;   // полоса заголовка и легенды: график под неё не заезжает

const D=window.HRBPDATA;

/* Верх шкалы — «круглое» число не ниже максимума. Низ всегда ноль:
   урезанная ось превращает колебание в полпроцента в обвал. */
function zeroAxis(maxVal){
  const nice=[1,1.2,1.5,2,2.5,3,4,5,6,8,10];
  const mx=Math.max(maxVal,1e-6);
  const pow=Math.pow(10,Math.floor(Math.log10(mx)));
  let top=pow*10;
  for(const n of nice){if(pow*n>=mx){top=pow*n;break}}
  return {type:'value',min:0,max:top,show:false,splitLine:{show:false}};
}
function monthAxis(labels){
  return {type:'category',data:labels,boundaryGap:false,
    axisLine:{lineStyle:{color:C_AXIS_LINE}},axisTick:{show:false},
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,interval:0}};
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
  let mx=Math.max(...prev,...cur.filter(v=>v!=null));

  const data=[
    {name:String(D.YEAR_PREV),type:'line',smooth:false,symbol:'none',
      lineStyle:{width:2,color:C_PREV},itemStyle:{color:C_PREV},
      data:prev,z:2,label:{show:false}},
    {name:String(D.YEAR_CUR),type:'line',smooth:false,symbol:'circle',symbolSize:5,
      lineStyle:{width:2.6,color:C_CUR},itemStyle:{color:C_CUR},
      data:cur,z:5,connectNulls:false,label:valueLabel(metricKey)}
  ];
  if(opts.kpi!=null){
    mx=Math.max(mx,opts.kpi);
    legend.push('Цель');
    data.push({name:'Цель',type:'line',symbol:'none',data:labels.map(()=>opts.kpi),z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_KPI},itemStyle:{color:C_KPI},label:{show:false}});
  }else if(opts.bench){
    const b=D.curYearOf(opts.bench);
    mx=Math.max(mx,...b.filter(v=>v!=null));
    const nm='База · '+(opts.benchLabel||'вся компания');
    legend.push(nm);
    data.push({name:nm,type:'line',symbol:'none',data:b,z:3,
      lineStyle:{width:1.6,type:'dashed',color:C_BENCH},itemStyle:{color:C_BENCH},label:{show:false}});
  }
  return Object.assign(head(opts.title,legend),{
    grid:{left:10,right:14,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{formatter:tooltipRows(metricKey)}),
    xAxis:monthAxis(labels),
    yAxis:zeroAxis(mx),
    series:data,animationDuration:600,animationEasing:'cubicOut'
  });
}

/* ---- Группированные бары: одна серия на значение разреза, по месяцам окна ---- */
function groupedBarOption(seriesDefs,monthsLabels,metricKey,title){
  const mx=Math.max(...seriesDefs.map(s=>Math.max(...s.data)));
  return Object.assign(head(title,seriesDefs.map(s=>s.name)),{
    grid:{left:10,right:14,top:HEAD_H+14,bottom:24,containLabel:true},
    tooltip:Object.assign(tooltipBase(),{axisPointer:{type:'shadow'},formatter:tooltipRows(metricKey)}),
    xAxis:Object.assign(monthAxis(monthsLabels),{boundaryGap:true}),
    yAxis:zeroAxis(mx),
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',barMaxWidth:16,barGap:'12%',
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:[3,3,0,0]},
      legendHoverLink:false,emphasis:{itemStyle:{opacity:1}},blur:{itemStyle:{opacity:1}},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  });
}

window.HRBPCHARTS={yoyOption,groupedBarOption,SERIES_PALETTE};
})();
