# Включить, когда борд HRBP HUB опубликован: slug борда — вместо 'hrbp-hub'.
# Учётные данные — те же переменные, что в ноуте Proteus Adoption.
from proteus_py.dashboard.refresh import refresh_dashboard

refresh_dashboard(
    user_login=Z_ENV_CREDENTIAL_LOGIN_R_KAZANTSEV,
    user_password=Z_ENV_CREDENTIAL_PASS_R_KAZANTSEV,
    dashboard_slug='hrbp-hub',
    retries=2,
);
