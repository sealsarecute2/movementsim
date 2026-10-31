import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

const root=new URL('../',import.meta.url);

test('the bundled public entry keeps every lazy module import and its relative assets reachable',()=>{
  const html=readFileSync(new URL('index.html',root),'utf8');
  const imports=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const sources=[{url:new URL('index.html',root),source:html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]}];
  const visited=new Set();
  const file=(specifier,parent)=>{
    const url=new URL(specifier,parent);
    assert.ok(url.href.startsWith(root.href),'Asset must stay inside the published game: '+url.href);
    assert.ok(statSync(url).isFile(),'Missing published asset: '+url.href);
    return url;
  };
  while(sources.length){
    const {url,source}=sources.pop();
    const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    for(const [,specifier] of code.matchAll(/(?:^\s*(?:import|export)\s+[\w$*,{}\s]+?\s+from\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/gm)){
      let module;
      if(specifier.startsWith('.'))module=file(specifier,url);
      else{
        const key=Object.keys(imports).sort((a,b)=>b.length-a.length).find(key=>key===specifier||key.endsWith('/')&&specifier.startsWith(key));
        assert.ok(key,'Missing import-map entry: '+specifier);
        module=file(imports[key]+specifier.slice(key.length),root);
      }
      if(visited.has(module.href))continue;
      visited.add(module.href);sources.push({url:module,source:readFileSync(module,'utf8')});
    }
    for(const [,asset] of code.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g))file(asset,url);
  }
  assert.ok([...visited].some(url=>url.endsWith('/butterfly/butterfly-viewmodel.js')));
  assert.ok([...visited].some(url=>url.endsWith('/vendor/fflate.module.js')));
});
