from theoretical_groove import theoretical_groove

def test_no_ideal_line_without_inputs():
    result=theoretical_groove()
    assert result['optimal_coordinates'] is None
    assert result['time_saving_sec'] is None
    assert result['status']=='insufficient_inputs'

def test_cannot_claim_optimum_without_calibrated_model():
    a=[[35.5+i*.000001,-78] for i in range(12)]
    b=[[35.51+i*.000001,-78] for i in range(12)]
    result=theoretical_groove({'inside_boundary':a,'outside_boundary':b},{
        'usable_lateral_acceleration_mps2':5.0,
        'usable_acceleration_mps2':2.0,
        'usable_braking_mps2':3.0})
    assert result['status']=='model_not_calibrated'
    assert result['optimal_coordinates'] is None
