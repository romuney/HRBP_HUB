import tactuality

is_actual = tactuality.tables_wait(
    [
        'prod_v_emart.mdm_employee_structure_d'
        , 'prod_v_sse_crossdata.mdm_employee_regrettable'
        , 'prod_v_hrmart.legal_position_dismissal_reason'
        , 'prod_v_sse_crossdata.mdm_employee_residence'
        , 'prod_v_sse_crossdata.legal_position_vacation'
        , 'prod_v_emart.legal_position_d'
    ],
    gp_service='cross',
)
if not is_actual:
    print('Not actual')
