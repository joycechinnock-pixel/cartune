/* ==========================================================================
 * Vehicle catalogue for the picker (Type → Make → Model → Generation → Engine
 * → Transmission). The detailed rows (CATALOG, engines mapped to ECU
 * families) are copied from prototype/app.template.html; the full make/model
 * list (MAKE_MODELS, POPULAR) is prototype/makes.js, inlined by web/build.js
 * so there is one copy of it. Models without detailed engine data still work:
 * you pick the fuel type and the receiver confirms the exact ECU when plugged
 * in. EV = electric (live data only, can't be tuned).
 * ======================================================================== */
var CATS=[
  {id:"car",name:"Car, ute and 4WD",sub:"Passenger, 4WD, vans and light commercial"},
  {id:"truck",name:"Truck and prime mover",sub:"Rigid, prime mover, light truck",biz:true},
  {id:"ag",name:"Tractor and ag",sub:"Tractors, sprayers, harvest",biz:true},
  {id:"plant",name:"Earthmoving and plant",sub:"Excavators, dozers, backhoes",biz:true}
];
function en(n,code,kw,nm,eng,ecu,trans,note){return{n:n,code:code,kw:kw,nm:nm,eng:eng,ecu:ecu,trans:trans||[],note:note}}
var NA="na_petrol",TP="turbo_petrol",TD="turbo_diesel";
var AUTO6="6-speed auto",MAN6="6-speed manual";
var CATALOG=[
 {cat:"car",make:"Ford",model:"Falcon",gens:[
  {g:"FG X",y:"2014–2016",e:[en("4.0 Barra 270T turbo","Barra 270T",270,533,TP,"ford-spanish-oak",[AUTO6,MAN6]),en("4.0 Barra","Barra 195",195,391,NA,"ford-spanish-oak",[AUTO6,MAN6]),en("5.0 supercharged V8","Miami V8",335,570,TP,"ford-spanish-oak",[AUTO6,MAN6])]},
  {g:"FG",y:"2008–2014",e:[en("4.0 Barra 270T turbo","Barra 270T",270,533,TP,"ford-spanish-oak",[AUTO6,MAN6]),en("4.0 Barra","Barra 195",195,391,NA,"ford-spanish-oak",[AUTO6,MAN6])]}]},
 {cat:"car",make:"Ford",model:"Territory",gens:[{g:"SZ",y:"2011–2016",e:[en("4.0 Barra","Barra 195",195,391,NA,"ford-spanish-oak",[AUTO6]),en("2.7 V6 diesel","2.7 TDCi",140,440,TD,"continental-sim-sid",[AUTO6])]}]},
 {cat:"car",make:"Holden",model:"Commodore",gens:[
  {g:"VF",y:"2013–2017",e:[en("6.2 V8 LS3","LS3",304,570,NA,"gm-e38-e67",[AUTO6,MAN6]),en("3.6 V6","LFX",210,350,NA,"gm-e39-e77",[AUTO6])]},
  {g:"VE",y:"2006–2013",e:[en("6.0 V8","L98 / L76 / L77",270,530,NA,"gm-e38-e67",[AUTO6,MAN6]),en("3.6 V6","Alloytec / SIDI",210,350,NA,"gm-e39-e77",[AUTO6,MAN6])]}]},
 {cat:"car",make:"Subaru",model:"WRX",gens:[{g:"VA",y:"2014–2021",e:[en("2.0 turbo","FA20DIT",197,350,TP,"denso-subaru-mazda",[MAN6,"CVT"])]}]},
 {cat:"car",make:"Toyota",model:"HiLux",gens:[
  {g:"GUN126 facelift",y:"2020–on",e:[en("2.8 turbo diesel","1GD-FTV",150,500,TD,"denso-toyota",[AUTO6,MAN6])]},
  {g:"GUN126",y:"2015–2020",e:[en("2.8 turbo diesel","1GD-FTV",130,450,TD,"denso-toyota",[AUTO6,MAN6]),en("2.4 turbo diesel","2GD-FTV",110,400,TD,"denso-toyota",[AUTO6,MAN6])]}]},
 {cat:"car",make:"Toyota",model:"LandCruiser 70",gens:[{g:"VDJ79",y:"2016–2023",e:[en("4.5 V8 turbo diesel","1VD-FTV",151,430,TD,"denso-toyota",["5-speed manual"])]}]},
 {cat:"car",make:"Toyota",model:"LandCruiser 300",gens:[{g:"FJA300",y:"2021–on",e:[en("3.3 V6 twin-turbo diesel","F33A-FTV",227,700,TD,"denso-toyota",["10-speed auto"])]}]},
 {cat:"car",make:"Toyota",model:"Prado",gens:[{g:"150 series",y:"2020–2024",e:[en("2.8 turbo diesel","1GD-FTV",150,500,TD,"denso-toyota",[AUTO6])]}]},
 {cat:"car",make:"Ford",model:"Ranger",gens:[
  {g:"Next-gen",y:"2022–on",e:[en("3.0 V6 turbo diesel","3.0 V6",184,600,TD,"bosch-edc17",["10-speed auto"])]},
  {g:"PX2 / PX3",y:"2015–2022",e:[en("3.2 turbo diesel","P5AT",147,470,TD,"bosch-edc17",[AUTO6,"10-speed auto",MAN6]),en("2.0 bi-turbo diesel","2.0 Bi-Turbo",157,500,TD,"continental-sim-sid",["10-speed auto"])]}]},
 {cat:"car",make:"Mazda",model:"BT-50",gens:[{g:"TF",y:"2020–on",e:[en("3.0 turbo diesel","4JJ3-TCX",140,450,TD,"transtron-isuzu",[AUTO6,MAN6])]},{g:"UR",y:"2015–2020",e:[en("3.2 turbo diesel","P5AT",147,470,TD,"bosch-edc17",[AUTO6,MAN6])]}]},
 {cat:"car",make:"Nissan",model:"Navara",gens:[{g:"NP300",y:"2015–on",e:[en("2.3 twin-turbo diesel","YS23DDTT",140,450,TD,"bosch-edc17",["7-speed auto",MAN6])]}]},
 {cat:"car",make:"Nissan",model:"Patrol",gens:[{g:"Y62",y:"2013–on",e:[en("5.6 V8 petrol","VK56VD",298,560,NA,"hitachi-nissan",["7-speed auto"])]}]},
 {cat:"car",make:"Mitsubishi",model:"Triton",gens:[{g:"MQ / MR",y:"2015–2023",e:[en("2.4 turbo diesel","4N15",133,430,TD,"mitsubishi-mut",[AUTO6,MAN6])]}]},
 {cat:"car",make:"Mitsubishi",model:"Pajero Sport",gens:[{g:"QE / QF",y:"2015–on",e:[en("2.4 turbo diesel","4N15",133,430,TD,"mitsubishi-mut",["8-speed auto"])]}]},
 {cat:"car",make:"Isuzu Ute",model:"D-Max",gens:[{g:"RG",y:"2020–on",e:[en("3.0 turbo diesel","4JJ3-TCX",140,450,TD,"transtron-isuzu",[AUTO6,MAN6])]}]},
 {cat:"truck",make:"Kenworth",model:"T610",gens:[{g:"T610 / T610SAR",y:"2017–on",e:[en("Cummins X15","X15",null,null,TD,"cummins-cm2350",["18-speed Eaton manual","Automated manual"]),en("PACCAR MX-13","MX-13",null,null,TD,"paccar-mx",["Automated manual"])]}]},
 {cat:"truck",make:"Kenworth",model:"T410",gens:[{g:"T410 / T410SAR",y:"2014–on",e:[en("PACCAR MX-13","MX-13",null,null,TD,"paccar-mx",["Automated manual","Manual"])]}]},
 {cat:"truck",make:"Volvo Trucks",model:"FH",gens:[{g:"FH (4th gen)",y:"2013–2021",e:[en("Volvo D13","D13",null,null,TD,"volvo-group",["I-Shift"])]}]},
 {cat:"truck",make:"Mack",model:"Anthem",gens:[{g:"Anthem",y:"2021–on",e:[en("Mack MP8","MP8 13L",null,null,TD,"volvo-group",["mDRIVE","Manual"])]}]},
 {cat:"truck",make:"Freightliner",model:"Cascadia",gens:[{g:"Cascadia",y:"2020–on",e:[en("Detroit DD13","DD13",null,null,TD,"detroit-dd",["DT12"]),en("Detroit DD15","DD15",null,null,TD,"detroit-dd",["DT12"]),en("Detroit DD16","DD16",null,null,TD,"detroit-dd",["DT12"])]}]},
 {cat:"truck",make:"Isuzu Trucks",model:"N Series",gens:[{g:"NLR / NNR / NPR / NQR",y:"2008–on",e:[en("Isuzu 4-cylinder diesel","4JJ1 / 4HK1",null,null,TD,"japan-trucks",["Automated manual","Allison auto","Manual"])]}]},
 {cat:"truck",make:"Hino",model:"500 Series",gens:[{g:"500 Series",y:"2017–on",e:[en("Hino J08E","J08E",null,null,TD,"japan-trucks",["Allison auto","Manual"])]}]},
 {cat:"truck",make:"Scania",model:"R / S series",gens:[{g:"New Truck Generation",y:"2017–on",e:[en("Scania 13L","DC13",null,null,TD,"euro-trucks",["Opticruise"])]}]},
 {cat:"ag",make:"John Deere",model:"8R",gens:[{g:"8R series",y:"2020–on",e:[en("PowerTech 9.0L","PSS 9.0L",null,null,TD,"deere",["e23","IVT"])]}]},
 {cat:"ag",make:"John Deere",model:"6R",gens:[{g:"6R series",y:"2021–on",e:[en("PowerTech 6.8L","PVS 6.8L",null,null,TD,"deere",["AutoQuad","AutoPowr IVT"])]}]},
 {cat:"ag",make:"Case IH",model:"Magnum",gens:[{g:"Magnum",y:"2018–on",e:[en("FPT Cursor 9","Cursor 9",null,null,TD,"cnh",["Powershift","CVT"])]}]},
 {cat:"ag",make:"Case IH",model:"Puma",gens:[{g:"Puma",y:"2018–on",e:[en("FPT NEF 6.7L","NEF 6.7",null,null,TD,"cnh",["Powershift","CVX"])]}]},
 {cat:"ag",make:"New Holland",model:"T7",gens:[{g:"T7",y:"2019–on",e:[en("FPT NEF 6.7L","NEF 6.7",null,null,TD,"cnh",["Dynamic Command","Auto Command"])]}]},
 {cat:"ag",make:"Kubota",model:"M7",gens:[{g:"M7",y:"2015–on",e:[en("Kubota 6.1L","V6108",null,null,TD,"kubota",["Powershift","KVT"])]}]},
 {cat:"plant",make:"Caterpillar",model:"320 excavator",gens:[{g:"Next Gen 320",y:"2018–on",e:[en("Cat C7.1","C7.1",null,null,TD,"cat-adem",["Hydrostatic"])]}]},
 {cat:"plant",make:"Caterpillar",model:"D6 dozer",gens:[{g:"D6 (XE)",y:"2019–on",e:[en("Cat C9.3B","C9.3B",null,null,TD,"cat-adem",["Electric drive","Powershift"])]}]},
 {cat:"plant",make:"Komatsu",model:"PC210",gens:[{g:"PC210-10M0",y:"2016–on",e:[en("Komatsu 6-cylinder diesel","SAA6D107E",null,null,TD,"komatsu",["Hydrostatic"])]}]},
 {cat:"plant",make:"JCB",model:"3CX backhoe",gens:[{g:"3CX",y:"2016–on",e:[en("JCB DieselMax 448","448",null,null,TD,"jcb",["Powershift","Manual shuttle"])]}]},
 {cat:"plant",make:"Kubota",model:"KX080 excavator",gens:[{g:"KX080-4",y:"2015–on",e:[en("Kubota 3.3L","V3307",null,null,TD,"kubota",["Hydrostatic"])]}]}
];
var MAKE_ECU={"Mack":"volvo-group","Volvo Trucks":"volvo-group","UD Trucks":"volvo-group","Isuzu Trucks":"japan-trucks","Hino":"japan-trucks","Fuso":"japan-trucks","DAF":"paccar-mx","Scania":"euro-trucks","MAN":"euro-trucks","Iveco":"euro-trucks","Mercedes-Benz Trucks":"euro-trucks","Freightliner":"detroit-dd","John Deere":"deere","Case IH":"cnh","New Holland":"cnh","Case CE":"cnh","Kubota":"kubota","Caterpillar":"cat-adem","Komatsu":"komatsu","JCB":"jcb"};
var STATUS={detect:["Supported. The receiver confirms the exact ECU when you plug in","yellow"],ready:["Full tune ready","green"],"plugin-needed":["Read and preview now. Writing needs the unlock for this ECU (in development)","yellow"],"bench-only":["Bench flash only","yellow"],legacy:["Older protocol, separate cable","yellow"],"oem-only":["Read only for now: live data and fault codes","yellow"]};

/* Every model: the detailed rows plus an "Other years" generation, then every
   make/model from MAKE_MODELS not already covered (generic engines). */
var CAT_ALL=(function(){
  function generic(cat,ecu){return cat==="car"?[en("Petrol","Petrol",null,null,NA,ecu,[]),en("Turbo petrol","Turbo petrol",null,null,TP,ecu,[]),en("Diesel","Diesel",null,null,TD,ecu,[])]:[en("Diesel","Diesel",null,null,TD,ecu,[])]}
  var out=[],have={};
  CATALOG.forEach(function(r){have[r.cat+"|"+r.make+"|"+r.model]=1;out.push({cat:r.cat,make:r.make,model:r.model,gens:r.gens.concat([{g:"Other years",y:"Not listed above",other:true,e:generic(r.cat,MAKE_ECU[r.make]||"detect")}])})});
  Object.keys(MAKE_MODELS).forEach(function(cat){Object.keys(MAKE_MODELS[cat]).forEach(function(make){MAKE_MODELS[cat][make].forEach(function(mm){
    var parts=mm.split("|"),model=parts[0],ev=parts[1]==="EV";if(have[cat+"|"+make+"|"+model])return;have[cat+"|"+make+"|"+model]=1;
    var ecu=MAKE_ECU[make]||"detect",e;
    if(ev)e=[en("Electric","EV",null,null,null,null,[],"Electric: live data and diagnostics only")];
    else e=generic(cat,ecu);
    out.push({cat:cat,make:make,model:model,generic:true,gens:[{g:"All years",y:"",e:e}]})})})});
  return out})();
/* Picker type → the ECU-profile category a package must include (PACKAGES in ecuProfiles.ts). */
var CAT_PKG={car:"passenger",truck:"commercial",ag:"machinery",plant:"machinery"};
function catInPackage(cat){var p=E.PACKAGES.find(function(x){return x.id===S.pkg})||E.PACKAGES[0];return p.includes.indexOf(CAT_PKG[cat])>=0}
function pkgNeededFor(cat){return E.PACKAGES.find(function(x){return x.includes.indexOf(CAT_PKG[cat])>=0})}
/* ECU profile by id, with a placeholder when the catalogue says "confirmed when you plug in". */
function profOf(id){return E.ECU_PROFILES.find(function(p){return p.id===id})||{id:id||"detect",manufacturer:"ECU",family:"confirmed when the receiver is plugged in",status:"detect",usedBy:[]}}
