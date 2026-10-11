import os,posixpath
mods={}
for rel in ["tune/rules.js","tune/presets.js","tune/filing.js","ecu/ecuProfiles.js","vehicle/detect.js"]:
    mods["./"+rel[:-3]]=open('/tmp/tsx/web/'+rel).read()
bundle="""var __m={},__c={};
function __res(from,r){if(r.charAt(0)!=='.')return r;var base=from.split('/');base.pop();r.split('/').forEach(function(p){if(p==='..')base.pop();else if(p!=='.')base.push(p)});var o=base.join('/');return o.charAt(0)==='.'?o:'./'+o}
function requireMod(n){if(__c[n])return __c[n].exports;var m={exports:{}};__c[n]=m;__m[n](m,m.exports,function(r){return requireMod(__res(n,r))});return m.exports}
"""
for k,v in mods.items():
    bundle+="__m[%r]=function(module,exports,require){%s\n};\n"%(k,v)
html=open('app.template.html').read().replace('/*BUNDLE*/',bundle).replace('/*MAKES*/',open('makes.js').read())
os.makedirs('/mnt/user-data/outputs',exist_ok=True)
open('/mnt/user-data/outputs/CarTune.html','w').write(html)
print(len(html))
