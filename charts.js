/* ============================================================
   HRBP HUB — графики.
   Правила из дизайн-системы, которые здесь обязательны:
     • ось значений ВСЕГДА от нуля (урезанная ось превращает колебание
       в полпроцента в обвал — это искажение данных, а не стиль);
     • значение подписано у точки, поэтому оси Y нет;
     • подписи значений одного кегля и одного цвета, с белым halo;
     • граница календарного года — вертикальный пунктир.
   ============================================================ */
(function(){
const FONT='Inter, Helvetica, Arial, sans-serif';
const C_LABEL='#2b2b2b', C_AXIS='#8a909c', C_AXIS_LINE='#9ba4b5', C_DIVIDER='#dbdbdb';
const C_LINE='#5a6573', C_BENCH='#9aa0ac', C_KPI='#2b6cff';
const SERIES_PALETTE=['#5f86c2','#97dece','#ac87c5','#cdbf97','#85cdfd','#9fae6a','#c98aa6','#686d76'];
const VAL_SZ=11;

const D=window.HRBPDATA;
function xLabels(){return D.MONTHS.map(m=>m.isYearStart?('{y|'+m.y+'}'):m.label)}
function dividerData(){
  const out=[];D.MONTHS.forEach((m,i)=>{if(i>0&&m.isYearStart)out.push([{coord:[i-0.5,'min']},{coord:[i-0.5,'max']}])});
  return out;
}
function baseXAxis(){
  return {type:'category',data:xLabels(),boundaryGap:true,
    axisLine:{lineStyle:{color:C_AXIS_LINE}},axisTick:{show:false},
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,interval:0,
      rich:{y:{fontFamily:FONT,color:C_AXIS,fontSize:VAL_SZ,fontWeight:'bold'}}}};
}
/* Ось значений: скрыта целиком, но её ШКАЛА жёстко начинается с нуля.
   Верх — «круглое» число не ниже максимума. */
function zeroAxis(maxVal){
  const nice=[1,1.2,1.5,2,2.5,3,4,5,6,8,10];
  const mx=Math.max(maxVal,1e-6);
  const pow=Math.pow(10,Math.floor(Math.log10(mx)));
  let top=pow*10;
  for(const n of nice){if(pow*n>=mx){top=pow*n;break}}
  return {type:'value',min:0,max:top,show:false,splitLine:{show:false}};
}
function valueLabel(metricKey,color){
  return {show:true,fontFamily:FONT,fontSize:VAL_SZ,fontWeight:700,color:color||C_LABEL,
    textBorderColor:'#fff',textBorderWidth:3.2,
    formatter:p=>D.fmtVal(metricKey,p.value)};
}
function tooltipBase(){
  return {trigger:'axis',axisPointer:{type:'line',lineStyle:{color:'#cfd3da'}},
    backgroundColor:'#fff',borderColor:'#e7e9ee',borderWidth:1,
    extraCssText:'box-shadow:0 10px 30px rgba(24,33,50,.18);border-radius:9px;',
    textStyle:{fontFamily:FONT,color:'#3a3f4a',fontSize:12}};
}

/* ---- Линия динамики: юнит + (опц.) база или линия цели ---- */
function lineOption(metricKey,series,benchArr,benchName,kpiTarget,title){
  const data=[{name:'Значение',type:'line',smooth:false,symbol:'circle',symbolSize:5,
    lineStyle:{width:2.4,color:C_LINE},itemStyle:{color:C_LINE},
    data:series,z:5,
    markLine:{symbol:['none','none'],silent:true,animation:false,data:dividerData(),
      label:{show:false},lineStyle:{type:'dashed',color:C_DIVIDER,width:1}},
    label:valueLabel(metricKey)}];
  let mx=Math.max(...series);
  if(benchArr){
    mx=Math.max(mx,...benchArr);
    data.push({name:benchName||'База',type:'line',smooth:false,symbol:'none',
      lineStyle:{width:2,type:'dashed',color:C_BENCH},itemStyle:{color:C_BENCH},
      data:benchArr,z:3,label:{show:false}});
  }
  /* Линия цели рисуется вместо базы, а не рядом с ней: два ориентира
     заставляют выбирать, по какому судить. */
  if(kpiTarget!=null){
    mx=Math.max(mx,kpiTarget);
    data.push({name:'Цель',type:'line',symbol:'none',data:series.map(()=>kpiTarget),z:2,
      lineStyle:{width:1.6,type:'dashed',color:C_KPI},itemStyle:{color:C_KPI},label:{show:false}});
  }
  const legend=[];
  if(benchArr)legend.push(benchName||'База');
  if(kpiTarget!=null)legend.push('Цель');
  return {
    grid:{left:10,right:18,top:title?36:22,bottom:26,containLabel:true},
    title:title?{text:title,left:0,top:0,
      textStyle:{fontFamily:FONT,fontSize:13,fontWeight:700,color:'#1f1f1f'}}:undefined,
    legend:legend.length?{data:legend,right:0,top:0,itemWidth:16,itemHeight:8,
      textStyle:{fontFamily:FONT,fontSize:11,color:'#8a909c'}}:undefined,
    tooltip:Object.assign(tooltipBase(),{formatter:function(ps){
      let s='<div style="font-family:'+FONT+';min-width:150px"><div style="color:#8a909c;font-size:10.5px;margin-bottom:6px">'+
        ps[0].axisValueLabel.replace(/\{y\||\}/g,'')+'</div>';
      ps.forEach(p=>{s+='<div style="display:flex;justify-content:space-between;gap:14px">'+
        '<span><span style="display:inline-block;width:10px;height:9px;border-radius:3px;background:'+p.color+';margin-right:6px"></span>'+
        p.seriesName+'</span><b>'+D.fmtVal(metricKey,p.value)+'</b></div>'});
      return s+'</div>';}}),
    xAxis:baseXAxis(),
    yAxis:zeroAxis(mx),
    series:data,animationDuration:600,animationEasing:'cubicOut'
  };
}

/* ---- Группированные бары: одна серия на значение разреза, по месяцам ---- */
function groupedBarOption(seriesDefs,monthsLabels,metricKey){
  const mx=Math.max(...seriesDefs.map(s=>Math.max(...s.data)));
  return {
    grid:{left:10,right:14,top:38,bottom:26,containLabel:true},
    legend:{top:0,left:0,itemWidth:14,itemHeight:9,itemGap:12,
      textStyle:{fontFamily:FONT,fontSize:12,color:'#3a3f4a'}},
    tooltip:Object.assign(tooltipBase(),{axisPointer:{type:'shadow'},formatter:function(ps){
      let s='<div style="font-family:'+FONT+';min-width:160px"><div style="color:#8a909c;font-size:10.5px;margin-bottom:6px">'+
        ps[0].axisValueLabel.replace(/\{y\||\}/g,'')+'</div>';
      ps.forEach(p=>{s+='<div style="display:flex;justify-content:space-between;gap:14px">'+
        '<span><span style="display:inline-block;width:10px;height:9px;border-radius:3px;background:'+p.color+';margin-right:6px"></span>'+
        p.seriesName+'</span><b>'+D.fmtVal(metricKey,p.value)+'</b></div>'});
      return s+'</div>';}}),
    xAxis:Object.assign(baseXAxis(),{data:monthsLabels}),
    yAxis:zeroAxis(mx),
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',barMaxWidth:16,barGap:'12%',
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:[3,3,0,0]},
      legendHoverLink:false,emphasis:{itemStyle:{opacity:1}},blur:{itemStyle:{opacity:1}},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  };
}

window.HRBPCHARTS={lineOption,groupedBarOption,SERIES_PALETTE};
})();
