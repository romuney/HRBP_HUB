-- ============================================================================
-- HH · параметры. Всё, что меняется без правки остальных параграфов.
--   data_dt            — последний день данных в источнике (срез last_day_flg = 1)
--   last_month_end     — конец последнего ЗАКРЫТОГО месяца: текущий месяц в отчёт
--                        не идёт, недостроенный период читается как обвал метрики
--   last_week_end      — последнее закрытое воскресенье (неделя пн–вс)
--   nr_grace_days      — причина увольнения считается «не заполненной», если с
--                        увольнения прошло столько дней, а её всё нет
--   super_hrbp_unit_rk — юнит, где сидит супер-HRBP («лид эйчар»), как в ноуте
--                        «Связи и подчинения»; сверить с фактическим юнитом
--   active_type_value  — тип численности «Активная»: при нём найм и закрепляемость — по приходу в
--                        активную численность (найм в компанию с этим типом + candidate_transfer_flg +
--                        internal_transfer_flg), иначе — по найму в компанию (company_hire_flg)
--   hq_paint_value     — покраска HQ: знаменатель текучести — активная численность этой покраски
--   nonlegal_type      — значение «Тип численности» для строк legal_employee_flg <> 1: без выбранного
--                        типа отчёт берёт только юридическую численность (датасет исключает это значение),
--                        выбрать его можно явно (HRBP 13.10)
-- Окна метрик (12 мес / 52 нед и т. д.) — в параграфе «HH · куб по разрезам».
-- ============================================================================
drop table if exists hh_param;
create table hh_param as
select d.data_dt                                                          as data_dt,
       (date_trunc('month', d.data_dt + 1) - interval '1 day')::date       as last_month_end,
       (d.data_dt - (extract(isodow from d.data_dt)::int % 7))::date       as last_week_end,
       30                                                                  as nr_grace_days,
       '50eb70d6df69372ceb7f354df8e8aa53'::text                            as super_hrbp_unit_rk,
       'Активная'::text                                                    as active_type_value,
       'HQ'::text                                                          as hq_paint_value,
       'Вне юр. численности'::text                                         as nonlegal_type
from (select max(business_dt)::date as data_dt
      from prod_v_emart.mdm_employee_structure_d
      where business_dt >= current_date - 14
        and last_day_flg = 1) d
distributed replicated;

-- Джуны: seniority ILIKE шаблон. Состав — по бизнес-контексту: intern, jun, jun+
-- (в источнике «Intern», «Junior», «Junior+»). Поменять состав = поменять строки.
drop table if exists hh_param_junior;
create table hh_param_junior (pattern text) distributed replicated;
insert into hh_param_junior values ('intern%'), ('jun%');

-- Администраторы отчёта: видят всю компанию, как супер-HRBP. Логины — как в Proteus.
drop table if exists hh_param_admin;
create table hh_param_admin (login text) distributed replicated;
insert into hh_param_admin values ('r.kazantsev');

-- Стоп, если источник пуст или не обновился: дальше все массивы съехали бы на месяц.
select 1 / (case when data_dt is null or data_dt < current_date - 7 then 0 else 1 end) as data_dt_check
from hh_param;
