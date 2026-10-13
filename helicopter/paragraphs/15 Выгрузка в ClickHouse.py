# Выгрузка витрин HRBP HUB в ClickHouse (база Proteus CROSS → prod_proteus).
# replace — таблица пересобирается целиком: окно сдвигается каждый месяц, и старые
# слоты меняют смысл, дописывать нечего. ORDER BY — под фильтры датасета: куб
# режется по пути юнита (ветка юнита лежит подряд), справочник — по id, доступ —
# по логину, база — по разрезам, свёртка атрибутов — по юниту.
from proteus_py.database.clickhouse import gp_to_click

gp_to_click('hrbp_hub_calendar', 'prod_proteus.hrbp_hub_calendar',
    gp_service='gp', upload_mode='replace', order_by_columns='(grain, idx)')
gp_to_click('hrbp_hub_unit', 'prod_proteus.hrbp_hub_unit',
    gp_service='gp', upload_mode='replace', array_type_cast=True, order_by_columns='(id)')
gp_to_click('hrbp_hub_access', 'prod_proteus.hrbp_hub_access',
    gp_service='gp', upload_mode='replace', order_by_columns='(login)')
# hrbp_hub_kpi отсюда больше НЕ выгружается (13.10): цели пишет форма n8n в DLH (dl.usr_cross_data.hrbp_hub_kpi), и
# prod_proteus.hrbp_hub_kpi наполняет переливка DLH → CH раз в 30 минут. Выгрузка ноута затирала бы её.
gp_to_click('hrbp_hub_cube', 'prod_proteus.hrbp_hub_cube',
    gp_service='gp', upload_mode='replace', array_type_cast=True, order_by_columns='(path_s)')
gp_to_click('hrbp_hub_attr', 'prod_proteus.hrbp_hub_attr',
    gp_service='gp', upload_mode='replace', array_type_cast=True, order_by_columns='(attr_k, path_s)')
gp_to_click('hrbp_hub_attr_top', 'prod_proteus.hrbp_hub_attr_top',
    gp_service='gp', upload_mode='replace', array_type_cast=True, order_by_columns='(unit_id)')
gp_to_click('hrbp_hub_base', 'prod_proteus.hrbp_hub_base',
    gp_service='gp', upload_mode='replace', array_type_cast=True, order_by_columns='(paint, it, stream, spec, staff, hct)')
