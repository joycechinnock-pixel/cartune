mods={}
for rel in ["tune/rules.js","tune/presets.js","tune/barraData.js","tune/tables.js","ecu/ecuProfiles.js"]:
    mods["./"+rel[:-3]]=open('/tmp/tsx/web/'+rel).read()
bundle="var __m={};var __c={};function requireMod(n){if(__c[n])return __c[n].exports;var m={exports:{}};__c[n]=m;__m[n](m,m.exports,function(r){if(r.startsWith('./')&&n.indexOf('/tune/')>=0)r='./tune/'+r.slice(2);return requireMod(r)});return m.exports}\n"
for k,v in mods.items():
    bundle+="__m[%r]=function(module,exports,require){%s\n};\n"%(k,v)
html=open('/tmp/tsx/app.html').read().replace('/*BUNDLE*/',bundle)
open('/mnt/user-data/outputs/CarTune-App-Preview.html','w').write(html)
