-- Цели для стенда (вставляются после параграфа «KPI · реестр целей»): наследование,
-- перебивающая цель глубже, цели по разрезам, история (действует с мая), битые правила.
insert into hh_kpi_src values
  ('T-001', md5('unit:Технологии'),            'regret',          3.6, 'all', 'all', 'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'Цель блока: наследуется на всю ветку'),
  ('T-002', md5('unit:Технологии'),            'retention_new_3', 88,  'all', 'all', 'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'Закрепляемость блока'),
  ('T-003', md5('unit:Департамент платформ'),  'regret',          2.8, 'all', 'all', 'all', 'all', 'all',     'all', '2026-05-01', null, 'stand', 'Своя цель департамента с мая'),
  ('T-004', md5('unit:Департамент карт'),      'regret',          2.9, 'HQ',  'all', 'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'HQ-численность'),
  ('T-005', md5('unit:Департамент карт'),      'regret',          4.8, 'all', 'all', 'all', 'all', 'Не штат', 'all', '2024-01-01', null, 'stand', 'Не штат'),
  ('T-006', md5('unit:root'),                  'exit_reasons',    2.0, 'all', 'all', 'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'Компания: незаполненных причин не больше 2%'),
  ('T-007', md5('unit:root'),                  'jun_team',        20,  'all', 'all', 'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'Компания: доля джунов'),
  ('T-008', md5('unit:Управление ML'),         'retention_new_6', 85,  'all', 'IT',  'all', 'all', 'all',     'all', '2024-01-01', null, 'stand', 'IT-новички ML'),
  ('T-009', 'нет-такого-юнита',                'regret',          3.0, 'all', 'all', 'all', 'all', 'all',     'all', null,         null, 'stand', 'битый rk'),
  ('T-010', md5('unit:root'),                  'nonregret',       5.0, 'all', 'all', 'all', 'all', 'all',     'all', null,         null, 'stand', 'метрика без целей');
