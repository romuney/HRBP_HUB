# Владельцы таблиц в Proteus: кто может заводить на них датасеты и открывать в SQL Lab.
# Зрителям борда права на таблицы не нужны — они видят чарт через датасет.
# Впишите логины команды отчёта.
from proteus_py.database.clickhouse import set_table_owners

OWNERS = ['r.kazantsev']
for t in ['hrbp_hub_calendar', 'hrbp_hub_unit', 'hrbp_hub_access', 'hrbp_hub_kpi', 'hrbp_hub_cube', 'hrbp_hub_attr']:
    set_table_owners(database='prod_proteus', table=t, usernames=OWNERS)
