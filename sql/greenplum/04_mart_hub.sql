/* ============================================================
   HRBP HUB · Greenplum · 04 — L3: плоская витрина под BI
   ------------------------------------------------------------
   Два действия в одном файле:
     A) развернуть куб по оргдереву (closure) и сложить до уровня
        отображения — узла −2;
     B) свернуть время в МАССИВЫ: период перестаёт быть измерением.

   Почему массивы. Окно отчёта фиксировано (12 месяцев в двух годах для
   «год к году» и 24 недели для зума), пользователь его не выбирает.
   Значит, период — не измерение, а позиция в ряду. Один и тот же юнит
   с одним и тем же разрезом больше не даёт 24 строки, отличающиеся
   одним числом и повторяющие двадцать пять текстовых колонок.

   Что это даёт:
     · строк в витрине в ~40 раз меньше при том же количестве чисел;
     · ответ на фронт в разы легче — измерения не повторяются на каждый
       период, а массив приходит одним значением;
     · переключатель «месяц / неделя» становится не нужен: оба ряда
       лежат в одной строке, фронт рисует любой мгновенно.

   Чем платим: период нельзя фильтровать и группировать в SQL. По условию
   задачи это и не требуется, но менять ширину окна теперь означает
   пересборку витрины и согласованную правку фронта — длина массива
   часть контракта.

   ГЛАВНОЕ СВОЙСТВО, КОТОРОЕ ЭТО ПОЗВОЛЯЕТ
   Числитель и знаменатель аддитивны, поэтому агрегация массивов —
   это поэлементное сложение: в ClickHouse sumForEach(), на фронте
   цикл в две строки. Ни на одном шаге не появляется «среднее средних».
   ============================================================ */

/* Справочник метрик — тот же перечень, что в data.js прототипа.
   better: направление «лучше»; flat — метрика не красится и цель на неё
   не ставится, «больше» у неё не значит «лучше».
   out_scale: 100 — доля хранится счётчиками, а показывается процентом. */
drop table if exists hrbp_mart.dim_metric;
create table hrbp_mart.dim_metric (
  metric_id     text primary key,
  metric_name   text,
  metric_short  text,
  metric_block  text,
  metric_better text,
  metric_fmt    text,
  metric_unit   text,
  is_ratio      smallint,
  out_scale     numeric(6,2),
  company_ref   numeric(10,2),
  sort_order    int
) distributed replicated;

insert into hrbp_mart.dim_metric values
 ('retention_new','Закрепляемость новичков','Закрепл.','retention','higher','pct','%',1,100,85,1),
 ('regret',       'Regrettable текучесть','Regret','retention','lower','pct','%',1,100,4,2),
 ('nonregret',    'Non regrettable текучесть','Non-reg.','retention','flat','pct','%',1,100,null,3),
 ('exit_reasons', 'Заполнение причин увольнений','Причины','retention','higher','pct','%',1,100,90,4),
 ('headcount',    'Численность','Числ.','structure','flat','int','чел',0,1,null,5),
 ('jun_team',     '% джунов в команде','Джуны','structure','higher','pct','%',1,100,20,6),
 ('jun_hire',     '% джунов в найме','Джуны найм','structure','higher','pct','%',1,100,30,7),
 ('region_hire',  '% найма в регионах','Регион найм','structure','higher','pct','%',1,100,40,8),
 ('absentees',    'Прогульщики','Прогулы','discipline','lower','pct','%',1,100,1,9),
 ('unused_vac',   'Неотгуленные отпуска','Отпуска','discipline','lower','days','дн',1,1,5,10);


/* ============================================================
   A · развёртка по дереву
   ------------------------------------------------------------
   Строка листа повторяется для каждого своего предка. Платим ~4,3× по
   строкам, получаем то, ради чего всё затевалось: фильтр «Юнит» —
   обычное равенство, а не рекурсия, которой в Superset нет.

   Листья внутри одного scope_unit_id сворачиваются до узла −2: глубже
   детализация в макете не идёт. Узел −1 и строку ИТОГО фронт получает
   свёрткой узлов −2 — материализовать все три уровня стоило бы 789 пар
   вместо 336, то есть 2,3× объёма ради сложения полусотни чисел.

   ИНВАРИАНТ: в любом запросе зафиксирован ровно один scope_unit_id.
   Внутри одного scope каждый лист встречается один раз, поэтому суммы
   честные; без фиксации scope строки задвоятся по предкам. На дашборде
   это обеспечивает обязательный фильтр «Юнит».
   ============================================================ */
drop table if exists hrbp_mart.mart_hub_slot;
create table hrbp_mart.mart_hub_slot as
select a.grain, a.slot_idx,
       c.scope_unit_id, c.scope_unit_name, c.scope_unit_level,
       c.child_unit_id, c.grandchild_unit_id,
       o.owner_hrbp_id           as scope_hrbp_id,
       o.owner_zone_root_unit_id as scope_hrbp_zone_root_id,
       a.paint, a.it_segment, a.stream, a.spec, a.staff_type, a.hc_type,
       a.metric_id,
       sum(a.value_num) as value_num,
       sum(a.value_den) as value_den
from hrbp_mart.agg_unit_cut_metric a
join hrbp_mart.dim_unit_closure c
  on  c.unit_id = a.unit_id
 and c.unit_is_leaf
left join hrbp_mart.dim_unit_owner o on o.unit_id = c.scope_unit_id
group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16
distributed by (scope_unit_id);


/* ============================================================
   B · свёртка времени в массивы
   ------------------------------------------------------------
   Ключ строки теряет период и грануляр: и месяцы, и недели лежат
   в одной строке разными массивами.

   ДВА ПРАВИЛА, БЕЗ КОТОРЫХ МАССИВЫ ЛГУТ:

   1. Длина всегда 24, порядок всегда по slot_idx. Массивы позиционные:
      пропущенный слот сдвинет весь ряд, и график покажет данные не того
      месяца. Поэтому ключи разворачиваются по ПОЛНОМУ календарю слотов,
      а не по тем периодам, где нашлись данные.

   2. Знаменатель работает и маской присутствия: den[i] = 0 значит
      «в этом слоте значения нет» — месяц ещё не закрыт, либо у метрики
      не было популяции (никого не наняли — не из чего считать долю
      джунов в найме). Фронт в этом месте рисует разрыв, а не ноль.
      У абсолютных метрик den = 1 там, где слот закрыт.

   `array_agg(... ) filter (where grain = ...)` — синтаксис PostgreSQL 9.4,
   он есть в Greenplum 6. На более старой версии два ряда собираются
   двумя CTE и джойнятся по ключу.
   ============================================================ */
drop table if exists hrbp_mart.mart_hub;
create table hrbp_mart.mart_hub as
with keys as (
  select distinct scope_unit_id, scope_unit_name, scope_unit_level,
         child_unit_id, grandchild_unit_id,
         scope_hrbp_id, scope_hrbp_zone_root_id,
         paint, it_segment, stream, spec, staff_type, hc_type,
         metric_id
  from hrbp_mart.mart_hub_slot
),
dense as (
  select k.*, p.grain, p.slot_idx,
         coalesce(s.value_num, 0) as value_num,
         /* нет строки в слоте — нет и знаменателя: маска нуля */
         coalesce(s.value_den, 0) as value_den
  from keys k
  cross join hrbp_mart.dim_period p
  left join hrbp_mart.mart_hub_slot s
         on  s.grain              = p.grain
         and s.slot_idx           = p.slot_idx
         and s.scope_unit_id      = k.scope_unit_id
         and s.child_unit_id      = k.child_unit_id
         and s.grandchild_unit_id = k.grandchild_unit_id
         and s.paint              = k.paint
         and s.it_segment         = k.it_segment
         and s.stream             = k.stream
         and s.spec               = k.spec
         and s.staff_type         = k.staff_type
         and s.hc_type            = k.hc_type
         and s.metric_id          = k.metric_id
)
select d.scope_unit_id, d.scope_unit_name, d.scope_unit_level,
       d.child_unit_id, uc.unit_name as child_unit_name,
       d.grandchild_unit_id, ug.unit_name as grandchild_unit_name,
       d.scope_hrbp_id, d.scope_hrbp_zone_root_id,
       d.paint, d.it_segment, d.stream, d.spec, d.staff_type, d.hc_type,
       d.metric_id,
       m.metric_name, m.metric_short, m.metric_block,
       m.metric_better, m.metric_fmt, m.metric_unit,
       m.is_ratio, m.out_scale,
       array_agg(d.value_num order by d.slot_idx) filter (where d.grain = 'month') as num_m,
       array_agg(d.value_den order by d.slot_idx) filter (where d.grain = 'month') as den_m,
       array_agg(d.value_num order by d.slot_idx) filter (where d.grain = 'week')  as num_w,
       array_agg(d.value_den order by d.slot_idx) filter (where d.grain = 'week')  as den_w
from dense d
join hrbp_mart.dim_metric m on m.metric_id = d.metric_id
left join hrbp_mart.dim_unit uc on uc.unit_id = d.child_unit_id
left join hrbp_mart.dim_unit ug on ug.unit_id = d.grandchild_unit_id
group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,
         18,19,20,21,22,23,24,25
distributed by (scope_unit_id);

/* Форма массивов — часть контракта с фронтом, поэтому проверяется здесь,
   а не выясняется на графике. */
do $$
declare bad bigint;
begin
  select count(*) into bad from hrbp_mart.mart_hub
   where array_length(num_m,1) <> 24 or array_length(den_m,1) <> 24
      or array_length(num_w,1) <> 24 or array_length(den_w,1) <> 24;
  if bad > 0 then raise exception 'mart_hub: % строк с массивом не из 24 элементов', bad; end if;
end $$;


/* ============================================================
   База сравнения
   ------------------------------------------------------------
   «Вся компания под теми же разрезами». Зависит от разрезов и НЕ зависит
   от выбранного юнита, поэтому её нельзя достать из строк факта:
   они уже ограничены юнитом. Форма та же — массивы.
   ============================================================ */
/* Собираем из слотовой таблицы, а не из уже свёрнутой витрины:
   поэлементного агрегата массивов в Greenplum нет, а до свёртки
   это обычная сумма. */
drop table if exists hrbp_mart.mart_hub_bench;
create table hrbp_mart.mart_hub_bench as
with bench_slot as (
  select grain, slot_idx, paint, it_segment, stream, spec, staff_type, hc_type,
         metric_id,
         sum(value_num) as value_num,
         sum(value_den) as value_den
  from hrbp_mart.mart_hub_slot
  where scope_unit_level = 1                      -- корень компании
  group by 1,2,3,4,5,6,7,8,9
),
keys as (
  select distinct paint, it_segment, stream, spec, staff_type, hc_type, metric_id
  from bench_slot
),
dense as (
  select k.*, p.grain, p.slot_idx,
         coalesce(b.value_num, 0) as value_num,
         coalesce(b.value_den, 0) as value_den
  from keys k
  cross join hrbp_mart.dim_period p
  left join bench_slot b
         on  b.grain      = p.grain     and b.slot_idx   = p.slot_idx
         and b.paint      = k.paint     and b.it_segment = k.it_segment
         and b.stream     = k.stream    and b.spec       = k.spec
         and b.staff_type = k.staff_type and b.hc_type   = k.hc_type
         and b.metric_id  = k.metric_id
)
select d.paint, d.it_segment, d.stream, d.spec, d.staff_type, d.hc_type,
       d.metric_id, m.is_ratio, m.out_scale,
       array_agg(d.value_num order by d.slot_idx) filter (where d.grain = 'month') as num_m,
       array_agg(d.value_den order by d.slot_idx) filter (where d.grain = 'month') as den_m,
       array_agg(d.value_num order by d.slot_idx) filter (where d.grain = 'week')  as num_w,
       array_agg(d.value_den order by d.slot_idx) filter (where d.grain = 'week')  as den_w
from dense d
join hrbp_mart.dim_metric m on m.metric_id = d.metric_id
group by 1,2,3,4,5,6,7,8,9
distributed by (metric_id);
