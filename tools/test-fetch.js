'use strict';
// Регрессия: после смешанной порции родные POST /tracks должны сохранить поток FormData.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const calls = [];
const window = {
  __ot: {},
  overtone: { api: async (request) => {
    if (request.response) return {body:request.response,status:200};
    if (request.body.includes('7001234567890')) return {nativeIds:['123456']};
    return null;
  } },
  fetch: async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    const form = await request.formData();
    calls.push(form.getAll('trackIds'));
    return Response.json([{id:'123456'}]);
  },
};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../page/05-api.js'),'utf8'), {
  window,location:{href:'https://desktop.test/'},Request,Response,Headers,FormData,URL,URLSearchParams,
});
(async()=>{
  for (const ids of [['7001234567890:7001234567890','123456:777777'],['123456:777777'],['234567:888888']]) {
    const form = new FormData();
    ids.forEach(id=>form.append('trackIds',id));
    const request = new Request('https://api.music.yandex.net/tracks',{method:'POST',body:form});
    const response = await window.fetch(request);
    assert.equal(response.status,200);
    await response.json();
  }
  assert.deepEqual(calls,[['123456:777777'],['123456:777777'],['234567:888888']]);
  console.log('Подгрузка: смешанная порция и две следующие родные порции сохраняют FormData');
})().catch(error=>{console.error(error);process.exitCode=1});
