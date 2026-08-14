/* ============================================================
   HRBP HUB · Greenplum · 05 — цели (KPI) и наследование
   ------------------------------------------------------------
   Цели приходят из внешнего инструмента настройки KPI отдельным датасетом.
   В факт они НЕ вклеиваются: цели меняются несколько раз в день, факт —
   раз в сутки, и применимость цели зависит от того, что выбрано на полке
   фильтров прямо сейчас.

   Здесь предрассчитывается только наследование — оно от фильтров
   не зависит: цель, поставленная на юнит, действует на всю его ветку
   вниз, пока ниже не встретится своя.

   КОНТРАКТ ИСТОЧНИКА hrbp_src.kpi_rule
     rule_id      уникальный идентификатор правила
     hrbp_id      кто поставил цель
     unit_id      ТОТ ЖЕ справочник, что в оргструктуре хранилища
     metric_id    из dim_metric, не свободный текст
     target       целевое значение в единицах метрики
     f_*          шесть разрезов, ЯВНОЕ 'all' вместо NULL:
                  NULL в сравнении ведёт себя иначе, и правило «на всю
                  численность» перестанет находиться
     valid_from / valid_to / is_active   история: цель, поставленную
                  в июне, нельзя применять к январю — иначе прошлое
                  в отчёте меняется задним числом
     updated_at   тай-брейк для двух правил с одинаковым набором разрезов
   ============================================================ */

/* ---------- Действующие цели на каждый узел ----------
   Для узла берём правила ВСЕХ его предков (включая его самого).
   Внутри одинакового набора разрезов оставляем правило самого глубокого
   предка: более высокое правило с тем же набором он всё равно перебивает.

   Выбор МЕЖДУ разными наборами разрезов здесь не делается — он зависит
   от выбора на полке и происходит в serving-вьюхе (sql/proteus).
*/
drop table if exists hrbp_mart.kpi_effective;
create table hrbp_mart.kpi_effective as
with candidates as (
  select c.unit_id                                   as unit_id,
         r.metric_id,
         r.f_paint, r.f_it_segment, r.f_stream, r.f_spec, r.f_staff_type, r.f_hc_type,
         r.target,
         r.rule_id,
         r.hrbp_id,
         r.unit_id                                   as owner_unit_id,
         o.unit_name                                 as owner_unit_name,
         o.unit_level                                as owner_level,
         case when r.unit_id = c.unit_id then 0 else 1 end as is_inherited,
         case when r.unit_id = c.unit_id then 1 else 0 end as is_own,
         (case when r.f_paint      <> 'all' then 1 else 0 end)
       + (case when r.f_it_segment <> 'all' then 1 else 0 end)
       + (case when r.f_stream     <> 'all' then 1 else 0 end)
       + (case when r.f_spec       <> 'all' then 1 else 0 end)
       + (case when r.f_staff_type <> 'all' then 1 else 0 end)
       + (case when r.f_hc_type    <> 'all' then 1 else 0 end) as specificity,
         row_number() over (
           partition by c.unit_id, r.metric_id,
                        r.f_paint, r.f_it_segment, r.f_stream,
                        r.f_spec, r.f_staff_type, r.f_hc_type
           order by o.unit_level desc, r.updated_at desc, r.rule_id desc) as rn
  from hrbp_mart.dim_unit_closure c            -- scope_unit_id = предок, unit_id = потомок
  join hrbp_src.kpi_rule r  on r.unit_id = c.scope_unit_id
  join hrbp_mart.dim_unit o on o.unit_id = r.unit_id
  where r.is_active
    and current_date between r.valid_from and coalesce(r.valid_to, date '9999-12-31')
)
select unit_id, metric_id,
       f_paint, f_it_segment, f_stream, f_spec, f_staff_type, f_hc_type,
       target, rule_id, hrbp_id,
       owner_unit_id, owner_unit_name, owner_level,
       is_inherited, is_own, specificity
from candidates
where rn = 1
distributed by (unit_id);

create index kpi_effective_unit_idx on hrbp_mart.kpi_effective (unit_id, metric_id);

/* ---------- Признак «на юните есть своя цель» ----------
   Тумблер «Только фокусные» на вкладке «Команды» оставляет юниты,
   у которых цель стоит СВОЯ: унаследованная есть у всей ветки и
   не убрала бы ни одной строки.

   Признак умышленно не учитывает разрезы: тумблер отвечает на вопрос
   «здесь вообще что-то настраивали», а не «подходит ли цель под
   текущий фильтр» — на этот вопрос отвечает сама цель в ячейке.
*/
drop table if exists hrbp_mart.kpi_unit_flag;
create table hrbp_mart.kpi_unit_flag as
select unit_id,
       max(is_own)                                as has_own_target,
       sum(case when is_own = 1 then 1 else 0 end) as own_target_cnt,
       count(*)                                   as effective_target_cnt
from hrbp_mart.kpi_effective
group by unit_id
distributed by (unit_id);
