import math
from engine.turn_proposal import propose_turn_segments
class Col:
    def __init__(self,vals):self.vals=vals
    def __iter__(self):return iter(self.vals)
class Frame:
    def __init__(self,columns,index):self._columns=columns;self.columns=list(columns);self.index=index
    def __getitem__(self,k):return Col(self._columns[k])
t=list(range(400))
lat=[35.7+.0004*math.sin(i*2*math.pi/80) for i in t]
lon=[-77.9+.0008*math.cos(i*2*math.pi/80) for i in t]
rad=[20 if abs(math.cos(i*2*math.pi/80))>.65 else 500 for i in t]
df=Frame({"GPS Latitude":lat,"GPS Longitude":lon,"GPS Radius":rad},t)
track={"start_finish":[{"lat":35.7,"lng":-77.8995},{"lat":35.7001,"lng":-77.8995}],"turns":{"_rivali":{"race_arrow":[{"lat":35.7,"lng":-77.9},{"lat":35.7001,"lng":-77.9}]}}}
result=propose_turn_segments(df,track)
print(result)
assert result["status"]=="proposed_review_required"
assert len(result["corner_pairs"])==2
assert propose_turn_segments(df,{"turns":{}})["status"]=="unavailable"
print("PROPOSAL_TEST_PASS")
