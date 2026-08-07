/* ============================================================
   HRBP HUB — мок-данные прототипа
   Самодостаточный детерминированный генератор.
   В Proteus эти структуры приходят из ClickHouse (см. спеку датасетов).
   Метрики — реальный перечень (action-метрики), разбиты на логические блоки.

   Целевые значения (KPI) живут отдельным реестром KPI_RULES и НАСЛЕДУЮТСЯ
   вниз по дереву: цель, поставленная на блок, действует на всю ветку, пока
   ниже не встретится своя цель — начиная с неё и вниз работает она.
   ============================================================ */

/* ---------- PRNG (детерминированный) ---------- */
function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function rng(seed){return mulberry32(hashStr(seed))}

/* ---------- Периоды: янв 2025 — июнь 2026 ----------
   Окно намеренно длиннее года: графики строятся «год к году», и для этого
   нужен весь прошлый год целиком плюс отработанная часть текущего.
   Индексы 0..11 — 2025-й, 12..17 — 2026-й.
*/
const MONTH_ABBR=['янв.','февр.','март','апр.','май','июнь','июль','авг.','сент.','окт.','нояб.','дек.'];
const YEAR_PREV=2025, YEAR_CUR=2026;
const CUR_LEN=6;                      // сколько месяцев текущего года уже закрыто
const MONTHS=(function(){
  const out=[];
  for(let m=0;m<12;m++)out.push({y:YEAR_PREV,m,label:MONTH_ABBR[m]});
  for(let m=0;m<CUR_LEN;m++)out.push({y:YEAR_CUR,m,label:MONTH_ABBR[m]});
  return out;
})();
const N=MONTHS.length;                // 18
const LAST=N-1;                       // июнь 2026
const CUR_START=12;                   // индекс января текущего года
const WIN_FROM=LAST-11;               // начало скользящего окна «12 мес»
const PERIOD_LABEL='июнь 2026';
const PREV_LABEL='маю 2026';
const YEAR_LABEL='июню 2025';
/* Ряды для графика «год к году»: прошлый год целиком, текущий — с хвостом из
   null, чтобы обе линии легли на одну ось из двенадцати месяцев. */
function prevYearOf(series){return series.slice(0,12)}
function curYearOf(series){
  const out=series.slice(CUR_START);
  while(out.length<12)out.push(null);
  return out;
}
function windowOf(series){return series.slice(WIN_FROM,LAST+1)}
function windowMonths(){return MONTHS.slice(WIN_FROM,LAST+1)}

/* ---------- Логические блоки метрик (синхронизированы с OnePager) ---------- */
const BLOCKS=[
  {key:'retention', name:'Удержание и текучесть', hint:'Закрепляемость, нежелательные уходы, причины увольнений.'},
  {key:'structure', name:'Структура команды',     hint:'Численность, доля джунов, регионализация найма.'},
  {key:'discipline',name:'Дисциплина и баланс',   hint:'Прогулы и неотгуленные отпуска.'}
];
const BLOCK_BY_KEY=Object.fromEntries(BLOCKS.map(b=>[b.key,b]));

/* ---------- Конфиг метрик ----------
   better: 'lower' | 'higher' | 'flat'   — направление «лучше»
   fmt:    'int' | 'pct' | 'days'
   ref:    ориентир метрики по компании (для подсказки в окне настройки KPI).
           Настоящую цель ставит HRBP в реестре KPI — см. KPI_RULES.
   Метрики с better:'flat' не окрашиваются и цель на них не ставится:
   «больше» у них не значит «лучше».
*/
const METRICS=[
  // Блок 1 — Удержание и текучесть
  {key:'retention_new', scale:'share', block:'retention', name:'Закрепляемость новичков',      short:'Закрепл.',  fmt:'pct',  better:'higher', unit:'%',   ref:85, hint:'Доля новичков, прошедших испытательный срок и оставшихся.'},
  {key:'regret',        block:'retention', name:'Regrettable текучесть',         short:'Regret',    fmt:'pct',  better:'lower',  unit:'%',   ref:4,  hint:'Текучесть среди ценных сотрудников (нежелательные уходы), годовой темп.'},
  {key:'nonregret',     block:'retention', name:'Non regrettable текучесть',     short:'Non-reg.',  fmt:'pct',  better:'flat',   unit:'%',   ref:null, hint:'Текучесть без сожаления (управляемые уходы). Нейтральная: больше не значит лучше.'},
  {key:'exit_reasons', scale:'share',  block:'retention', name:'Заполнение причин увольнений',  short:'Причины',   fmt:'pct',  better:'higher', unit:'%',   ref:90, hint:'Доля увольнений с заполненной причиной (качество данных оттока).'},
  // Блок 2 — Структура команды
  {key:'headcount',     block:'structure', name:'Численность',                   short:'Числ.',     fmt:'int',  better:'flat',   unit:'чел', ref:null, hint:'Списочная численность сотрудников на конец месяца. Абсолютная величина — с базой не сравнивается.'},
  {key:'jun_team', scale:'share',      block:'structure', name:'% джунов в команде',            short:'Джуны',     fmt:'pct',  better:'higher', unit:'%',   ref:20, hint:'Доля сотрудников грейда Junior/Junior+ в команде.'},
  {key:'jun_hire', scale:'share',      block:'structure', name:'% джунов в найме',              short:'Джуны найм',fmt:'pct',  better:'higher', unit:'%',   ref:30, hint:'Доля джунов среди принятых за период.'},
  {key:'region_hire', scale:'share',   block:'structure', name:'% найма в регионах',           short:'Регион найм',fmt:'pct',  better:'higher', unit:'%',   ref:40, hint:'Доля найма вне Москвы и Санкт-Петербурга (регионализация).'},
  // Блок 3 — Дисциплина и баланс
  {key:'absentees',     block:'discipline',name:'Прогульщики',                   short:'Прогулы',   fmt:'pct',  better:'lower',  unit:'%',   ref:1,  hint:'Доля сотрудников с неоправданными отсутствиями за период.'},
  {key:'unused_vac',    block:'discipline',name:'Неотгуленные отпуска',          short:'Отпуска',   fmt:'days', better:'lower',  unit:'дн',  ref:5,  hint:'Среднее число накопленных неотгуленных дней отпуска на сотрудника.'}
];
const METRIC_BY_KEY=Object.fromEntries(METRICS.map(m=>[m.key,m]));
function metricsOfBlock(blockKey){return METRICS.filter(m=>m.block===blockKey)}
/* метрика, на которую в принципе можно поставить цель и которую можно окрасить */
function targetable(key){return METRIC_BY_KEY[key].better!=='flat'}
/* доля от численности: шкала всегда 0–100%, площадь под линией закрашена —
   пустое место под графиком превращается в саму долю, а не в воздух */
function isShare(key){return METRIC_BY_KEY[key].scale==='share'}
/* абсолютные величины с базой не сравниваются (212 человек против 2 968 — это масштаб, а не оценка) */
function comparable(key){return METRIC_BY_KEY[key].fmt!=='int'&&METRIC_BY_KEY[key].better!=='flat'}

/* ---------- Метрики «в разработке» и «хотим разработать» (каталог) ---------- */
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

/* ============================================================
   ФИЛЬТРЫ ЧИСЛЕННОСТИ
   ------------------------------------------------------------
   Один и тот же набор разрезов работает в двух местах: как фильтр отчёта
   на левой полке и как условие применения KPI в реестре целей. Поэтому
   определения лежат в одном месте — иначе окно настройки KPI и фильтры
   отчёта разъедутся, и цель по «HQ» перестанет находить свою численность.
   ============================================================ */
const PAINTS=[{key:'all',name:'Все покраски'},{key:'HQ',name:'HQ'},{key:'Line',name:'Line'},{key:'Support',name:'Support'}];
const ITSEGS=[{key:'all',name:'IT и nonIT'},{key:'IT',name:'Только IT'},{key:'nonIT',name:'Только nonIT'}];
const STREAMS=[{key:'all',name:'Все стримы'},{key:'Платформа',name:'Платформа'},{key:'Продукт',name:'Продукт'},
  {key:'Данные',name:'Данные'},{key:'Операции',name:'Операции'},{key:'Сопровождение',name:'Сопровождение'}];
const SPECS=[{key:'all',name:'Все специализации'},{key:'Разработка',name:'Разработка'},{key:'Аналитика',name:'Аналитика'},
  {key:'Тестирование',name:'Тестирование'},{key:'Инфраструктура',name:'Инфраструктура'},{key:'Продукт',name:'Продукт'},{key:'Поддержка',name:'Поддержка'}];
const STAFFTYPES=[{key:'all',name:'Штат и не штат'},{key:'staff',name:'Только штат'},{key:'nonstaff',name:'Только не штат'}];
const HCTYPES=[{key:'all',name:'Вся численность'},{key:'core',name:'Основной состав'},{key:'part',name:'Совместители'},
  {key:'project',name:'Проектные'},{key:'intern',name:'Стажёры'}];

/* key    — поле состояния отчёта и поле условия в правиле KPI
   attr   — атрибут листа, по которому идёт отбор
   label  — подпись фильтра и группы в окне настройки KPI
   chip   — как разрез называется в подписи базы сравнения */
const FILTER_DEFS=[
  {key:'paint',    attr:'paint', label:'Покраска',        list:PAINTS,     chip:v=>v},
  {key:'itSeg',    attr:'it',    label:'IT / nonIT',      list:ITSEGS,     chip:v=>v},
  {key:'stream',   attr:'stream',label:'Стрим',           list:STREAMS,    chip:v=>'стрим '+v},
  {key:'spec',     attr:'spec',  label:'Специализация',   list:SPECS,      chip:v=>v.toLowerCase()},
  {key:'staffType',attr:'staff', label:'Штат / не штат',  list:STAFFTYPES, chip:v=>v==='staff'?'штат':'не штат'},
  {key:'hcType',   attr:'hcType',label:'Тип численности', list:HCTYPES,    chip:v=>({core:'основной состав',part:'совместители',project:'проектные',intern:'стажёры'})[v]}
];
const FILTER_BY_KEY=Object.fromEntries(FILTER_DEFS.map(f=>[f.key,f]));
const EMPTY_FILTERS=Object.fromEntries(FILTER_DEFS.map(f=>[f.key,'all']));

/* ---------- Оргдерево: 12 уровней управленческой структуры ----------
   level 1  — компания (вершина, «Вся компания»),
   level 2  — блоки/направления,
   level 3..12 — департамент → управление → отдел → … → ячейка.
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
const LEVEL_ABBR={1:'Компания',2:'Блок',3:'Департамент',4:'Управление',5:'Отдел',6:'Центр',7:'Группа',8:'Подгруппа',9:'Команда',10:'Звено',11:'Подзвено',12:'Ячейка'};
function levelLabel(level){return LEVEL_ABBR[level]||('ур. '+level)}
const pad2=n=>String(n).padStart(2,'0');

/* ---------- Названия подразделений ----------
   Осмысленные имена вместо «Упр. 1.1.2»: в дашборде на двенадцать уровней
   по кодам не сориентироваться — глазу не за что зацепиться, а список
   юнитов в фильтре превращается в перебор номеров.
*/
const NAME_POOL={
  IT:{
    3:['Мобильная разработка','Веб-платформа','Бэкенд и интеграции','Архитектура решений','Качество и тестирование','Цифровые продукты','Платёжные сервисы','Данные и аналитика'],
    4:['Разработка iOS','Разработка Android','Фронтенд-разработка','Сервисы и API','Автоматизация тестирования','Платформенные сервисы','Интеграционная шина','DevOps и релизы'],
    5:['Отдел платежей','Отдел онбординга','Отдел личного кабинета','Отдел уведомлений','Отдел поиска','Отдел каталога','Отдел авторизации','Отдел отчётности'],
    6:['Центр компетенций','Центр разработки','Центр интеграций','Центр качества','Центр аналитики','Центр эксплуатации'],
    7:['Группа разработки','Группа поддержки','Группа аналитики','Группа внедрения','Группа релизов','Группа автотестов'],
    8:['Подгруппа бэкенда','Подгруппа фронтенда','Подгруппа мобильных','Подгруппа данных','Подгруппа инфраструктуры'],
    9:['Команда каталога','Команда корзины','Команда профиля','Команда поиска','Команда уведомлений','Команда витрины'],
    10:['Звено API','Звено интерфейсов','Звено данных','Звено интеграций','Звено надёжности'],
    11:['Подзвено сервисов','Подзвено миграций','Подзвено метрик','Подзвено кэша'],
    12:['Ячейка разработки','Ячейка тестирования','Ячейка поддержки','Ячейка эксплуатации']
  },
  nonIT:{
    3:['Клиентский сервис','Операционная поддержка','Качество обслуживания','Бизнес-процессы','Сопровождение клиентов','Административный блок'],
    4:['Контакт-центр','Поддержка первой линии','Разбор обращений','Бэк-офис операций','Контроль качества','Обучение и методология','Документооборот','Планирование ресурсов'],
    5:['Отдел голосовой поддержки','Отдел текстовых каналов','Отдел премиального сегмента','Отдел малого бизнеса','Отдел рекламаций','Отдел верификации','Отдел сверки операций','Сервисный деск'],
    6:['Центр обслуживания','Центр контроля качества','Центр обучения','Центр планирования','Центр верификации'],
    7:['Группа дневной смены','Группа вечерней смены','Группа эскалаций','Группа контроля','Группа наставников'],
    8:['Подгруппа входящих','Подгруппа исходящих','Подгруппа чатов','Подгруппа почты','Подгруппа соцсетей'],
    9:['Команда розницы','Команда бизнеса','Команда премиума','Команда взысканий','Команда лояльности'],
    10:['Звено приёма','Звено разбора','Звено контроля','Звено отчётности'],
    11:['Подзвено обращений','Подзвено претензий','Подзвено сверок'],
    12:['Ячейка операторов','Ячейка кураторов','Ячейка контроля','Ячейка поддержки']
  }
};
/* Имена уникальны по всему дереву: в плоском списке «Все юниты» два
   одинаковых «Группа поддержки» неразличимы. Кончился пул — добавляем номер,
   как это и бывает в живых оргструктурах. */
const usedNames=new Set();
function pickName(level,seg,path){
  const pool=NAME_POOL[seg==='nonIT'?'nonIT':'IT'][level]||NAME_POOL.IT[12];
  const start=Math.floor(rng('nm'+path)()*pool.length);
  for(let i=0;i<pool.length;i++){
    const cand=pool[(start+i)%pool.length];
    if(!usedNames.has(cand)){usedNames.add(cand);return cand}
  }
  for(let n=2;;n++){
    const cand=pool[start]+' '+n;
    if(!usedNames.has(cand)){usedNames.add(cand);return cand}
  }
}

const NODES=[];
const ROOT={id:'T',path:'T',parent:null,level:1,name:'ТБанк',sort:0,domainId:null,leaf:false};
NODES.push(ROOT);
let sortCtr=1;

/* Атрибуты листа — детерминированно по path. Блок nonIT целиком nonIT;
   в остальных ~20% листьев nonIT (опс/админ). */
function leafAttrs(path,blockSeg){
  const rp=rng('paint'+path)();
  const paint = rp<0.42?'HQ':(rp<0.78?'Line':'Support');
  const it = blockSeg==='nonIT' ? 'nonIT' : (rng('seg'+path)()<0.20?'nonIT':'IT');
  const staff = rng('st'+path)()<0.86?'staff':'nonstaff';
  const stream = STREAMS[1+Math.floor(rng('str'+path)()*(STREAMS.length-1))].key;
  const spec = SPECS[1+Math.floor(rng('sp'+path)()*(SPECS.length-1))].key;
  const hr=rng('hct'+path)();
  const hcType = hr<0.72?'core':(hr<0.84?'part':(hr<0.94?'project':'intern'));
  return {paint,it,staff,stream,spec,hcType};
}

/* onSpine — у каждого блока РОВНО ОДИН «хребет», уходящий на 12 уровней;
   остальные ветки схлопываются в листья тем раньше, чем глубже уровень. */
function genChildren(node,blockSeg,onSpine){
  if(node.level>=MAX_LEVEL)return;
  const r=rng('br'+node.path);
  const nc = node.level===2 ? 2+Math.floor(r()*2)
           : node.level===3 ? 2
           : 1+Math.floor(r()*2);
  for(let i=0;i<nc;i++){
    const childLevel=node.level+1;
    const childPath=node.path+'/'+pad2(i+1);
    const childOnSpine = onSpine && i===0;
    let isLeaf;
    if(childLevel>=MAX_LEVEL)   isLeaf=true;
    else if(childOnSpine)       isLeaf=false;
    else { const lp = childLevel<=4 ? 0.40 : Math.min(0.94,(childLevel-3)*0.30); isLeaf=rng('leaf'+childPath)()<lp; }
    const child={id:childPath,path:childPath,parent:node.path,level:childLevel,
      name:pickName(childLevel,blockSeg,childPath),sort:sortCtr++,domainId:node.domainId,leaf:isLeaf};
    if(isLeaf)Object.assign(child,leafAttrs(childPath,blockSeg));
    NODES.push(child);
    if(!isLeaf)genChildren(child,blockSeg,childOnSpine);
  }
}
BLOCK_DEFS.forEach(b=>{
  const bp='T/'+b.id;
  const bn={id:b.id,path:bp,parent:'T',level:2,name:b.name,sort:sortCtr++,domainId:b.id,leaf:false};
  NODES.push(bn);
  genChildren(bn,b.seg,true);
});
const NODE_BY_PATH=Object.fromEntries(NODES.map(n=>[n.path,n]));
const _kids={};
NODES.forEach(n=>{if(n.parent){(_kids[n.parent]=_kids[n.parent]||[]).push(n)}});
function childrenOf(path){return (_kids[path]||[]).slice().sort((a,b)=>a.sort-b.sort)}
function descendantsOf(path){return NODES.filter(n=>n.path===path||n.path.startsWith(path+'/'))}
const _leaves={};
function leavesUnder(path){
  if(!_leaves[path])_leaves[path]=descendantsOf(path).filter(n=>n.leaf);
  return _leaves[path];
}
function ancestorsOf(path){
  const seg=path.split('/');const out=[];
  for(let i=1;i<=seg.length;i++){const q=seg.slice(0,i).join('/');if(NODE_BY_PATH[q])out.push(NODE_BY_PATH[q])}
  return out;
}
function parentOf(path){const n=NODE_BY_PATH[path];return n&&n.parent?NODE_BY_PATH[n.parent]:null}
/* цепочка от корня до узла в виде подписи «Блок › Деп. 1.1 › Упр. 1.1.2» */
function pathLabel(path,fromLevel){
  return ancestorsOf(path).filter(n=>n.level>=(fromLevel||2)).map(n=>n.name).join(' › ');
}
/* узлы уровня −depth от заданного; если детей нет — сам узел */
function nodesBelow(path,depth){
  let cur=[NODE_BY_PATH[path]].filter(Boolean);
  for(let d=0;d<depth;d++){
    const next=[];
    cur.forEach(n=>{const k=childrenOf(n.path);next.push(...(k.length?k:[n]))});
    cur=[...new Map(next.map(n=>[n.path,n])).values()];
  }
  return cur.sort((a,b)=>a.sort-b.sort);
}

/* ---------- Фильтр листьев по всем разрезам численности ---------- */
function leafPasses(leafPath,st){
  const n=NODE_BY_PATH[leafPath];
  if(!n||!n.leaf)return false;
  for(const f of FILTER_DEFS){
    const want=st[f.key];
    if(want&&want!=='all'&&n[f.attr]!==want)return false;
  }
  return true;
}
/* подпись активных разрезов: «HQ + IT + штат» */
function filterChips(st){
  const out=[];
  FILTER_DEFS.forEach(f=>{const v=st[f.key];if(v&&v!=='all')out.push({k:f.key,label:f.chip(v)})});
  return out;
}
function filterLabel(st){
  const c=filterChips(st);
  return c.length?c.map(x=>x.label).join(' + '):'вся численность';
}

/* ---------- HRBP-маппинг ---------- */
const HRBP=[
  {id:'anna',   name:'Анна Сергеева', role:'Senior', reportsTo:null,     scope:['T'],
   note:'Глава HRBP. Видит всю компанию и все юниты с выставленными целями под зоной ответственности.'},
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

function hrbpReportsTree(rootId){
  const out=[];const stack=HRBP.filter(h=>h.reportsTo===rootId).map(h=>h.id);
  while(stack.length){const id=stack.pop();out.push(id);HRBP.filter(x=>x.reportsTo===id).forEach(x=>stack.push(x.id));}
  return out;
}
function hrbpSubordinateCount(id){return hrbpReportsTree(id).length}
function zoneLabel(hrbpId){
  const h=HRBP_BY_ID[hrbpId];
  if(h.scope.includes('T'))return'Вся компания';
  return h.scope.map(p=>(NODE_BY_PATH[p]||{}).name||p).join(', ');
}
/* HRBP, отвечающий за узел: самая глубокая зона, накрывающая путь */
function hrbpOfUnit(path){
  let best=null,bestLen=-1;
  HRBP.forEach(h=>h.scope.forEach(p=>{
    if(path===p||path.startsWith(p+'/')){if(p.length>bestLen){bestLen=p.length;best=h}}
  }));
  return best;
}
function scopeLeaves(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>leavesUnder(p).forEach(l=>set.add(l.path)));
  return [...set];
}
function scopeAllNodes(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const set=new Set();
  h.scope.forEach(p=>descendantsOf(p).forEach(n=>set.add(n.path)));
  return [...set].map(p=>NODE_BY_PATH[p]).sort((a,b)=>a.sort-b.sort);
}
function nodesInZone(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const m=new Map();
  h.scope.forEach(p=>descendantsOf(p).forEach(n=>m.set(n.path,n)));
  return [...m.values()];
}
/* узлы верхнеуровневого фильтра «Юнит»: корни зоны HRBP + их прямые дети (−1) */
function teamFilterNodes(hrbpId){
  const h=HRBP_BY_ID[hrbpId];const seen=new Set();const out=[];
  const add=n=>{if(n&&!seen.has(n.path)){seen.add(n.path);out.push(n);}};
  h.scope.forEach(p=>{add(NODE_BY_PATH[p]);childrenOf(p).forEach(add);});
  return out.sort((a,b)=>a.sort-b.sort);
}

/* ============================================================
   РЕЕСТР ЦЕЛЕЙ (KPI) И НАСЛЕДОВАНИЕ
   ------------------------------------------------------------
   Правило: {hrbpId, unit, metric, target, filters}
     unit    — юнит, на который HRBP поставил цель
     filters — к какой численности цель применяется: 'all' в поле значит
               «к любой», конкретное значение — «только к этому разрезу»
     target  — само целевое значение метрики

   Наследование: цель действует на весь поддерево юнита. Если у потомка есть
   своя цель по этой же метрике — начиная с него и вниз работает его цель.
   Поиск идёт от узла ВВЕРХ до первого предка с подходящим правилом:
   ближайшая цель побеждает.

   Несколько целей на одном юните — норма: одна на всю численность, другая
   на «HQ», третья на «не штат». Показать их одновременно нельзя (числа
   в отчёте посчитаны по одной популяции), поэтому отчёт показывает ту,
   что подходит под текущие фильтры, и подсказывает про остальные.
   ============================================================ */
let KPI_SEQ=1;
const KPI_RULES=[];
function addKpi(o){
  const rule={id:'k'+(KPI_SEQ++),hrbpId:o.hrbpId||(hrbpOfUnit(o.unit)||{}).id||'anna',
    unit:o.unit,metric:o.metric,target:+o.target,
    filters:Object.assign({},EMPTY_FILTERS,o.filters||{}),note:o.note||''};
  KPI_RULES.push(rule);
  invalidateKpiCache();
  return rule;
}
function removeKpi(id){
  const i=KPI_RULES.findIndex(r=>r.id===id);
  if(i>=0){KPI_RULES.splice(i,1);invalidateKpiCache();return true}
  return false;
}
/* «специфичность» правила: сколько разрезов в нём зафиксировано.
   На одном юните более узкое правило (HQ + штат) побеждает более широкое. */
function ruleSpecificity(r){return FILTER_DEFS.reduce((s,f)=>s+(r.filters[f.key]!=='all'?1:0),0)}
/* правило применимо, только если каждый его разрез выбран в фильтрах отчёта:
   цель «по HQ» нельзя мерить числом, посчитанным по всем покраскам */
function ruleMatches(r,st){
  return FILTER_DEFS.every(f=>r.filters[f.key]==='all'||r.filters[f.key]===(st?st[f.key]:'all'));
}
function ownKpis(unitPath,metricKey){
  return KPI_RULES.filter(r=>r.unit===unitPath&&(!metricKey||r.metric===metricKey));
}
function hasOwnKpi(unitPath){return KPI_RULES.some(r=>r.unit===unitPath)}
/* число целей на юните, которые сейчас НЕ показываются: их закрывают фильтры */
function hiddenKpiCount(unitPath,st,metricKey){
  return ownKpis(unitPath,metricKey).filter(r=>!ruleMatches(r,st)).length;
}

let KPI_CACHE={};
function invalidateKpiCache(){KPI_CACHE={}}
/* Ядро наследования. Возвращает:
     {rule, owner, inherited}  — цель и юнит, на котором она стоит
     null                      — цели нет ни на юните, ни выше */
function resolveKpi(unitPath,metricKey,st){
  if(!unitPath||!targetable(metricKey))return null;
  const ck=unitPath+'|'+metricKey+'|'+FILTER_DEFS.map(f=>st?st[f.key]:'all').join(',');
  if(ck in KPI_CACHE)return KPI_CACHE[ck];
  let res=null;
  const seg=unitPath.split('/');
  for(let i=seg.length;i>0;i--){
    const p=seg.slice(0,i).join('/');
    const cand=KPI_RULES.filter(r=>r.unit===p&&r.metric===metricKey&&ruleMatches(r,st));
    if(cand.length){
      cand.sort((a,b)=>ruleSpecificity(b)-ruleSpecificity(a));
      res={rule:cand[0],owner:NODE_BY_PATH[p],inherited:p!==unitPath};
      break;
    }
  }
  KPI_CACHE[ck]=res;
  return res;
}
/* есть ли у юнита хоть одна цель (своя или унаследованная) по видимым метрикам */
function anyKpiFor(unitPath,metricKeys,st){
  return metricKeys.some(k=>resolveKpi(unitPath,k,st));
}

/* ---------- Стартовый набор целей ----------
   Собран так, чтобы на прототипе было видно всё поведение сразу:
   цель на блоке уходит вниз по всей ветке, цель глубже её перебивает,
   а на паре юнитов стоит по несколько целей с разными разрезами. */
(function seedKpi(){
  BLOCK_DEFS.forEach((b,bi)=>{
    const bp='T/'+b.id;
    // 1 · цель блока: действует на всю ветку вниз
    addKpi({unit:bp,metric:'regret',target:+(3.6+bi*0.2).toFixed(1),
      note:'Цель блока. Наследуется на всю ветку.'});
    addKpi({unit:bp,metric:'retention_new',target:82+bi,
      note:'Цель блока по закрепляемости.'});
    // 2 · перебивающая цель на пятом уровне хребта
    const spine5=bp+'/01/01/01';
    if(NODE_BY_PATH[spine5])addKpi({unit:spine5,metric:'regret',target:+(2.6+bi*0.15).toFixed(1),
      note:'Своя цель отдела — перебивает цель блока начиная с этого уровня.'});
    // 3 · цель на департаменте по другой метрике
    const dep=bp+'/01';
    if(NODE_BY_PATH[dep])addKpi({unit:dep,metric:'exit_reasons',target:88+((bi%3)*2),
      note:'Цель департамента по качеству данных оттока.'});
    // 4 · несколько целей на одном юните: общая уже есть, добавляем узкие
    if(NODE_BY_PATH[dep]&&bi<3){
      addKpi({unit:dep,metric:'regret',target:+(2.9+bi*0.1).toFixed(1),filters:{paint:'HQ'},
        note:'Отдельная цель по HQ-численности департамента.'});
      addKpi({unit:dep,metric:'regret',target:+(4.8+bi*0.1).toFixed(1),filters:{staffType:'nonstaff'},
        note:'Отдельная цель по не-штатной численности.'});
    }
    // 5 · дисциплина — на управлении второй ветки
    const upr=bp+'/02';
    if(NODE_BY_PATH[upr])addKpi({unit:upr,metric:'unused_vac',target:6+bi,
      note:'Цель по неотгуленным отпускам.'});
  });
  // 6 · целевые значения по регионализации найма — на уровне компании
  addKpi({unit:'T',hrbpId:'anna',metric:'region_hire',target:40,note:'Компанейская цель по регионализации найма.'});
  addKpi({unit:'T',hrbpId:'anna',metric:'absentees',target:1.5,note:'Компанейская цель по прогулам.'});
})();

/* ---------- Генерация рядов метрик по листьям ---------- */
const LEAF_HC={};
const LEAF_METRIC={};
function trendNoise(r,base,amp,drift){
  const out=[];let v=base+(r()-0.5)*amp;
  for(let i=0;i<N;i++){v=v+drift*((i/(N-1))-0.5)*2*amp*0.15+(r()-0.5)*amp*0.5;out.push(v)}
  return out;
}
/* ---------- Общая волна метрики ----------
   Шум в каждом листе независим, поэтому на агрегате из сотен листьев он
   гасится, и год превращается в прямую. Прямая линия у факта — признак
   выдумки: у метрики всегда есть сезон (лето и январь по отпускам, декабрь
   по уходам) и общие для всей компании события — реорг, пересмотр, волна
   найма. Волна одна на метрику и складывается со всеми листьями сразу,
   поэтому доживает до любого уровня агрегации. */
const COMMON_AMP={
  retention_new:4.2, regret:0.9,  nonregret:1.0, exit_reasons:5.0,
  jun_team:1.5,      jun_hire:3.0, region_hire:3.4,
  absentees:0.4,     unused_vac:1.3
};
const COMMON_WAVE=(function(){
  const out={};
  Object.keys(COMMON_AMP).forEach(k=>{
    const r=rng('wave·'+k), amp=COMMON_AMP[k], ph=r()*Math.PI*2;
    let shock=0; const arr=[];
    for(let i=0;i<N;i++){
      /* затухающий шок: событие сдвигает метрику и отпускает её за пару
         месяцев — так это и выглядит в жизни, а не как одиночный выброс */
      shock=shock*0.55+(r()-0.5)*1.9;
      arr.push(amp*(0.6*Math.sin(ph+i*Math.PI/6)+0.8*shock));
    }
    out[k]=arr;
  });
  return out;
})();
/* ряд листа = собственный тренд + общая волна, затем границы метрики */
function leafSeries(metricKey,r,base,amp,drift,lo,hi){
  const w=COMMON_WAVE[metricKey];
  return trendNoise(r,base,amp,drift).map((v,i)=>
    +Math.min(hi,Math.max(lo,v+w[i])).toFixed(1));
}
NODES.filter(n=>n.leaf).forEach(leaf=>{
  const r=rng('hc'+leaf.path);
  const base=18+Math.floor(r()*120);
  const hc=[];let cur=base;
  for(let i=0;i<N;i++){cur=Math.max(6,Math.round(cur+(r()-0.45)*8));hc.push(cur)}
  LEAF_HC[leaf.path]=hc;
  const M={};
  const rr=k=>rng(k+leaf.path);
  const isIT = leaf.it==='IT';
  const INF=Infinity;
  M.headcount     = hc.slice();
  M.retention_new = leafSeries('retention_new',rr('rn'),70+r()*22, 8,  1, 48, 98);
  M.regret        = leafSeries('regret',       rr('rg'),2.2+r()*6, 3,  1, 0.4, INF);
  M.nonregret     = leafSeries('nonregret',    rr('nr'),4+r()*6,   3,  0, 1.0, INF);
  M.exit_reasons  = leafSeries('exit_reasons', rr('er'),68+r()*28, 7,  1, 45, 99);
  M.jun_team      = leafSeries('jun_team',     rr('jt'),(isIT?22:15)+(r()-0.5)*16, 4,0, 6, 48);
  M.jun_hire      = leafSeries('jun_hire',     rr('jh'),(isIT?30:22)+(r()-0.5)*20, 6,0, 8, 60);
  M.region_hire   = leafSeries('region_hire',  rr('rh'),32+r()*30, 6,  1, 8,  85);
  M.absentees     = leafSeries('absentees',    rr('ab'),0.8+r()*4, 1.6,0, 0,  INF);
  M.unused_vac    = leafSeries('unused_vac',   rr('uv'),4+r()*12,  4,  1, 0.5,INF);
  LEAF_METRIC[leaf.path]=M;
});

/* ---------- Агрегация ----------
   headcount — сумма; проценты/дни — взвешенное среднее по численности. */
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
/* агрегация по ПРОИЗВОЛЬНОМУ набору листьев (фильтры, объединение фокусных) */
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
function lastVal(leafPaths,metricKey){return aggMetricLeaves(leafPaths,metricKey)[LAST]}

/* ---------- База сравнения ----------
   ГЛАВНОЕ ПРАВИЛО: база выводится из ФИЛЬТРОВ, а не из подразделения.
   Выбрали HQ — сравнение со всем HQ компании; добавили IT — со всем HQ IT.
   Выбор юнита базу не меняет, и это сказано в интерфейсе прямо.
*/
const BENCH_CACHE={};
function benchKeyOf(st){return FILTER_DEFS.map(f=>st[f.key]||'all').join(',')}
function benchmarkLeaves(st){
  const k='L|'+benchKeyOf(st);
  if(!BENCH_CACHE[k])BENCH_CACHE[k]=leavesUnder('T').map(l=>l.path).filter(p=>leafPasses(p,st));
  return BENCH_CACHE[k];
}
function benchmarkSeries(st,metricKey){
  const k='S|'+benchKeyOf(st)+'|'+metricKey;
  if(!BENCH_CACHE[k])BENCH_CACHE[k]=aggMetricLeaves(benchmarkLeaves(st),metricKey);
  return BENCH_CACHE[k];
}
function benchmarkValue(st,metricKey,idx){return benchmarkSeries(st,metricKey)[idx==null?LAST:idx]}
function benchmarkLabel(st){
  const parts=filterChips(st).map(c=>c.label);
  return parts.length?('вся компания · '+parts.join(' + ')):'вся компания';
}

/* ============================================================
   ОЦЕНКА
   ------------------------------------------------------------
   Светофор ровно из двух сигналов: зелёный и красный. Всё, что попадает
   в мёртвую зону ±5%, серое — присматриваться там не к чему.
   ============================================================ */
const DEAD_ZONE=0.05;
/* состояние относительно ЦЕЛИ */
function stateForKpi(metricKey,value,target){
  const m=METRIC_BY_KEY[metricKey];
  if(target==null||m.better==='flat')return'neutral';
  if(m.better==='higher'){
    if(value>=target)return'good';
    return value>=target*(1-DEAD_ZONE)?'warn':'bad';
  }
  if(value<=target)return'good';
  return value<=target*(1+DEAD_ZONE)?'warn':'bad';
}
/* направленное сравнение с базой (бенчмарком) */
function compareState(metricKey,value,base){
  const m=METRIC_BY_KEY[metricKey];
  if(base==null||m.better==='flat')return'neutral';
  const d=value-base;
  if(Math.abs(d)<=Math.abs(base)*DEAD_ZONE)return'neutral';
  const better=(m.better==='higher'&&d>0)||(m.better==='lower'&&d<0);
  return better?'good':'bad';
}
/* Единая развилка ориентира — одна на весь отчёт (карточка, ячейка, график).
   Есть цель — сравниваемся ТОЛЬКО с ней, база рядом не показывается. */
function baselineFor(unitPath,metricKey,value,st){
  const k=resolveKpi(unitPath,metricKey,st);
  if(k){
    return {kind:'kpi',target:k.rule.target,rule:k.rule,owner:k.owner,inherited:k.inherited,
      state:stateForKpi(metricKey,value,k.rule.target)};
  }
  if(comparable(metricKey)){
    const bv=benchmarkValue(st,metricKey);
    if(bv!=null)return {kind:'bench',base:bv,label:benchmarkLabel(st),
      state:compareState(metricKey,value,bv)};
  }
  return {kind:'none',state:'neutral'};
}
/* состояние по каждому месяцу окна — для спарклайна: цветной не только
   последний бар, а каждый, иначе тренд не читается */
function statesOver(unitPath,metricKey,series,st){
  const k=resolveKpi(unitPath,metricKey,st);
  if(k)return series.map(v=>stateForKpi(metricKey,v,k.rule.target));
  if(comparable(metricKey)){
    const b=windowOf(benchmarkSeries(st,metricKey));
    return series.map((v,i)=>compareState(metricKey,v,b[i]));
  }
  return series.map(()=>'neutral');
}

/* ---------- Форматтеры (ru-локаль) ----------
   Тонкий пробел в разрядах, запятая в дробной части, типографский минус.
   Минус ставит именно форматтер: иначе соседняя ячейка, зовущая его напрямую,
   осталась бы с дефисом. */
const THIN=' ', MINUS='−';
function fmtInt(v){
  const neg=v<0;
  const s=Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,THIN);
  return (neg?MINUS:'')+s;
}
/* Один знак после запятой всегда: «5%» рядом с «4,8%» в одном столбце
   читается как другая точность, а не как то же самое число. */
function fmtNum1(v){
  const neg=v<0;
  return (neg?MINUS:'')+Math.abs(v).toFixed(1).replace('.',',');
}
function fmtPct(v){return fmtNum1(v)+'%'}
function fmtDays(v){return (v<0?MINUS:'')+Math.abs(v).toFixed(0)+THIN+'дн'}
function fmtVal(metricKey,v){
  const m=METRIC_BY_KEY[metricKey];
  if(m.fmt==='int')return fmtInt(v);
  if(m.fmt==='days')return fmtDays(v);
  return fmtPct(v);
}
/* Изменение: направление кодирует ЗНАК, а не стрелка. Ноль — без знака. */
function fmtDelta(metricKey,v){
  const m=METRIC_BY_KEY[metricKey];
  const a=Math.abs(v);
  const body=m.fmt==='int'?fmtInt(a):(m.fmt==='days'?a.toFixed(0):a.toFixed(1).replace('.',','));
  const suf=m.fmt==='int'?'':(m.fmt==='days'?THIN+'дн':THIN+'п.п.');
  if(v===0)return body+suf;
  return (v>0?'+':MINUS)+body+suf;
}
/* класс пилюли изменения: знак говорит о направлении, класс — об оценке */
function deltaClass(metricKey,v){
  const m=METRIC_BY_KEY[metricKey];
  if(v===0)return'flat';
  if(m.better==='flat')return'neu';
  const good=(m.better==='lower'&&v<0)||(m.better==='higher'&&v>0);
  return good?'up':'down';
}

/* ---------- Дельты MoM / YoY ---------- */
function deltas(series){
  const last=series[LAST];
  return {mom:+(last-series[LAST-1]).toFixed(1),
          yoy:+(last-series[LAST-12]).toFixed(1)};   // тот же месяц прошлого года
}

window.HRBPDATA={MONTHS,MONTH_ABBR,N,LAST,CUR_START,CUR_LEN,WIN_FROM,YEAR_PREV,YEAR_CUR,
  prevYearOf,curYearOf,windowOf,windowMonths,PERIOD_LABEL,PREV_LABEL,YEAR_LABEL,
  BLOCKS,BLOCK_BY_KEY,METRICS,METRIC_BY_KEY,metricsOfBlock,targetable,comparable,isShare,
  DEV_METRICS,WANTED_METRICS,
  PAINTS,ITSEGS,STREAMS,SPECS,STAFFTYPES,HCTYPES,FILTER_DEFS,FILTER_BY_KEY,EMPTY_FILTERS,
  NODES,NODE_BY_PATH,ROOT,BLOCK_DEFS,MAX_LEVEL,LEVEL_ABBR,levelLabel,
  HRBP,HRBP_BY_ID,hrbpReportsTree,hrbpSubordinateCount,hrbpOfUnit,
  childrenOf,descendantsOf,leavesUnder,ancestorsOf,parentOf,pathLabel,nodesBelow,
  scopeLeaves,scopeAllNodes,nodesInZone,teamFilterNodes,zoneLabel,
  leafPasses,filterChips,filterLabel,
  KPI_RULES,addKpi,removeKpi,ownKpis,hasOwnKpi,hiddenKpiCount,ruleMatches,ruleSpecificity,
  resolveKpi,anyKpiFor,
  metricSeries,headcountAt,aggMetricLeaves,lastVal,
  benchmarkLeaves,benchmarkSeries,benchmarkValue,benchmarkLabel,
  stateForKpi,compareState,baselineFor,statesOver,DEAD_ZONE,
  fmtInt,fmtNum1,fmtPct,fmtDays,fmtVal,fmtDelta,deltaClass,deltas,THIN,MINUS};
