tf.tables_wait([
    'prod_v_emart.mdm_employee_structure_d'
    , 'usr_cross_data.regrettable_n_non_regrettable_base'
    , 'prod_v_hrmart.legal_position_dismissal_reason'
    , 'prod_v_sse_crossdata.mdm_employee_residence'
    ], gp_service='cross'
)
