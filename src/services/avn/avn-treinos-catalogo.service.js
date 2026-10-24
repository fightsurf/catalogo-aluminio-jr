'use strict';
/*
 * Workout Guide, Bryl Lim / Everkinetic. 302 exercícios, 3 quadros por exercício.
 * Ilustrações CC BY-SA 4.0. Código deste adaptador é independente da biblioteca.
 * Fontes/licenças: https://github.com/bryllim/workout-guide
 * https://github.com/bryllim/workout-guide/blob/main/LICENSE-ASSETS
 * https://github.com/bryllim/workout-guide/blob/main/ATTRIBUTION.md
 */
const pool = require('../../../db/connection');
const ptBR = require('./avn-treinos-ptbr');
const CATALOG='https://cdn.jsdelivr.net/gh/bryllim/workout-guide@main/packages/workout-guide/';
const MANIFEST=CATALOG+'manifest.json';
const LICENSE='CC BY-SA 4.0';
const gid = {Chest:'peito',Back:'costas',Lats:'costas','Upper Back':'costas','Lower Back':'lombar',Shoulders:'ombros','Rear Delts':'ombros',Biceps:'biceps',Triceps:'triceps',Forearms:'antebracos',Quads:'quadriceps',Hamstrings:'posteriores','Posterior Chain':'posteriores',Glutes:'gluteos',Calves:'panturrilhas',Adductors:'adutores',Core:'abdomen',Legs:'cardio',Hips:'mobilidade',Mobility:'mobilidade'};
const extraGroups=[['antebracos','Antebraços',13],['adutores','Adutores',14],['mobilidade','Mobilidade e alongamento',15]];
const equip={Barbell:'Barra',Dumbbell:'Halteres',Machine:'Máquina',Cable:'Polia',Bodyweight:'Peso corporal',Cardio:'Cardiorrespiratório',Plate:'Anilha','Pull-up Bar':'Barra fixa',Bench:'Banco',Wall:'Parede',Chair:'Cadeira',Doorway:'Porta',Towel:'Toalha',Box:'Caixa/Step',Kettlebell:'Kettlebell','Resistance Band':'Faixa elástica','Stability Ball':'Bola suíça'};
// Exercícios já existentes no seed em português: atualiza as imagens sem duplicá-los.
const alias={
 'bench-press':'supino-reto-com-barra','dumbbell-bench-press':'supino-reto-com-halteres',
 'incline-bench-press':'supino-inclinado-com-barra','incline-dumbbell-press':'supino-inclinado-com-halteres',
 'dumbbell-fly':'crucifixo-com-halteres','cable-fly':'crossover-na-polia','pec-deck':'peck-deck','push-up':'flexao-de-bracos',
 'lat-pulldown':'puxada-alta-pronada','close-grip-lat-pulldown':'puxada-alta-supinada','seated-row':'remada-baixa',
 'barbell-row':'remada-curvada-com-barra','one-arm-dumbbell-row':'remada-unilateral-com-halter','machine-row':'remada-articulada',
 'pull-up':'barra-fixa-pronada','straight-arm-pulldown':'pulldown-com-bracos-estendidos',
 'seated-dumbbell-press':'desenvolvimento-com-halteres','overhead-press':'desenvolvimento-com-barra',
 'lateral-raise':'elevacao-lateral','front-raise':'elevacao-frontal','rear-delt-fly':'crucifixo-inverso',
 'face-pull':'face-pull','cable-lateral-raise':'elevacao-lateral-na-polia',
 'bicep-curl':'rosca-alternada','hammer-curl':'rosca-martelo','preacher-curl':'rosca-scott',
 'concentration-curl':'rosca-concentrada','cable-curl':'rosca-na-polia-baixa',
 'rope-tricep-pushdown':'triceps-na-polia-com-corda','tricep-pushdown':'triceps-na-polia-com-barra',
 'dumbbell-overhead-tricep-extension':'triceps-frances','skull-crusher':'triceps-testa','dip':'mergulho-nas-paralelas',
 'tricep-kickback':'triceps-coice','squat':'agachamento-livre','front-squat':'agachamento-frontal',
 'leg-press':'leg-press-45-graus','leg-extension':'cadeira-extensora','hack-squat':'agachamento-hack',
 'walking-lunge':'avanco-com-halteres','bulgarian-split-squat':'agachamento-bulgaro',
 'leg-curl':'mesa-flexora','seated-leg-curl':'cadeira-flexora','romanian-deadlift':'levantamento-terra-romeno',
 'dumbbell-romanian-deadlift':'stiff-com-halteres','nordic-hamstring-curl':'flexao-nordica',
 'hip-thrust':'elevacao-pelvica','glute-bridge':'ponte-de-gluteos','cable-kickback':'coice-na-polia',
 'cable-standing-hip-abduction':'abducao-de-quadril-em-pe',
 'standing-calf-raise':'panturrilha-em-pe-na-maquina','leg-press-calf-raise':'panturrilha-no-leg-press',
 'single-leg-calf-raise':'panturrilha-em-pe-unilateral','seated-calf-raise':'panturrilha-sentado',
 'plank':'prancha-abdominal','ab-wheel':'abdominal-no-rolinho',
 'captains-chair-knee-raise':'elevacao-de-joelhos-na-paralela','crunch':'abdominal-supra',
 'cable-crunch':'abdominal-na-polia','side-plank':'prancha-lateral','reverse-crunch':'abdominal-reverso',
 'back-extension':'extensao-lombar-no-banco','bird-dog':'bird-dog','superman':'superman',
 'walking':'esteira-caminhada','running':'esteira-corrida','cycling':'bicicleta-ergometrica',
 'elliptical':'eliptico','rowing':'remo-ergometrico','jump-rope':'corda-de-pular',
};
const translations={
 'deadlift':'Levantamento terra','weighted-push-up':'Flexão de braços com peso','chin-up':'Barra fixa supinada',
 'arnold-press':'Desenvolvimento Arnold','smith-machine-bench-press':'Supino no Smith',
 'incline-cable-fly':'Crucifixo inclinado na polia','machine-chest-press':'Supino na máquina',
 'upright-row':'Remada alta','t-bar-row':'Remada cavalinho','chest-supported-row':'Remada com apoio para peito',
 'goblet-squat':'Agachamento goblet','belt-squat':'Agachamento com cinto',
 'lying-leg-curl':'Mesa flexora deitado','sumo-deadlift':'Levantamento terra sumô',
 'tricep-kickback':'Tríceps coice','inverted-row':'Remada australiana',
 'pallof-press':'Pallof press','hanging-leg-raise':'Elevação de pernas suspenso',
 'hanging-knee-raise':'Elevação de joelhos suspenso','russian-twist':'Abdominal russo',
 'bicycle-crunch':'Abdominal bicicleta','mountain-climber':'Escalador',
 'high-knees':'Corrida com joelhos altos','jumping-jack':'Polichinelo','burpee':'Burpee',
 'kettlebell-swing':'Balanço de kettlebell','farmer-carry':'Caminhada do fazendeiro',
 'wall-sit':'Cadeira na parede','bodyweight-squat':'Agachamento com peso corporal',
 'step-up':'Subida no banco','lunge':'Afundo',
};
function validManifest(arr){
  if(!Array.isArray(arr)||arr.length<250||arr.length>600)throw new Error('Manifesto externo com quantidade inesperada.');
  const seen=new Set();
  return arr.map(e=>{
    if(!e||typeof e.slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.slug)||seen.has(e.slug)||!gid[e.primaryMuscle]||
      typeof e.name!=='string'||e.name.length>160||!Array.isArray(e.frames)||e.frames.length!==3||
      e.frames.some((f,i)=>f.path!==`assets/${e.slug}/frame-${i+1}.svg`))throw new Error('Manifesto externo inválido ou não reconhecido.');
    seen.add(e.slug);return e;
  });
}
function normalizeExercise(e){
 const slug=alias[e.slug]||'wg-'+e.slug;
 const title=ptBR[e.slug]||translations[e.slug]||e.name;
 return {slug,name:title.slice(0,160),group:gid[e.primaryMuscle],equipment:(equip[e.equipment]||e.equipment||'Livre').slice(0,100),image:CATALOG+e.frames[0].path};
}
async function loadManifest(timeoutMs=10000){
 const controller=new AbortController(),tm=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetch(MANIFEST,{headers:{Accept:'application/json'},signal:controller.signal});
  if(!response.ok)throw new Error('Fonte de ilustrações indisponível (HTTP '+response.status+').');
  const length=Number(response.headers.get('content-length')||0);
  if(length>5_000_000)throw new Error('Manifesto acima do limite permitido.');
  const text=await response.text();if(text.length>5_000_000)throw new Error('Manifesto acima do limite permitido.');
  return validManifest(JSON.parse(text));
 }finally{clearTimeout(tm);}
}
async function importarCatalogo({timeoutMs=10000}={}){
 const manifest=await loadManifest(timeoutMs);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const [slug,nome,ordem] of extraGroups)await client.query(`INSERT INTO public.avn_exercicio_grupos(slug,nome,ordem) VALUES ($1,$2,$3) ON CONFLICT(slug) DO NOTHING`,[slug,nome,ordem]);
  const {rows:groups}=await client.query('SELECT id,slug FROM public.avn_exercicio_grupos');
  const groupMap=new Map(groups.map(x=>[x.slug,x.id]));
  const exercises=manifest.map(normalizeExercise);
  for(let from=0;from<exercises.length;from+=50){
   const rows=exercises.slice(from,from+50),values=[],parts=[];
   for(const e of rows){const p=values.length;values.push(e.slug,e.name,groupMap.get(e.group),e.equipment,e.image);parts.push(`($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},'imagem')`);}
   await client.query(`INSERT INTO public.avn_exercicios(slug,nome,grupo_id,equipamento,midia_url,midia_tipo)
     VALUES ${parts.join(',')}
     ON CONFLICT(slug) DO UPDATE SET midia_url=COALESCE(public.avn_exercicios.midia_url,EXCLUDED.midia_url)`,values);
  }
  await client.query('COMMIT');
  return {ok:true,total:manifest.length,fonte:'Workout Guide / Bryl Lim / Everkinetic',licenca:LICENSE};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={importarCatalogo,validManifest,normalizeExercise,alias,CATALOG,LICENSE};
