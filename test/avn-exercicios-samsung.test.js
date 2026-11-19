'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const parse=require('../src/routes/avn/avn-exercicios-samsung-mobile.routes')._parseWorkout;

const good=()=>({
 external_id:'samsung-watch-session-1:0',
 inicio:'2026-11-19T08:00:00.000Z',
 fim:'2026-11-19T09:00:00.000Z',
 calorias_kcal:350.5,
 tipo_atividade:'STRENGTH_TRAINING'
});
test('Samsung exercise calories are saved as one workout session',()=>{
 const w=parse(good());
 assert.equal(w.kcal,350.5);
 assert.equal(w.id,'samsung-watch-session-1:0');
 assert.equal(w.kind,'STRENGTH_TRAINING');
});
test('Reject daily active-calorie totals and malformed sessions',()=>{
 assert.throws(()=>parse({...good(),calorias_kcal:undefined}));
 assert.throws(()=>parse({...good(),calorias_kcal:-1}));
 assert.throws(()=>parse({...good(),calorias_kcal:'350'}));
 assert.throws(()=>parse({...good(),inicio:'2026-11-19T10:00:00.000Z'}));
 assert.throws(()=>parse({...good(),external_id:''}));
});
