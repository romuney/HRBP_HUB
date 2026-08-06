/* ============================================================
   HRBP HUB — мок-данные прототипа
   Самодостаточный детерминированный генератор.
   В Proteus эти структуры приходят из ClickHouse (см. спеку датасетов).
   Метрики — реальный перечень (action-метрики), разбиты на логические блоки.
   ============================================================ */

/* ---------- PRNG (детерминированный) ---------- */
function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function rng(seed){return mulberry32(hashStr(seed))}

/* ---------- Периоды: 12 месяцев (июль 2025 — июнь 2026) ---------- */
const MONTH_ABBR=['янв.','февр.','март','апр.','май','июнь','июль','авг.','сент.','окт.','нояб.','дек.'];
const MONTHS=(function(){
  const out=[];const seq=[[2025,6],[2025,7],[2025,8],[2025,9],[2025,10],[2025,11],[2026,0],[2026,1],[2026,2],[2026,3],[2026,4],[2026,5]];
  for(const [y,m] of seq){out.push({y,m,label:MONTH_ABBR[m],isYearStart:m===0})}
  return out;
})();
const N=MONTHS.length;
const LAST=N-1;

/* ---------- Логические блоки метрик (синхронизированы с OnePager) ---------- */
const BLOCKS=[
  {key:'retention', name:'Удержание и текучесть', hint:'Закрепляемость, нежелательные уходы, причины увольнений.'},
  {key:'structure', name:'Структура команды',     hint:'Численность, доля джунов, регионализация найма.'},
  {key:'discipline',name:'Дисциплина и баланс',   hint:'Прогулы и неотгуленные отпуска.'}
];

/* ---------- Конфиг метрик (действующие — на 1-й странице с бенчами) ----------
   better: 'lower' | 'higher' | 'flat'
   fmt: 'int' | 'pct' | 'days'
   threshold: {green, red} — дефолтная цель метрики (порог светофора).
              Реальные цели задаёт Senior HRBP во внешнем инструменте per команда×метрика.
              Здесь threshold = «эталонная» цель; per-команда варьируется (см. leafThreshold).
              Для 'flat' порога нет (нейтральная метрика без светофора).
*/
const METRICS=[
  // Блок 1 — Удержание и текучесть
  {key:'retention_new', block:'retention', name:'Закрепляемость новичков',      short:'Закрепл.',  fmt:'pct',  better:'higher', unit:'%',   threshold:{green:85,red:70}, hint:'Доля новичков, прошедших испытательный срок и оставшихся.'},
  {key:'regret',        block:'retention', name:'Regrettable текучесть',         short:'Regret',    fmt:'pct',  better:'lower',  unit:'%',   threshold:{green:3,red:7},   hint:'Текучесть среди ценных сотрудников (нежелательные уходы), годовой темп.'},
  {key:'nonregret',     block:'retention', name:'Non regrettable текучесть',     short:'Non-reg.',  fmt:'pct',  better:'flat',   unit:'%',   threshold:null,              hint:'Текучесть без сожаления (управляемые уходы). Нейтральная, без порога.'},
  {key:'exit_reasons',  block:'retention', name:'Заполнение причин увольнений',  short:'Причины',   fmt:'pct',  better:'higher', unit:'%',   threshold:{green:90,red:70}, hint:'Доля увольнений с заполненной причиной (качество данных оттока).'},
  // Блок 2 — Структура команды
  {key:'headcount',     block:'structure', name:'Численность',                   short:'Числ.',     fmt:'int',  better:'flat',   unit:'чел', threshold:null,              hint:'Списочная численность сотрудников на конец месяца.'},
  {key:'jun_team',      block:'structure', name:'% джунов в команде',            short:'Джуны',     fmt:'pct',  better:'flat',   unit:'%',   threshold:null,              hint:'Доля сотрудников грейда Junior/Junior+ в команде.'},
  {key:'jun_hire',      block:'structure', name:'% джунов в найме',              short:'Джуны найм',fmt:'pct',  better:'flat',   unit:'%',   threshold:null,              hint:'Доля джунов среди принятых за период.'},
  {key:'region_hire',   block:'structure', name:'% найма в регионах',           short:'Регион найм',fmt:'pct', better:'higher', unit:'%',   threshold:{green:40,red:20}, hint:'Доля найма вне Москвы и СПб (регионализация).'},
  // Блок 3 — Дисциплина и баланс
  {key:'absentees',     block:'discipline',name:'Прогульщики',                   short:'Прогулы',   fmt:'pct',  better:'lower',  unit:'%',   threshold:{green:1,red:4},   hint:'Доля сотрудников с неоправданными отсутствиями за период.'},
  {key:'unused_vac',    block:'discipline',name:'Неотгуленные отпуска',          short:'Отпуска',   fmt:'days', better:'lower',  unit:'дн',  threshold:{green:5,red:15},  hint:'Среднее число накопленных неотгуленных дней отпуска на сотрудника.'}
];
const METRIC_BY_KEY=Object.fromEntries(METRICS.map(m=>[m.key,m]));
function metricsOfBlock(blockKey){return METRICS.filter(m=>m.block===blockKey)}

/* ---------- Метрики «в разработке» и «хотим разработать» (страница 2 — каталог) ---------- */
const DEV_METRICS=[
  {name:'Эффективность работы с лоу-перформерами', note:'Доля закрытых PIP с положительным результатом. Привязана к КП.'},
  {name:'% укомплектованности штата',              note:'Факт численности к плановой (по ресурсной структуре).'},
  {name:'Вовлечённость',                            note:'eNPS / индекс вовлечённости по опросам.'},
  {name:'% достижения people OKR',                  note:'Достижение people-целей команды. Привязаны к КП.'}
];
const WANTED_METRICS=[
  {name:'Покрытие преемниками',                          note:'Доля ключевых ролей с готовым преемником.'},
  {name:'Cost of hiring',                                note:'Стоимость найма на одного сотрудника.'},
  {name:'Проплаченность',                                note:'Compa-ratio: факт ФОТ к рыночной вилке.'},
  {name:'Охваты обучения менеджерскими программами',     note:'Доля релевантных руководителей в программах развития.'},
  {name:'Наличие задач в ревью по eligible',             note:'Доля eligible-сотрудников с заведённой задачей в ревью.'}
];

/* ---------- Бенчмарки (единое переключаемое сравнение) ---------- */
const BENCHMARKS=[
  {key:'none',    name:'Без сравнения'},
  {key:'company', name:'Вся компания'},
  {key:'hq',      name:'HQ (головной офис)'},
  {key:'it',      name:'Все IT'},
  {key:'nonit',   name:'Все nonIT'}
];
// «якоря» метрик на последний месяц для каждого бенчмарка
const BENCH_ANCHOR={
  company:{retention_new:80.0,regret:5.2,nonregret:7.0,exit_reasons:84.0,headcount:48200,jun_team:22.0,jun_hire:30.0,region_hire:38.0,absentees:2.2,unused_vac:9.0},
  hq:     {retention_new:83.0,regret:4.3,nonregret:6.5,exit_reasons:88.0,headcount:21500,jun_team:18.0,jun_hire:26.0,region_hire:30.0,absentees:1.8,unused_vac:7.0},
  it:     {retention_new:85.0,regret:3.8,nonregret:6.0,exit_reasons:90.0,headcount:18900,jun_team:28.0,jun_hire:35.0,region_hire:45.0,absentees:1.5,unused_vac:6.0},
  nonit:  {retention_new:76.0,regret:6.4,nonregret:8.0,exit_reasons:79.0,headcount:29300,jun_team:17.0,jun_hire:24.0,region_hire:33.0,absentees:3.0,unused_vac:12.0}
};

/* ---------- Оргдерево: 12 уровней управленческой структуры ----------
   level 1  — компания (вершина, «Вся компания»),
   level 2  — блоки/направления,
   level 3..12 — департамент → управление → отдел → … → ячейка.
   path — ключ клика/фильтра (как в Superset hierarchical crossfilter).
   Дерево строится программно: ветки разной глубины, у каждого блока есть
   «хребет», уходящий на полную глубину (12 уровней).
*/
const BLOCK_DEFS=[
  {id:'01', name:'Технологические платформы', seg:'IT'},
  {id:'02', name:'Розничные продукты',        seg:'IT'},
  {id:'03', name:'Кредитный конвейер',        seg:'IT'},
  {id:'04', name:'Платежи и переводы',         seg:'IT'},
  {id:'05', name:'ML и Research',              seg:'IT'},
  {id:'06', name:'Инфраструктура',             seg:'IT'},
  {id:'07', name:'Клиентский сервис',          seg:'nonIT'}
];
const MAX_LEVEL=12;
// управленческие тиры по уровню
const LEVEL_ABBR={1:'Компания',2:'Блок',3:'Департамент',4:'Управление',5:'Отдел',6:'Центр',7:'Группа',8:'Подгруппа',9:'Команда',10:'Звено',11:'Подзвено',12:'Ячейка'};
const LEVEL_SHORT={3:'Деп.',4:'Упр.',5:'Отд.',6:'Центр',7:'Гр.',8:'Подгр.',9:'Ком.',10:'Зв.',11:'Подзв.',12:'Яч.'};
function levelLabel(level){return LEVEL_ABBR[level]||('ур. '+level)}
const pad2=n=>String(n).padStart(2,'0');

const NODES=[]; // {id,path,parent,level,name,sort,domainId,leaf,is_focus,is_hq,segment}
const ROOT={id:'T',path:'T',parent:null,level:1,name:'ТБанк',sort:0,domainId:null,leaf:false,is_focus:false};
NODES.push(ROOT);
let sortCtr=1;

// атрибуты листа: segment (IT|nonIT) и is_hq — детерминированно по path.
// Блок nonIT — целиком nonIT; в остальных ~20% листьев nonIT (опс/админ).
function leafAttrs(path,blockSeg){
  const segment = blockSeg==='nonIT' ? 'nonIT' : (rng('seg'+path)()<0.20?'nonIT':'IT');
  const is_hq = rng('hq'+path)()<0.55;
  return {segment,is_hq};
}
// код узла ниже блока: включает номер блока для глобальной различимости (напр. «1.2.3» — блок 1, далее 2.3)
function nodeCode(path){return path.split('/').slice(1).map(s=>String(parseInt(s,10))).join('.')}
function genName(level,path){return level>=3 ? LEVEL_SHORT[level]+' '+nodeCode(path) : ''}

// рекурсивная генерация поддерева под узлом-блоком (level 2).
// onSpine — у каждого блока РОВНО ОДИН «хребет» (первый ребёнок хребта), уходящий на 12 уровней;
// остальные ветки схлопываются в листья тем раньше, чем глубже уровень.
function genChildren(node,blockSeg,onSpine){
  if(node.level>=MAX_LEVEL)return;
  const r=rng('br'+node.path);
  const nc = node.level===2 ? 2+Math.floor(r()*2)   // 2..3 департамента
           : node.level===3 ? 2                       // 2 управления
           : 1+Math.floor(r()*2);                     // 1..2 глубже
  for(let i=0;i<nc;i++){
    const childLevel=node.level+1;
    const childPath=node.path+'/'+pad2(i+1);
    const childOnSpine = onSpine && i===0;            // хребет продолжает только первый ребёнок
    let isLeaf;
    if(childLevel>=MAX_LEVEL)   isLeaf=true;          // 12-й уровень всегда лист
    else if(childOnSpine)       isLeaf=false;         // хребет уходит на глубину
    else { const lp = childLevel<=4 ? 0.40 : Math.min(0.94,(childLevel-3)*0.30); isLeaf=rng('leaf'+childPath)()<lp; }
    const child={id:childPath,path:childPath,parent:node.path,level:childLevel,
      name:genName(childLevel,childPath),sort:sortCtr++,domainId:node.domainId,leaf:isLeaf,is_focus:false};
    if(isLeaf)Object.assign(child,leafAttrs(childPath,blockSeg));
    NODES.push(child);
    if(!isLeaf)genChildren(child,blockSeg,childOnSpine);
  }
}
BLOCK_DEFS.forEach(b=>{
  const bp='T/'+b.id;
  const bn={id:b.id,path:bp,parent:'T',level:2,name:b.name,sort:sortCtr++,domainId:b.id,leaf:false,is_focus:false};
  NODES.push(bn);
  genChildren(bn,b.seg,true);
});
const NODE_BY_PATH=Object.fromEntries(NODES.map(n=>[n.path,n]));
function childrenOf(path){return NODES.filter(n=>n.parent===path)}
function descendantsOf(path){return NODES.filter(n=>n.path===path||n.path.startsWith(path+'/'))}
function leavesUnder(path){return descendantsOf(path).filter(n=>n.leaf)}

/* ---------- Фокусные юниты ----------
   Фокусный юнит = команда, на которой HRBP проставил KPI (забираем из внешнего
   инструмента). Это атрибут самого юнита; видимость управляется зоной HRBP.
   Часть фокусных вложены друг в друга — для демонстрации дедупа на OnePager
   (метрики B уже входят в A → суммировать нельзя). */
NODES.forEach(n=>{ if(n.level>=3) n.is_focus = rng('isfocus'+n.path)()<0.12; });
// гарантированные вложенные цепочки: в каждом блоке по «хребту» помечаем уровни 3, 6, 9
BLOCK_DEFS.forEach(b=>{
  let p='T/'+b.id;
  for(let lvl=3;lvl<=9;lvl++){ p=p+'/01'; if(lvl===3||lvl===6||lvl===9){const n=NODE_BY_PATH[p];if(n)n.is_focus=true;} }
});

/* ---------- Фильтр листьев по атрибутам HQ / segment ---------- */
function leafPassesAttr(leafPath,hqFilter,segFilter){
  const n=NODE_BY_PATH[leafPath];if(!n)return false;
  if(hqFilter==='hq'&&!n.is_hq)return false;
  if(hqFilter==='nonhq'&&n.is_hq)return false;
  if(segFilter==='IT'&&n.segment!=='IT')return false;
  if(segFilter==='nonIT'&&n.segment!=='nonIT')return false;
  return true;
}
/* узлы для верхнеуровневого фильтра «Команда»: корни зоны HRBP + их прямые дети (level −1). */
function teamFilterNodes(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const seen=new Set();const out=[];
  const add=n=>{if(n&&!seen.has(n.path)){seen.add(n.path);out.push(n);}};
  h.scope.forEach(p=>{add(NODE_BY_PATH[p]);childrenOf(p).forEach(add);});
  return out.sort((a,b)=>a.sort-b.sort);
}

/* ---------- HRBP-маппинг ----------
   scope — path зоны ответственности (раскрывается в поддерево).
   reportsTo — вышестоящий HRBP (оргструктура самих HRBP).
   Видимость: каждый видит всё поддерево своей зоны (Senior с зоной = ROOT видит всё).
   Структура спроектирована так, что у Анны (Senior, вся компания) в подчинении 13 HRBP —
   она видит большую картину, у мелких Junior — гранулярная.
*/
const HRBP=[
  {id:'anna',   name:'Анна Сергеева', role:'Senior', reportsTo:null,     scope:['T'],
   note:'Глава HRBP. Видит всю компанию и всех фокусных юнитов под зоной ответственности.'},
  {id:'sergey', name:'Сергей Волков', role:'Senior', reportsTo:'anna',   scope:['T/01'],
   note:'Senior блока «Технологические платформы». В подчинении два Junior.'},
  {id:'marina', name:'Марина Зайцева',role:'Senior', reportsTo:'anna',   scope:['T/02'],
   note:'Senior блока «Розничные продукты». В подчинении два Junior.'},
  {id:'boris',  name:'Борис Котов',   role:'Middle', reportsTo:'anna',   scope:['T/03'],
   note:'Middle блока «Кредитный конвейер».'},
  {id:'nina',   name:'Нина Белова',   role:'Middle', reportsTo:'anna',   scope:['T/04'],
   note:'Middle блока «Платежи и переводы».'},
  {id:'oleg',   name:'Олег Гусев',    role:'Middle', reportsTo:'anna',   scope:['T/05'],
   note:'Middle блока «ML и Research».'},
  {id:'pavel',  name:'Павел Рыжов',   role:'Middle', reportsTo:'anna',   scope:['T/06'],
   note:'Middle блока «Инфраструктура».'},
  {id:'rita',   name:'Рита Лосева',   role:'Middle', reportsTo:'anna',   scope:['T/07'],
   note:'Middle блока «Клиентский сервис».'},
  {id:'dina',   name:'Дина Орлова',   role:'Junior', reportsTo:'sergey', scope:['T/01/01'],
   note:'Junior. Гранулярная зона — один департамент платформ.'},
  {id:'egor',   name:'Егор Лапин',    role:'Junior', reportsTo:'sergey', scope:['T/01/02'],
   note:'Junior. Гранулярная зона — один департамент платформ.'},
  {id:'galya',  name:'Галина Юдина',  role:'Junior', reportsTo:'marina', scope:['T/02/01'],
   note:'Junior. Гранулярная зона — один департамент розничных продуктов.'},
  {id:'igor',   name:'Игорь Седов',   role:'Junior', reportsTo:'marina', scope:['T/02/02'],
   note:'Junior. Гранулярная зона — один департамент розничных продуктов.'},
  {id:'kira',   name:'Кира Малова',   role:'Junior', reportsTo:'boris',  scope:['T/03/01'],
   note:'Junior. Гранулярная зона — один департамент кредитного конвейера.'},
  {id:'lev',    name:'Лев Дроздов',   role:'Junior', reportsTo:'nina',   scope:['T/04/01'],
   note:'Junior. Гранулярная зона — один департамент платежей.'}
];
const HRBP_BY_ID=Object.fromEntries(HRBP.map(h=>[h.id,h]));

// все HRBP в подчинении (рекурсивно), без самого rootId
function hrbpReportsTree(rootId){
  const out=[];const stack=HRBP.filter(h=>h.reportsTo===rootId).map(h=>h.id);
  while(stack.length){const id=stack.pop();out.push(id);HRBP.filter(x=>x.reportsTo===id).forEach(x=>stack.push(x.id));}
  return out;
}
function hrbpSubordinateCount(id){return hrbpReportsTree(id).length}

// подпись зоны HRBP: корень → «Вся компания», иначе перечень имён
function zoneLabel(hrbpId){
  const h=HRBP_BY_ID[hrbpId];
  if(h.scope.includes('T'))return'Вся компания';
  return h.scope.map(p=>(NODE_BY_PATH[p]||{}).name||p).join(', ');
}
// множество path-ов листьев в зоне видимости HRBP
function scopeLeaves(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>leavesUnder(p).forEach(l=>set.add(l.path)));
  return [...set];
}
// блоки (level 2) в зоне видимости
function scopeDomains(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>{descendantsOf(p).filter(n=>n.level===2).forEach(d=>set.add(d.path))});
  return [...set].map(p=>NODE_BY_PATH[p]).sort((a,b)=>a.sort-b.sort);
}
// узлы заданного уровня в зоне видимости
function scopeNodesAtLevel(hrbpId,level){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>descendantsOf(p).filter(n=>n.level===level).forEach(n=>set.add(n.path)));
  return [...set].map(p=>NODE_BY_PATH[p]).sort((a,b)=>a.sort-b.sort);
}
// все узлы зоны (для каскадного фильтра по команде)
function scopeAllNodes(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>descendantsOf(p).forEach(n=>set.add(n.path)));
  return [...set].map(p=>NODE_BY_PATH[p]).sort((a,b)=>a.sort-b.sort);
}

/* ---------- Фокусные юниты в зоне HRBP + дедуп ---------- */
// все узлы зоны (включая узлы scope), как объекты
function nodesInZone(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const m=new Map();
  h.scope.forEach(p=>descendantsOf(p).forEach(n=>m.set(n.path,n)));
  return [...m.values()];
}
// фокусные юниты в зоне, отсортированы по уровню затем по sort
function focusNodesInZone(hrbpId){
  return nodesInZone(hrbpId).filter(n=>n.is_focus).sort((a,b)=>a.level-b.level||a.sort-b.sort);
}
// «корневые фокусные» — у кого нет фокусного предка В ЭТОМ НАБОРЕ (для дедупа)
function rootFocusNodes(nodes){
  const S=new Set(nodes.map(n=>n.path));
  return nodes.filter(n=>{
    const seg=n.path.split('/');
    for(let i=seg.length-1;i>0;i--){if(S.has(seg.slice(0,i).join('/')))return false}
    return true;
  });
}
// объединение листьев под корневыми фокусными (без задвоения численности).
// restrictPath — пересечение с фильтром команды (фокусные внутри выбранного поддерева).
function focusLeafUnion(hrbpId,restrictPath){
  let foc=focusNodesInZone(hrbpId);
  if(restrictPath)foc=foc.filter(n=>n.path===restrictPath||n.path.startsWith(restrictPath+'/'));
  const roots=rootFocusNodes(foc);
  const set=new Set();
  roots.forEach(n=>leavesUnder(n.path).forEach(l=>set.add(l.path)));
  return {leaves:[...set],roots};
}

/* ---------- Генерация рядов метрик по листьям ----------
   Базовая численность на лист + помесячные значения метрик.
   Базовые расчёты (агрегация, % за период) — в «Хеликоптере»; здесь имитируем результат.
*/
const LEAF_HC={};     // path -> [12]
const LEAF_METRIC={}; // path -> {metricKey -> [12]}
function trendNoise(r,base,amp,drift){
  const out=[];let v=base+(r()-0.5)*amp;
  for(let i=0;i<N;i++){v=v+drift*((i/(N-1))-0.5)*2*amp*0.15+(r()-0.5)*amp*0.5;out.push(v)}
  return out;
}
NODES.filter(n=>n.leaf).forEach(leaf=>{
  const r=rng('hc'+leaf.path);
  const base=18+Math.floor(r()*120);
  const hc=[];let cur=base;
  for(let i=0;i<N;i++){cur=Math.max(6,Math.round(cur+(r()-0.45)*8));hc.push(cur)}
  LEAF_HC[leaf.path]=hc;
  const M={};
  const rr=k=>rng(k+leaf.path);
  const isIT = leaf.segment==='IT';
  M.headcount     = hc.slice();
  M.retention_new = trendNoise(rr('rn'),70+r()*22, 8,1).map(v=>Math.min(98,Math.max(48,+v.toFixed(1))));
  M.regret        = trendNoise(rr('rg'),2.2+r()*6, 3,1).map(v=>Math.max(0.4,+v.toFixed(1)));
  M.nonregret     = trendNoise(rr('nr'),4+r()*6,   3,0).map(v=>Math.max(1.0,+v.toFixed(1)));
  M.exit_reasons  = trendNoise(rr('er'),68+r()*28, 7,1).map(v=>Math.min(99,Math.max(45,+v.toFixed(1))));
  M.jun_team      = trendNoise(rr('jt'),(isIT?22:15)+(r()-0.5)*16, 4,0).map(v=>Math.min(48,Math.max(6,+v.toFixed(1))));
  M.jun_hire      = trendNoise(rr('jh'),(isIT?30:22)+(r()-0.5)*20, 6,0).map(v=>Math.min(60,Math.max(8,+v.toFixed(1))));
  M.region_hire   = trendNoise(rr('rh'),32+r()*30, 6,1).map(v=>Math.min(85,Math.max(8,+v.toFixed(1))));
  M.absentees     = trendNoise(rr('ab'),0.8+r()*4, 1.6,0).map(v=>Math.max(0.0,+v.toFixed(1)));
  M.unused_vac    = trendNoise(rr('uv'),4+r()*12,  4,1).map(v=>Math.max(0.5,+v.toFixed(1)));
  LEAF_METRIC[leaf.path]=M;
});

/* ---------- Агрегация метрики по узлу (rollup значения) ----------
   headcount — сумма; проценты/дни — взвешенное среднее по численности.
*/
function aggMetric(path,metricKey){
  const leaves=leavesUnder(path);
  if(leaves.length===0)return new Array(N).fill(0);
  const out=new Array(N).fill(0);
  if(metricKey==='headcount'){
    for(let i=0;i<N;i++)out[i]=leaves.reduce((s,l)=>s+LEAF_HC[l.path][i],0);
    return out;
  }
  for(let i=0;i<N;i++){
    let num=0,den=0;
    leaves.forEach(l=>{const w=LEAF_HC[l.path][i];num+=LEAF_METRIC[l.path][metricKey][i]*w;den+=w});
    out[i]=den?+(num/den).toFixed(1):0;
  }
  return out;
}
const AGG_CACHE={};
function metricSeries(path,metricKey){
  const k=path+'|'+metricKey;
  if(!AGG_CACHE[k])AGG_CACHE[k]=aggMetric(path,metricKey);
  return AGG_CACHE[k];
}
function headcountAt(path,idx){return metricSeries(path,'headcount')[idx==null?LAST:idx]}

// агрегация метрики по ПРОИЗВОЛЬНОМУ набору листьев (для фокусного объединения и фильтров)
function aggMetricLeaves(leafPaths,metricKey){
  if(!leafPaths||leafPaths.length===0)return new Array(N).fill(0);
  const out=new Array(N).fill(0);
  if(metricKey==='headcount'){
    for(let i=0;i<N;i++)out[i]=leafPaths.reduce((s,p)=>s+(LEAF_HC[p]?LEAF_HC[p][i]:0),0);
    return out;
  }
  for(let i=0;i<N;i++){
    let num=0,den=0;
    leafPaths.forEach(p=>{const w=LEAF_HC[p]?LEAF_HC[p][i]:0;if(w){num+=LEAF_METRIC[p][metricKey][i]*w;den+=w}});
    out[i]=den?+(num/den).toFixed(1):0;
  }
  return out;
}

/* ---------- Бенчмарк-ряды ---------- */
const BENCH_SERIES={};
['company','hq','it','nonit'].forEach(bk=>{
  BENCH_SERIES[bk]={};
  METRICS.forEach(m=>{
    const anchor=BENCH_ANCHOR[bk][m.key];
    const r=rng('bench'+bk+m.key);
    const arr=[];
    for(let i=0;i<N;i++){
      const drift=(i-LAST)/N*0.06;
      arr.push(m.fmt==='int'?Math.round(anchor*(1+drift)) : +(anchor*(1+drift+(r()-0.5)*0.02)).toFixed(1));
    }
    arr[LAST]=anchor;
    BENCH_SERIES[bk][m.key]=arr;
  });
});
function benchSeries(benchKey,metricKey){return benchKey==='none'?null:BENCH_SERIES[benchKey][metricKey]}
function benchValue(benchKey,metricKey,idx){const s=benchSeries(benchKey,metricKey);return s?s[idx==null?LAST:idx]:null}

/* ============================================================
   СВЕТОФОР (треш-холды)
   ------------------------------------------------------------
   Реальные цели задаёт Senior HRBP во внешнем инструменте — per команда×метрика.
   В прототипе моделируем это:
     • leafThreshold(path,metric) — цель конкретной команды (с лёгким разбросом
       вокруг эталона; у части команд цель НЕ задана → null).
     • stateFor(metric,value,thr) — состояние относительно цели: good/warn/bad/neutral.
   На верхних уровнях (OnePager / домен / ИТОГО) пороги НЕЛЬЗЯ усреднять — у команд
   разные KPI. Поэтому агрегируем СОСТОЯНИЕ, а не порог: aggregateState().
   ============================================================ */
const LEAF_THR_CACHE={};
function leafThreshold(path,metricKey){
  const m=METRIC_BY_KEY[metricKey];
  if(!m.threshold)return null;                 // метрика по природе без порога
  const k=path+'|'+metricKey;
  if(k in LEAF_THR_CACHE)return LEAF_THR_CACHE[k];
  const r=rng('thr'+path+metricKey);
  let res;
  if(r()<0.15){res=null;}                       // SrHRBP ещё не задал цель этой команде
  else{const f=0.9+r()*0.2;                     // индивидуальная цель ±10% от эталона
    res={green:+(m.threshold.green*f).toFixed(1),red:+(m.threshold.red*f).toFixed(1)};}
  LEAF_THR_CACHE[k]=res;return res;
}
function stateFor(metricKey,value,thr){
  const m=METRIC_BY_KEY[metricKey];
  thr=thr||m.threshold;
  if(!thr)return'neutral';
  const {green,red}=thr;
  if(m.better==='lower'){if(value<=green)return'good';if(value>=red)return'bad';return'warn';}
  if(m.better==='higher'){if(value>=green)return'good';if(value<=red)return'bad';return'warn';}
  return'neutral';
}
// состояние относительно ДЕФОЛТНОЙ цели метрики (для эталонных подсветок)
function thresholdState(metricKey,value){return stateFor(metricKey,value,null)}

/* Агрегация СОСТОЯНИЯ по набору листьев (верхний уровень с разными KPI).
   Правило: доля «вне порога» считается взвешенно по численности.
     bad   — доля плохих по людям ≥ 25%
     warn  — есть хоть один плохой, ИЛИ доля «внимание» ≥ 40%
     good  — все остальные команды с заданной целью в норме
     neutral — ни у одной команды цель не задана (или метрика без порога)
*/
function aggregateState(leafPaths,metricKey,idx){
  idx=idx==null?LAST:idx;
  const m=METRIC_BY_KEY[metricKey];
  if(!m.threshold)return{state:'neutral',nBad:0,nWarn:0,nGood:0,nTotal:0,nNoTarget:leafPaths.length,shareBad:0,shareWarn:0};
  let nBad=0,nWarn=0,nGood=0,nTotal=0,nNoTarget=0,hcBad=0,hcWarn=0,hcTotal=0;
  leafPaths.forEach(p=>{
    const thr=leafThreshold(p,metricKey);
    const hc=metricSeries(p,'headcount')[idx];
    if(!thr){nNoTarget++;return;}
    const v=metricSeries(p,metricKey)[idx];
    const st=stateFor(metricKey,v,thr);
    nTotal++;hcTotal+=hc;
    if(st==='bad'){nBad++;hcBad+=hc;}
    else if(st==='warn'){nWarn++;hcWarn+=hc;}
    else{nGood++;}
  });
  if(nTotal===0)return{state:'neutral',nBad:0,nWarn:0,nGood:0,nTotal:0,nNoTarget,shareBad:0,shareWarn:0};
  const shareBad=hcBad/hcTotal,shareWarn=hcWarn/hcTotal;
  let state;
  if(shareBad>=0.25)state='bad';
  else if(shareBad>0||shareWarn>=0.40)state='warn';
  else state='good';
  return{state,nBad,nWarn,nGood,nTotal,nNoTarget,shareBad,shareWarn};
}

/* ============================================================
   ФОКУСНЫЕ МЕТРИКИ КОМАНДЫ + НАПРАВЛЕННОЕ СРАВНЕНИЕ
   ------------------------------------------------------------
   teamFocus(path) — набор фокусных метрик КОНКРЕТНОЙ команды с целевыми
     значениями (KPI). Их задаёт Senior HRBP во внешнем инструменте на
     уровне команды (не HRBP). У части команд фокус не задан → {} (тогда
     сравниваем с выбранным бенчмарком). KPI = {green,red} как у порога.
   compareState(metric,value,base) — направленное сравнение значения с одним
     бейзлайном (бенчмарком): good = лучше, bad = хуже, neutral = в пределах
     паритетной полосы CMP_EPS или для flat-метрик.
   ============================================================ */
const CMP_EPS={pct:0.3,days:0.2,int:0};   // паритетная полоса: меньше — считаем «вровень»
function compareState(metricKey,value,base){
  const m=METRIC_BY_KEY[metricKey];
  if(base==null||m.better==='flat')return'neutral';
  const eps=CMP_EPS[m.fmt]||0;
  const d=value-base;
  if(Math.abs(d)<=eps)return'neutral';
  const better=(m.better==='higher'&&d>0)||(m.better==='lower'&&d<0);
  return better?'good':'bad';
}
const FOCUS_CACHE={};
function teamFocus(path){
  if(!path)return{};
  if(path in FOCUS_CACHE)return FOCUS_CACHE[path];
  const r=rng('focus'+path);
  const cand=METRICS.filter(m=>m.threshold);   // фокусной может стать только метрика с целью
  const out={};
  if(r()>=0.15){                               // ~85% команд имеют выставленные фокусные KPI
    const arr=cand.map(m=>({m,o:r()})).sort((a,b)=>a.o-b.o);
    const k=2+Math.floor(r()*2);               // 2–3 фокусные метрики
    arr.slice(0,k).forEach(({m})=>{
      const f=0.9+r()*0.2;                      // индивидуальная цель ±10% от эталона
      out[m.key]={green:+(m.threshold.green*f).toFixed(1),red:+(m.threshold.red*f).toFixed(1)};
    });
  }
  FOCUS_CACHE[path]=out;return out;
}

/* ---------- Форматтеры (ru-локаль) ---------- */
function fmtInt(v){return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ')}
function fmtNum1(v){return (Math.round(v*10)/10).toString().replace('.',',')}
function fmtPct(v){return fmtNum1(v)+'%'}
function fmtVal(metricKey,v){const m=METRIC_BY_KEY[metricKey];if(m.fmt==='int')return fmtInt(v);if(m.fmt==='days')return fmtNum1(v)+' дн';return fmtPct(v)}
function fmtDelta(metricKey,v){
  const m=METRIC_BY_KEY[metricKey];const s=v>0?'+':(v<0?'−':'');const a=Math.abs(v);
  const body=m.fmt==='int'?fmtInt(a):fmtNum1(a);
  const suf=m.fmt==='int'?'':(m.fmt==='days'?' дн':' п.п.');
  return s+body+suf;
}

/* ---------- Дельты YoY / MoM (приближённо: первый vs последний / предпоследний) ---------- */
function deltas(series){
  const last=series[LAST],prev=series[LAST-1],first=series[0];
  return {mom:+(last-prev).toFixed(1), yoy:+(last-first).toFixed(1)};
}

window.HRBPDATA={MONTHS,N,LAST,BLOCKS,METRICS,METRIC_BY_KEY,metricsOfBlock,DEV_METRICS,WANTED_METRICS,
  BENCHMARKS,NODES,NODE_BY_PATH,ROOT,BLOCK_DEFS,MAX_LEVEL,LEVEL_ABBR,levelLabel,
  HRBP,HRBP_BY_ID,hrbpReportsTree,hrbpSubordinateCount,
  childrenOf,descendantsOf,leavesUnder,scopeLeaves,scopeDomains,scopeNodesAtLevel,scopeAllNodes,
  leafPassesAttr,teamFilterNodes,zoneLabel,
  nodesInZone,focusNodesInZone,rootFocusNodes,focusLeafUnion,
  metricSeries,headcountAt,aggMetricLeaves,benchSeries,benchValue,
  leafThreshold,stateFor,thresholdState,aggregateState,compareState,teamFocus,CMP_EPS,
  fmtInt,fmtNum1,fmtPct,fmtVal,fmtDelta,deltas};
