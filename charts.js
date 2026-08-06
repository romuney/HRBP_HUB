/* ===== ECharts-хелперы (стиль Proteus/Superset) ===== */
(function(){
const FONT='Inter, Helvetica, Arial, sans-serif';
const C_LABEL='#2b2b2b', C_AXIS='#808080', C_AXIS_LINE='rgb(155,164,181)', C_DIVIDER='#dbdbdb';
const C_LINE='#5a6573', C_GREEN='#1f9d57', C_RED='#d64545', C_BENCH='#9aa0ac';
const SERIES_PALETTE=['#cdbf97','#7fb0c8','#5f86c2','#8b6fc0','#9fae6a','#c98aa6','#5f9d8a','#bdbdbd'];

const D=window.HRBPDATA;
function xLabels(){return D.MONTHS.map(m=>m.isYearStart?('{y|'+m.y+'}'):m.label)}
function dividerData(){
  const out=[];D.MONTHS.forEach((m,i)=>{if(i>0&&m.isYearStart)out.push([{coord:[i-0.5,'min']},{coord:[i-0.5,'max']}])});return out;
}
function baseXAxis(){
  return {type:'category',data:xLabels(),boundaryGap:true,
    axisLine:{lineStyle:{color:C_AXIS_LINE}},axisTick:{show:false},
    axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:11,interval:0,rich:{y:{fontFamily:FONT,color:C_AXIS,fontSize:11,fontWeight:'bold'}}}};
}
function markLineTpl(){
  return {symbol:['none','none'],silent:true,animation:false,data:dividerData(),label:{show:false},lineStyle:{type:'dashed',color:C_DIVIDER,width:1}};
}
function fmtTip(metricKey,v){return D.fmtVal(metricKey,v)}

/* Линия динамики: команда + (опц.) один бенчмарк */
function lineOption(metricKey,series,benchKey,benchSeriesArr,title){
  const m=D.METRIC_BY_KEY[metricKey];
  const data=[{name:title||m.name,type:'line',smooth:false,symbol:'circle',symbolSize:6,
    lineStyle:{width:2.4,color:C_LINE},itemStyle:{color:C_LINE},
    data:series,z:5,markLine:markLineTpl(),
    endLabel:{show:true,formatter:p=>fmtTip(metricKey,p.value),color:C_LINE,fontWeight:700,fontFamily:FONT,fontSize:12},
    label:{show:false}}];
  if(benchSeriesArr){
    data.push({name:'Сравнение',type:'line',smooth:false,symbol:'none',
      lineStyle:{width:2,type:'dashed',color:C_BENCH},itemStyle:{color:C_BENCH},
      data:benchSeriesArr,z:3,
      endLabel:{show:true,formatter:p=>fmtTip(metricKey,p.value),color:C_BENCH,fontWeight:700,fontFamily:FONT,fontSize:11}});
  }
  return {
    grid:{left:8,right:64,top:title?30:14,bottom:24,containLabel:true},
    title:title?{text:title,left:0,top:0,textStyle:{fontFamily:FONT,fontSize:13,fontWeight:600,color:'#1f1f1f'}}:undefined,
    tooltip:{trigger:'axis',axisPointer:{type:'line',lineStyle:{color:'#cfd3da'}},backgroundColor:'#fff',borderWidth:0,
      extraCssText:'box-shadow:0 4px 8px rgba(0,0,0,.18);border-radius:8px;',textStyle:{fontFamily:FONT,color:'#333',fontSize:12},
      formatter:function(ps){let s='<div style="font-family:'+FONT+';min-width:150px"><div style="color:#666;margin-bottom:6px">'+ps[0].axisValueLabel.replace(/\{y\||\}/g,'')+'</div>';
        ps.forEach(p=>{s+='<div style="display:flex;justify-content:space-between;gap:14px"><span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+p.color+';margin-right:6px"></span>'+p.seriesName+'</span><b>'+fmtTip(metricKey,p.value)+'</b></div>'});
        return s+'</div>';}},
    xAxis:baseXAxis(),
    yAxis:{type:'value',scale:true,splitLine:{lineStyle:{color:'#f0f1f3'}},axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:10,formatter:v=>m.fmt==='int'?D.fmtInt(v):v+'%'}},
    series:data,animationDuration:600,animationEasing:'cubicOut'
  };
}

/* Stacked bar для трансформера (структура сегментов по месяцам) */
function stackedOption(seriesDefs,monthsLabels){
  return {
    grid:{left:8,right:14,top:34,bottom:26,containLabel:true},
    legend:{top:0,left:0,itemWidth:14,itemHeight:10,itemGap:10,textStyle:{fontFamily:FONT,fontSize:12,color:'#2b2b2b'}},
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#fff',borderWidth:0,
      extraCssText:'box-shadow:0 4px 8px rgba(0,0,0,.18);border-radius:8px;',textStyle:{fontFamily:FONT,color:'#333',fontSize:12}},
    xAxis:Object.assign(baseXAxis(),{data:monthsLabels}),
    yAxis:{type:'value',splitLine:{lineStyle:{color:'#f0f1f3'}},axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:10,formatter:v=>v+'%'}},
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',stack:'seg',barMaxWidth:34,
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:i===seriesDefs.length-1?[3,3,0,0]:0},
      emphasis:{focus:'none'},
      label:{show:true,fontFamily:FONT,fontSize:9.5,color:'#3a3f4a',formatter:p=>p.value>=6?p.value+'%':''},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  };
}

/* Группированные бары: одна серия на значение разреза, по месяцам (трансформер, режим «динамика по разрезу») */
function groupedBarOption(seriesDefs,monthsLabels,metricKey){
  const m=D.METRIC_BY_KEY[metricKey];
  const fmtAxis=v=>m.fmt==='int'?D.fmtInt(v):(m.fmt==='days'?v+' дн':v+'%');
  return {
    grid:{left:8,right:14,top:38,bottom:26,containLabel:true},
    legend:{top:0,left:0,itemWidth:14,itemHeight:10,itemGap:12,textStyle:{fontFamily:FONT,fontSize:12,color:'#2b2b2b'}},
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#fff',borderWidth:0,
      extraCssText:'box-shadow:0 4px 8px rgba(0,0,0,.18);border-radius:8px;',textStyle:{fontFamily:FONT,color:'#333',fontSize:12},
      formatter:function(ps){let s='<div style="font-family:'+FONT+';min-width:160px"><div style="color:#666;margin-bottom:6px">'+ps[0].axisValueLabel.replace(/\{y\||\}/g,'')+'</div>';
        for(let i=0;i<ps.length;i++){const p=ps[i];s+='<div style="display:flex;justify-content:space-between;gap:14px"><span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+p.color+';margin-right:6px"></span>'+p.seriesName+'</span><b>'+D.fmtVal(metricKey,p.value)+'</b></div>'}
        return s+'</div>';}},
    xAxis:Object.assign(baseXAxis(),{data:monthsLabels}),
    yAxis:{type:'value',scale:m.fmt!=='int',splitLine:{lineStyle:{color:'#f0f1f3'}},axisLabel:{fontFamily:FONT,color:C_AXIS,fontSize:10,formatter:fmtAxis}},
    series:seriesDefs.map((s,i)=>({name:s.name,type:'bar',barMaxWidth:16,barGap:'12%',
      itemStyle:{color:SERIES_PALETTE[i%SERIES_PALETTE.length],borderRadius:[3,3,0,0]},
      legendHoverLink:false,emphasis:{itemStyle:{opacity:1}},blur:{itemStyle:{opacity:1}},
      data:s.data})),
    animationDuration:600,animationEasing:'cubicOut'
  };
}

/* мини-спарклайн (SVG, без ECharts) */
function sparkSVG(series,state){
  const w=132,h=28,n=series.length;const mn=Math.min(...series),mx=Math.max(...series);const rng=(mx-mn)||1;
  const bw=w/n;const col=state==='bad'?'#f51f1f':(state==='good'?'#12b048':(state==='warn'?'#f59300':'#9bb6e8'));
  let bars='';
  series.forEach((v,i)=>{const bh=Math.max(2,((v-mn)/rng)*(h-4)+2);const x=i*bw+1;const y=h-bh;
    const c=i===n-1?col:'#cdd6e6';
    bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw-2).toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="1.5" fill="'+c+'"/>';});
  return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+bars+'</svg>';
}

window.HRBPCHARTS={lineOption,stackedOption,groupedBarOption,sparkSVG,SERIES_PALETTE};
})();
