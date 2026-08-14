/* ============================================================
   HRBP HUB · Greenplum · 04 — L3: плоская витрина под BI
   ------------------------------------------------------------
   Куб L2 разворачивается по оргдереву: строка листа повторяется для
   каждого своего предка. Платим ~4–5× по строкам, получаем то, ради чего
   всё затевалось: фильтр «Юнит» становится обычным равенством, а не
   рекурсией, которой в Superset нет.

   Гранул результата:
     grain × period_start × scope_unit_id × child_unit_id × grandchild_unit_id
           × 6 разрезов × metric_id

   Листья внутри одного scope_unit_id сворачиваются до узла −2: до листа
   детализация в макете не доходит, а экономия заметная (на структуре
   прототипа — в 1,65 раза).

   Узел −1 и строка ИТОГО отдельными строками НЕ материализуются: их
   получает фронт свёрткой узлов −2 (num/den аддитивны, строк десятки).
   Материализация всех трёх уровней стоила бы 789 пар вместо 336 —
   2,3× объёма ради сложения полусотни чисел в браузере.

   ИНВАРИАНТ: в любом запросе к витрине зафиксирован ровно один
   scope_unit_id. Внутри одного scope каждый лист встречается один раз,
   поэтому суммы честные; без фиксации scope строки задвоятся по предкам.
   На дашборде это обеспечивается обязательным фильтром «Юнит» со
   значением по умолчанию.
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

/* ---------- Витрина ---------- */
drop table if exists hrbp_mart.mart_hub;
create table hrbp_mart.mart_hub as
select a.grain,
       a.period_start,
       /* адреса в дереве */
       c.scope_unit_id,
       c.scope_unit_name,
       c.scope_unit_level,
       c.child_unit_id,
       uc.unit_name                                as child_unit_name,
       c.grandchild_unit_id,
       ug.unit_name                                as grandchild_unit_name,
       o.owner_hrbp_id                             as scope_hrbp_id,
       o.owner_zone_root_unit_id                   as scope_hrbp_zone_root_id,
       /* разрезы численности */
       a.paint, a.it_segment, a.stream, a.spec, a.staff_type, a.hc_type,
       /* метрика и её паспорт — денормализованы: в ClickHouse это
          LowCardinality и стоит почти ничего, зато BI не платит джойном */
       a.metric_id,
       m.metric_name, m.metric_short, m.metric_block,
       m.metric_better, m.metric_fmt, m.metric_unit,
       m.is_ratio, m.out_scale,
       /* измерения */
       sum(a.value_num)  as value_num,
       sum(a.value_den)  as value_den
from hrbp_mart.agg_unit_cut_metric a
join hrbp_mart.dim_unit_closure c
  on  c.unit_id = a.unit_id
 and c.unit_is_leaf
join hrbp_mart.dim_metric m on m.metric_id = a.metric_id
left join hrbp_mart.dim_unit uc      on uc.unit_id = c.child_unit_id
left join hrbp_mart.dim_unit ug      on ug.unit_id = c.grandchild_unit_id
left join hrbp_mart.dim_unit_owner o on o.unit_id  = c.scope_unit_id
group by 1,2,3,4,5,6,7,8,9,10,11,
         12,13,14,15,16,17,
         18,19,20,21,22,23,24,25,26
distributed by (scope_unit_id);

/* ---------- База сравнения ----------
   «Вся компания под теми же разрезами». Зависит от разрезов и НЕ зависит
   от выбранного юнита — поэтому её нельзя достать из тех же строк, что
   и факт: они уже ограничены юнитом. Отдельная маленькая таблица,
   джойнится по (period_start, metric_id).
*/
drop table if exists hrbp_mart.mart_hub_bench;
create table hrbp_mart.mart_hub_bench as
select grain, period_start,
       paint, it_segment, stream, spec, staff_type, hc_type,
       metric_id, is_ratio, out_scale,
       sum(value_num) as bench_num,
       sum(value_den) as bench_den
from hrbp_mart.mart_hub
where scope_unit_id = (select unit_id from hrbp_mart.dim_unit where unit_level = 1)
group by 1,2,3,4,5,6,7,8,9,10,11
distributed by (metric_id);
