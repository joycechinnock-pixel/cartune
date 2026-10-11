T = {}
T["knock_gain_c1"] = dict(id=44714, name="Knock Gain Cyl 1", rows_name="Load", cols_name="RPM (rpm)",
  cols=[500,1000,1500,2000,2500,3000,3500,4000,4500,5000,5500,6000,6000,6000],
  rows=[0.15,0.30,0.50,0.60,0.70,0.80,0.90,1.00,1.10,1.20,1.30,1.40,1.50,1.60],
  data=[[5,5,10,5,0,11,3,7,15,20,30,24,24,24],
        [22,22,14,8,0,11,3,4,7,18,32,27,27,27],
        [24,24,18,11,4,12,7,8,7,15,32,30,30,30],
        [24,24,30,14,10,16,12,12,7,15,32,30,30,30],
        [24,24,30,21,19,16,17,14,13,15,31,25,25,25],
        [23,23,32,30,20,24,20,17,13,15,27,25,25,25],
        [23,23,32,33,24,24,20,21,13,15,29,28,28,28],
        [15,15,32,30,24,24,24,23,19,15,29,28,28,28],
        [15,15,27,30,26,26,24,23,19,15,28,28,28,28]]+[[15,15,25,31,26,26,24,24,19,17,28,28,28,28]]*5)
META = dict(hardware="Spanish Oak 1024K, ECM, Ford", vin="6FPAAAJGSW6S69955", os="HACCKG6", created="13/08/2025", vehicle="2006 Ford Australia")
KC=[500,1000,1500,2000,2500,3000,3500,4000,4500,5000,5500,6000,6000,6000]
KR=[0.15,0.30,0.50,0.60,0.70,0.80,0.90,1.00,1.10,1.20,1.30,1.40,1.50,1.60]
def K(i,name,d): T[name]=dict(id=i,name=name.replace("_"," "),rows_name="Load",cols_name="RPM (rpm)",cols=KC,rows=KR,data=d)
K(44715,"Knock Gain Cyl 2",[[10,10,18,7,2,12,8,16,17,22,30,18,18,18],[32,32,20,10,6,12,8,12,9,19,30,20,20,20],[32,32,24,13,10,16,13,16,12,19,30,26,26,26],[32,32,38,21,14,20,18,20,12,19,30,26,26,26],[26,26,36,29,22,25,20,24,20,19,31,26,26,26],[27,27,32,24,31,34,30,28,23,21,33,24,24,24],[27,27,32,28,31,34,39,34,25,23,33,28,28,28],[20,20,31,31,31,32,42,31,28,23,31,30,30,30],[20,20,26,31,33,34,42,32,28,25,31,30,30,30]]+[[20,20,26,31,33,34,40,38,32,28,30,30,30,30]]*5)
K(44716,"Knock Gain Cyl 3",[[16,16,8,6,2,5,3,12,20,22,31,23,23,23],[24,24,19,12,5,5,3,7,10,20,33,29,29,29],[24,24,30,22,5,8,7,7,10,20,33,29,29,29],[21,21,32,29,16,11,9,11,10,20,33,29,29,29],[21,21,32,29,24,13,15,15,13,20,34,26,26,26],[23,23,32,23,27,20,19,18,13,20,31,26,26,26],[23,23,28,23,30,20,21,20,20,20,31,28,28,28],[15,15,29,29,29,26,27,26,20,20,31,28,28,28],[15,15,26,29,27,26,27,30,20,20,31,28,28,28]]+[[15,15,26,28,27,26,27,32,25,24,31,28,28,28]]*5)
K(44717,"Knock Gain Cyl 4",[[14,14,8,8,0,8,3,10,10,16,30,25,25,25],[23,23,14,8,3,8,3,8,5,11,28,25,25,25],[18,18,28,13,6,10,7,8,5,11,28,25,25,25],[18,18,28,20,13,14,9,12,5,11,28,25,25,25],[18,18,28,15,20,18,14,16,12,11,26,25,25,25],[20,20,22,15,26,21,17,19,14,14,26,25,25,25],[20,20,28,19,26,21,19,21,17,14,27,28,28,28],[15,15,28,26,26,21,22,23,17,14,27,28,28,28],[15,15,28,26,21,24,22,25,17,14,24,28,28,28],[15,15,28,22,21,24,22,25,19,16,24,28,28,28]]+[[15,15,28,22,21,24,22,28,19,16,24,28,28,28]]*4)
K(44718,"Knock Gain Cyl 5",[[11,11,14,6,0,12,5,17,20,22,32,28,28,28],[28,28,16,9,3,12,5,12,13,17,31,28,28,28],[32,32,26,15,8,14,9,12,13,17,31,28,28,28],[32,32,34,21,13,18,15,16,13,17,31,28,28,28],[32,32,42,23,18,20,21,22,16,17,28,28,28,28],[17,30,38,23,25,27,24,25,19,20,28,28,28,28],[17,30,32,23,25,27,30,31,25,20,28,30,30,30],[18,18,28,31,30,25,36,34,27,20,30,30,30,30],[18,18,29,31,32,32,36,36,27,24,30,30,30,30]]+[[18,18,29,32,32,32,36,39,30,27,30,30,30,30]]*5)
SCALARS={"Knock Sensor":"Enable"}
K(44719,"Knock Gain Cyl 6",[[6,6,13,3,0,11,3,12,19,21,28,21,21,21],[28,28,17,6,3,11,3,10,12,16,30,25,25,25],[32,32,28,6,6,14,7,10,12,16,30,25,25,25],[30,30,30,20,12,17,12,14,12,16,30,25,25,25],[30,30,30,17,18,20,17,16,14,16,26,17,17,17],[17,23,30,17,24,22,22,20,17,19,26,17,17,17],[17,29,30,17,33,22,24,20,21,21,28,22,22,22],[17,23,28,22,26,26,31,28,23,21,28,22,22,22],[17,23,28,22,26,30,31,31,23,21,30,22,22,22]]+[[17,23,30,28,26,30,31,34,27,26,30,22,22,22]]*5)
T["Knock Gain Cyl 6"]["title_assumed"]=True  # title cut off in photo; sequence places it as cyl 6
KW_R=[0,1000,1500,2000,2500,3000,3500,4000,4500,5000,5500,6000,6500,8191,8191,8191]
def W(i,name,d): T[name]=dict(id=i,name=name,rows_name="RPM (rpm)",cols_name="Offset",rows=KW_R,cols=None,data=[[x] for x in d])
W(44734,"Knock Window Offset Cyl 1",[3,3,3,3,0,0,2,0,0,0,0,0,0,0,0,0])
W(44735,"Knock Window Offset Cyl 2",[4,4,4,2,0,0,0,5,5,5,5,5,5,5,5,5])
W(44736,"Knock Window Offset Cyl 3",[5,5,4,6,2,0,0,0,0,0,0,0,0,0,0,0])
W(44737,"Knock Window Offset Cyl 4",[3,3,5,3,2,2,0,6,0,0,0,0,0,0,0,0])
W(44738,"Knock Window Offset Cyl 5",[3,3,4,2,0,0,0,0,0,0,5,5,5,5,5,5])
W(44739,"Knock Window Offset Cyl 6",[4,4,4,2,2,0,0,0,0,3,0,0,0,0,0,0])
T["Knock Window Offset Cyl 6"]["note"]="Last row cut off in photo; assumed 0 like the rows above it."
T["Knock Window Offset Load Adder"]=dict(id=44750,name="Knock Window Offset Load Adder",rows_name="Load",cols_name="Offset",cols=None,
  rows=[0.00,0.50,0.60,0.70,0.80,0.90,1.00,1.10,1.20,1.30,1.40,1.50,1.60,2.00],data=[[x] for x in [0,0,0,2,6,8,10,11,13,14,14,14,14,14]])
SCALARS.update({"Stoich AFR":14.64,"Injector Flow Rate Low (lb/h)":49.00253,"Injector Flow Rate High (lb/h)":33.54296,"Injector Breakpoint (lb)":0.0000094,"PW Minimum (ms)":0.35})
MENU={"top":["OS","Engine","Engine Diag","Trans","Trans Diag","Fuel Sys","System","Speedo"],
 "Engine":["General","Idle","Airflow","Exhaust","Fuel","Spark","Temperature"],
 "Engine/Fuel":["General","Oxygen Sensors","Open Loop / Base"],
 "Engine/Fuel/General tables":["Flow Rate Low Mult vs. Pressure","Flow Rate High Mult vs. Pressure","Engine Soak Time Enrich","Engine Run Time Enrich","Hot Enrich","Offset vs. Voltage","Offset Mult vs. Pressure","Injection Timing","Fuel Cranking vs. ECT","PIP Count"]}
DESC={"Knock Window Offset":"Knock detection window offset (beginning) from rising edge."}
T["Indicated Engine Torque"]=dict(id=44768,name="Indicated Engine Torque vs. RPM vs. Load",rows_name="Engine Load",cols_name="Engine Speed (rpm)",
 cols=[550,1000,2000,3000,4500,6000],rows=[0.1,0.3,0.4,0.6,1.0,1.6],
 data=[[1,22,21,18,23,7],[66,100,85,93,95,88],[115,160,150,160,156,160],[179,220,215,228,220,230],[274,281,336,343,352,345],[430,439,470,500,490,490]])
T["Predicted Load"]=dict(id=21318,name="Predicted Load vs. Engine Speed vs. Torque",rows_name="Torque (N.m)",cols_name="Engine Speed (rpm)",
 cols=[550,1000,2000,3000,4500,6000],rows=[0,70,140,210,280,350,525],
 data=[[0.05,0,0,0,0,0.03],[0.27,0.22,0.22,0.21,0.19,0.21],[0.53,0.46,0.44,0.43,0.41,0.40],[0.76,0.72,0.67,0.66,0.62,0.62],[1.03,0.99,0.91,0.87,0.84,0.84],[1.29,1.27,1.14,1.08,1.07,1.07],[1.96,1.92,1.76,1.60,1.64,1.64]],
 desc="Inverse of the torque table: predicted load at MBT for current engine speed and torque.")
MENU["Engine (full)"]=["General","Idle","Airflow","Exhaust","Fuel","Spark","Torque Model","Torque Management"]
MENU["Engine/Torque Management"]=["General","Driver Demand","SC/TC Boost Control","Turbocharger"]
MENU["Engine/Torque Management/General tables"]=["Torque Reduction RPM","Clip Torque","Fuel Cut Torque Ratio","Spark Torque Ratio Limit","Torque Ratio vs. ECT","Torque Ratio vs. RPM"]
SCALARS.update({"Torque Module Switch":"Enabled","Traction Control System Disable":40,
 "Oil Overtemp Disable ECT (°C)":115.56,"Oil Overtemp Enable ECT (°C)":121.11,"Oil Overtemp B Disable ECT (°C)":115.56,"Oil Overtemp B Enable ECT (°C)":121.11,
 "Oil Overtemp Enable Load":0.80,"Oil Overtemp Enable RPM":7000,"Oil Overtemp Enable TPS (%)":78.20,"Oil Overtemp Red Enable OilTemp (°C)":137.78,"Oil Overtemp Red Disable OilTemp (°C)":137.67})
META["file"]="NISSAN PATROL BARRA HPTUNERS.hpt"
SCALARS.update({"Shift Torque Limit Max Torque 1-2":-120,"Shift Torque Limit Max Torque 2-3":-120,"Shift Torque Limit Max Torque 3-4":-120})
T["Engine Friction Torque"]=dict(id=33310,name="Engine Friction Torque vs. RPM vs. ECT",unit="Nm",rows_name="ECT (as shown)",cols_name="RPM",
 cols=[0,1500,3000,4500,6000,7500],rows=[0.0,0.3,0.6,0.9,1.2,1.5],
 data=[[25,31,35,41,55,71],[25,27,30,40,55,75],[22,23,26,37,57,77],[17,19,22,34,59,77],[9,9,20,30,62,79],[0,0,16,24,72,83]],desc="Amount of engine torque lost to friction.")
MENU["Engine/Torque Model"]=["General","Monitoring"]
SCALARS.update({"CHT Sensor":"Enabled","Cylinders":6,"Engine Displacement (kg air/cyl-fill, as shown)":0.00078})
T["Indicated Engine Torque"]["unit"]="Nm"; T["Indicated Engine Torque"]["desc"]="Torque (excluding friction and accessory losses) the engine makes for a given RPM and load."
SCALARS.update({"Idle Enable RPM Error (rpm)":200,"Idle Disable RPM Error (rpm)":30,"Idle Minimum VSS (km/h)":8,"In Gear to P/N Delay (s)":0.30,"Max Idle (rpm)":800,
 "MAP Sensor":"Enabled","TMAP Slope Turbo (inHg)":15.9830,"TMAP Offset Turbo (inHg)":0.4864,"TMAP Slope NA (inHg)":7.2956,"TMAP Offset NA (inHg)":0.0347,
 "Boost Sensor Slope (inHg)":15.9830,"Boost Sensor Offset (inHg)":0.4864,"Baro Learning Min (inHg)":23.00,"Baro Learning Max (inHg)":31.00,
 "MAF Adaption":"Disabled","Default Baro (inHg)":29.89,"Cylair Anticipation":"Disabled","Cylair Max Multiplier":0.90})
MENU["Engine/Idle"]=["General","RPM"]; MENU["Engine/Idle/General tables"]=["P/N to In Gear Delay","P/N to Reverse Delay"]
MENU["Engine/Airflow"]=["General","Speed Density","Electronic Throttle","Charge Motion Device","IMRC","Variable (cam)"]
MENU["Engine/Airflow/General tables"]=["MAF Failure Load","MAF Failure Load (IMRC Open)"]
SCALARS.update({"Injection Spray Delay (s)":0.00,"Reference Angle Intake Valve Open (°)":332.50})
MENU["Engine/Fuel"]=["General","Oxygen Sensors","Open Loop / Base","Temperature Control","Cutoff, DFCO"]
MENU["Engine/Fuel/General tables"]+= ["Timing vs. ECT"]
DESC["Exhaust Temp Mode vs. Airflow (44556)"]="Mode # used to look up other tables in the exhaust component temperature calculations."
DESC["Injector Hot Enrich vs. IAT vs. Rail Temp (32080)"]="Compensates for hot fuel components during restart based on IAT and calculated fuel rail temperature."
T["Fuel Cranking vs ECT"]=dict(id=44519,name="Fuel Cranking vs. ECT",unit="λ",rows_name="Engine Coolant Temp (°C)",cols_name="Lambda",cols=None,
 rows=[-40.0,-28.9,-23.3,-17.8,-6.7,-1.1,4.4,10.0,26.7,48.9,65.6,82.2],data=[[x] for x in [0.700,0.740,0.760,0.770,0.790,0.820,0.860,0.900,0.960,0.980,0.980,0.980]],
 desc="Commanded lambda while the engine is cranking.")
T["Cranking Fuel With PIP Count"]=dict(id=35041,name="Cranking Fuel With PIP Count",rows_name="Engine Coolant Temp (axis as displayed)",cols_name="PIP Count",
 cols=[0,4,12,18,30,36,64,72],rows=[-30,-30,180,180,180,180,180,180],note="Row axis displayed as shown in the photo (-30,-30,180…); confirm in your file.",
 data=[[2.7,1.8,1.25,1.1,1.35,0.8,0.8,0.8],[2.5,2.0,1.45,1.0,1.125,0.8,0.8,0.8],[2.2,1.8,1.3,0.9,1.0,0.8,0.8,0.8],[1.8,1.4,1.0,0.85,0.875,0.8,0.8,0.8],[1.5,1.25,0.9,0.8,0.8,0.8,0.8,0.8],[1.3,0.96,0.8,0.8,0.8,0.8,0.8,0.8],[1.2,0.91,0.8,0.8,0.75,0.75,0.75,0.75],[1.2,1.1,0.8,0.8,0.7,0.7,0.7,0.7]])
SCALARS.update({"Exhaust Manifold Range Temp Control":"Disabled","Exhaust Manifold Range OT Enable (°C)":899,"Catalyst COT":"Enabled","COT Stage 2 Temp (°C)":874,
 "O2 Sens Temp Control":"Disabled","O2 Sens OT Enable (°C)":927,"OL/CL Hot Start ECT (°C)":37.78,"OL/CL Cold Start ECT (°C)":37.78,
 "OL Delay Ramp":0.05,"OL Delay Blend Ramp":0.03,"OL Delay Maximum (s)":20.00,"Fuel Adaptive WOT":"Disabled","Base Fuel Enable Time (s)":35.00,
 "Cold/Warmup Enable ECT (°C)":48.89,"Cold/Warmup Disable ECT (°C)":41.11})
MENU["Engine/Fuel/Open Loop tables"]=["Open Loop Delay","OL Decel Load","OL Fuel TPS Thresh","Fuel Base","Cold Enleanment","Fuel Base Cold","Cold Enrich Decay"]
DESC["Cranking Fuel With PIP Count"]="Crank mode fuel/air ratio multiplier used to taper crank fuel command during start."
SCALARS.update({"O2 Sensors Fitted":1,"Downstream Rear Config":"Single","CL O2 Sensor Temp (°C)":287.78,"LTFT":"Enabled","LTFT Max Learn Limit":0.80,"LTFT Min Learn Limit":0.25,
 "LTFT Learning Min IAT (°C)":-17.78,"LTFT Learning Max IAT (°C)":65.56,"LTFT Learning Min Load":0.1000,"LTFT Learning Max TPS (%)":68,"O2 Bias Min":-0.030,
 "Transport Delay Load Min":0.00,"Transport Delay Load Max":0.00,"Transport Delay RPM Min":254.00,"Transport Delay RPM Max":500.00,"Transport Delay Sec Min (s)":0.10,
 "Transport Delay Sec Max (s)":5.00,"Transport Delay Time Min (s)":0.00,"Transport Delay Time Max (s)":0.00,"Transport Delay ECT Min (°C)":-16.67})
MENU["Engine/Fuel/Oxygen Sensors tables"]=["Delay","LTFT Bank vs. Cylinder #","Bias A","Bank 1","Bank 2","Transport Delay"]
SCALARS.update({"Rev Limit Cutoff (rpm)":6350,"Neutral Cutoff (rpm)":6350,"Neutral Profile Max (rpm)":3000,"Temperature Based Cutoff Overtemp Max (rpm)":7000,
 "Launch Cutoff (rpm)":3000,"ETC Base Cutoff (rpm)":6000,"Neutral Exit Speed (km/h)":204,
 "DFCO Enable RPM":1000,"DFCO Disable RPM":800,"DFCO Enable VSS (km/h)":56.33,"DFCO Disable VSS (km/h)":53.11,"DFCO Disable Load":0.15,"DFCO Disable N/V":250.00,
 "DFCO Ramp On Rate":0.50,"DFCO Ramp Off Rate":1.00,"DFCO Closed Throttle Delay (s)":0.50,"DFCO CT Delay Extended (s)":30.00})
MENU["Engine/Fuel/Cutoff tables"]=["Neutral","Drive","Output Shaft"]
SCALARS.update({"Manifold Volume (L)":7.25,"ETC":"Fitted","Throttle Angle Max (°)":83.0,"Throttle Angle Min (°)":0.30,"ETC Proportional Gain":0.1000,"ETC Integral Gain":0.0,"ETC Derivative Gain":0.0,
 "APP Sensor 1 Mult":1.00,"Pedal WOT Enable":580.00,"Pedal WOT Disable":9.00,"Pedal Part Throttle Enable":50.00,"Pedal Part Throttle Disable":35.00})
MENU["Engine/Airflow"]=["General","Speed Density","Electronic Throttle","Charge Motion Device","IMRC","Variable Camshaft","Pressure Control"]
MENU["Engine/Airflow/Speed Density tables"]=["Correction (Temp) vs. ACT","Correction (Density) vs. ACT","Correction vs. ACT vs. ECT","Airmass TPS Failed","MAP at Zero Airmass (Closed)","MAP at Zero Airmass (Open)","MAP at Zero Airmass (High Res)","MAP at Zero Airmass Mult","MAP per Airmass (Closed)","MAP per Airmass (Open)","MAP per Airmass (High Res)","Tuning Correction"]
MENU["Engine/Airflow/Electronic Throttle tables"]=["Throttle Body Airflow","Predicted Throttle Angle","ETC Position (startup/cranking)","Throttle Angle vs. Pedal","Pedal Angle vs. Pedal"]
SCALARS.update({"IMCC Switch":"Disabled","IMCC Min ACT (°C)":-40,"IMCC Min ECT (°C)":-40,"IMCC Open Min RPM":500,"IMCC Open Max RPM":3800,"IMCC Open Time (s)":1,
 "IMCC Closed Hi RPM":3900,"IMCC Closed Lo RPM":400,"IMRC Switch":"Disabled","IMRC Position Sensor":"Disabled"})
MENU["Engine/Airflow"].append("Turbocharger")
SCALARS.update({"Variable Camshaft":"Enabled","VCT Enable Max RPM":6250,"VCT Low Speed Slope":0.00150,"VCT High Speed Slope":0.00090,"VCT Low Speed Offset":-1.19100,
 "VCT High Speed Offset":-0.14600,"VCT High/Low Breakpoint (rpm)":1742.00,"Underboost Threshold (inHg)":4.50,"Underboost Duty Cycle":1.0000})
MENU["Engine/Airflow/Variable Camshaft tables"]=["Startup Delay","Angle","Angle Mult vs. IAT","Angle Mult vs. ECT","Angle Max Retard Limit","Angle Max Retard Limit - Oil Temp","Max Allowed Overlap"]
MENU["Engine/Airflow/Pressure Control tables"]=["Desired Boost"]
SCALARS.update({"Turbo Logic":"Enable","Boost Sensor":"Fitted","Turbo Test Thresh":1.0,"Turbo Test Boost (inHg)":0.0,"Turbo Test DC":0.0,
 "Turbo Temp Control":"Enabled","Turbo Enable Temp (°C)":943,"Turbo Disable Temp (°C)":921,"FMEM TQ Reduction (%)":50.00,
 "Wastegate":"Fitted","Wastegate PWM Period (µs)":31250.0,"Wastegate Max DC":1.0000,
 "PATS Switch":"Disabled","PATS Alternate":"Enabled","Power Steering Pressure Switch":"Disabled","Power Steering Pressure Transducer":"Enabled",
 "IAT Delta - Update (°C)":-15.56,"IAT Delta (°C)":-6.67,"IAT Update - ECT Min (°C)":-17.78,"IAT Update - VSS Min (km/h)":97,"IAT Inferred Time Const (s)":300})
MENU["Engine/Airflow/Turbocharger tables"]=["Wastegate ECT Mult","Wastegate Baro Mult","Wastegate TPS Mult","Wastegate Feedforward Base"]
MENU["System"]=["General","Braking","Fans"]
SCALARS.update({"Fan Low Speed Enable ECT (°C)":100.0,"Fan Low Speed Disable ECT (°C)":96.1,"Fan Low Speed Enable VSS (km/h)":0.0,"Fan Low Speed Disable VSS (km/h)":152.9,
 "Fan High Speed Enable ECT (°C)":106.7,"Fan High Speed Disable ECT (°C)":102.2,"Fan High Speed High Load Enable RPM":500,"Fan High Speed High Load Enable Load":0.80,
 "Fan High Speed High Load Enable VSS (km/h)":160.9,"Fan High Speed High Load Enable ECT (°C)":106.7,"A/C Pressure Switch":"Disabled","A/C WOT Disable Time (s)":12.0})
MENU["System"]=["General","Braking","Fans","A/C"]
SCALARS.update({"Trans Automatic":"Disabled","Trans 4WD Low":"Disabled","Trans Load Switch":2,"Trans Infer Neutral":"Enabled","Trans Force Neutral":"Disabled",
 "Trans Min RPM":0,"Trans Max RPM":8000,"Trans WOT Threshold (%)":100,"Trans Inferred Movement (rpm)":2800,"Downshift Inhibit Min RPM":2200,"Downshift Inhibit Max RPM":5500,"Chain Gear Ratio":1.00})
MENU["Trans"]=["General","Manual","Shift Scheduling","Shift Pressures","Shift Properties","Torque Converter"]
MENU["Trans/Shift Properties/Ramp tables"]=["Force Motor Current/Ramp (per shift: 1->2 a/b/low … 3L->1 a/b)","Force Motor SSS Current/Ramp (per shift: 1->2 a … 4L->3 b, DS Unlock a/b)"]
SCALARS.update({"Manual 1st Gear Ratio":1.94,"Manual 2nd Gear Ratio":1.34,"Manual 3rd Gear Ratio":1.00,"Manual 4th Gear Ratio":0.73,"Manual 5th Gear Ratio":0.63,"Manual Reverse Ratio":2.76,
 "Shift Limit 1st Max (rpm)":9999,"Shift Limit 2nd Max (rpm)":9999,"Shift Limit 3rd Max (rpm)":9999,"Shift Limit 2nd Min (rpm)":390,"Shift Limit 3rd Min (rpm)":650,"Shift Limit 4th Min (rpm)":780,
 "Shift Limit 2-1 Max (rpm)":290,"Shift Limit 3-2 Max (rpm)":500,"Shift Limit 4-3 Max (rpm)":700,"1st Torque SSS (Nm)":47,"1st Max SSS (rpm)":310,"3rd Max SSS (rpm)":1650,"4th Max SSS (rpm)":2600})
MENU["Trans/Shift Scheduling tables"]=["Shift Schedule: Economy","Shift Schedule: Perf","Shift Schedule: Tow","Shift Schedule: Cruise","Shift Schedule: Tow/Cruise"]
SCALARS.update({"Trans Torque Limit Max Engine (Nm)":1383,"Stall Limit Forward (Nm)":800,"Stall Limit Reverse (Nm)":597})
MENU["Trans/Torque Management"]=["General","Upshift"]; MENU["Trans/Torque Management/General tables"]=["Max Torque","Skip Torque","TCM Limit - FMEM"]
SCALARS.update({"Upshift Torque Reduction Hold Time (ms)":80,"Upshift Torque Reduction Ramp Out Time (ms)":0,"Upshift Torque Reduction Max Time 1-2 (ms)":990,
 "Upshift Torque Reduction Max Time 2-3 (ms)":670,"Upshift Torque Reduction Max Time 3-4 (ms)":800})
MENU["Trans/Torque Management/Upshift tables"]=["Torque Reduction 1-2 Lo","1-2 Hi","2-3 Lo","2-3 Hi","ESS Lo","ESS Hi","Def Lo","Def Hi"]
