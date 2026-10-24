'use strict';
/**
 * AVN / Workout Guide: catálogo local instalado via npm.
 * O manifesto da versão 1.0.0 utiliza PNG; versões posteriores podem usar SVG.
 * Os formatos são determinados pelo próprio manifesto, não por suposição.
 * Imagens CC BY-SA 4.0; créditos: Bryl Lim e Everkinetic.
 */
const fs = require('node:fs');
const pool = require('../../../db/connection');
const ptBR = require('./avn-treinos-ptbr');

const MANIFEST_FILE = require.resolve('@bryllim/workout-guide/manifest.json');
const LOCAL_BASE = '/avn/sistema/midias/';
const LICENSE = 'CC BY-SA 4.0';
const gid = {Chest:'peito',Back:'costas',Lats:'costas','Upper Back':'costas','Lower Back':'lombar',Shoulders:'ombros','Rear Delts':'ombros',Biceps:'biceps',Triceps:'triceps',Forearms:'antebracos',Quads:'quadriceps',Hamstrings:'posteriores','Posterior Chain':'posteriores',Glutes:'gluteos',Calves:'panturrilhas',Adductors:'adutores',Core:'abdomen',Legs:'cardio',Hips:'mobilidade',Mobility:'mobilidade'};
const extraGroups = [['antebracos','Antebraços',13],['adutores','Adutores',14],['mobilidade','Mobilidade e alongamento',15]];
const equip = {Barbell:'Barra',Dumbbell:'Halteres',Machine:'Máquina',Cable:'Polia',Bodyweight:'Peso corporal',Cardio:'Cardiorrespiratório',Plate:'Anilha','Pull-up Bar':'Barra fixa',Bench:'Banco',Wall:'Parede',Chair:'Cadeira',Doorway:'Porta',Towel:'Toalha',Box:'Caixa/Step',Kettlebell:'Kettlebell','Resistance Band':'Faixa elástica','Stability Ball':'Bola suíça'};
// Preserva os slugs dos 74 exercícios da primeira versão e seus vínculos nos treinos.
const alias = {
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
const translations = {
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
 'reverse-pec-deck':'Crucifixo inverso na máquina',
 'good-morning':'Bom dia com barra',
 'assisted-dip':'Mergulho assistido nas paralelas',
 'stair-climber':'Simulador de escadas',
};

function validManifest(arr) {
 if (!Array.isArray(arr) || arr.length!==302) throw new Error('Catálogo Workout Guide: esperados 302 exercícios.');
 const seen=new Set();
 return arr.map((e,i)=>{
  const ext=e?.frames?.[0]?.path?.match(/\.(png|svg)$/)?.[1];
  const valido=e && typeof e.slug==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.slug)
   && !seen.has(e.slug) && Boolean(gid[e.primaryMuscle]) && typeof e.name==='string' && e.name.length<=160
   && (ext==='png'||ext==='svg') && Array.isArray(e.frames) && e.frames.length===3
   && e.frames.every((f,j)=> f && f.path===`assets/${e.slug}/frame-${j+1}.${ext}` && (!f.format||f.format===ext));
  if(!valido)throw new Error(`Manifesto local inválido: exercício ${i+1}${e?.slug?' ('+e.slug+')':''}.`);
  seen.add(e.slug);return e;
 });
}
let cache;
let manifestBySlug;
function loadManifest(){
 if(!cache){
  cache=validManifest(JSON.parse(fs.readFileSync(MANIFEST_FILE,'utf8')));
  manifestBySlug=new Map(cache.map(e=>[e.slug,e]));
  console.log(`[AVN treinos] Manifesto local carregado: ${cache.length} exercícios, formato ${cache[0].frames[0].format||cache[0].frames[0].path.split('.').pop()}.`);
 }
 return cache;
}
function extensionForSlug(slug){
 loadManifest();
 const exercise=manifestBySlug.get(slug);
 return exercise?.frames?.[0]?.path?.match(/\.(png|svg)$/)?.[1]||null;
}
function normalizeExercise(e){
 const slug=alias[e.slug]||'wg-'+e.slug;
 const title=ptBR[e.slug]||translations[e.slug]||e.name;
 return {slug,name:title.slice(0,160),group:gid[e.primaryMuscle],equipment:(equip[e.equipment]||e.equipment||'Livre').slice(0,100),image:LOCAL_BASE+e.frames[0].path.replace(/^assets\//,'')};
}
function normalizarMidia(url){
 if(typeof url!=='string')return url;
 // URLs externas do seed inicial; resolvidas para imagens SERVIDAS PELO RENDER.
 const external=url.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/bryllim\/workout-guide@[^/]+\/packages\/workout-guide\/assets\/([a-z0-9-]+)\/(frame-[123])\.(?:svg|png)(?:\?.*)?$/);
 const local=url.match(/^\/avn\/sistema\/midias\/([a-z0-9-]+)\/(frame-[123])\.(?:svg|png)$/);
 const m=external||local;
 if(!m)return url;
 const ext=extensionForSlug(m[1]);
 return ext?`${LOCAL_BASE}${m[1]}/${m[2]}.${ext}`:url;
}
async function importarCatalogo(){
 const manifest=loadManifest();
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  for(const [slug,nome,ordem] of extraGroups){await client.query(`INSERT INTO public.avn_exercicio_grupos(slug,nome,ordem) VALUES ($1,$2,$3) ON CONFLICT(slug) DO NOTHING`,[slug,nome,ordem]);}
  const {rows:groups}=await client.query('SELECT id,slug FROM public.avn_exercicio_grupos');
  const groupMap=new Map(groups.map(x=>[x.slug,x.id]));
  const exercises=manifest.map(normalizeExercise);
  for(let from=0;from<exercises.length;from+=50){
   const rows=exercises.slice(from,from+50),values=[],parts=[];
   for(const e of rows){const p=values.length,groupId=groupMap.get(e.group);
    if(!groupId)throw new Error('Grupo ausente: '+e.group);
    values.push(e.slug,e.name,groupId,e.equipment,e.image);
    parts.push(`($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},'imagem')`);
   }
   await client.query(`INSERT INTO public.avn_exercicios(slug,nome,grupo_id,equipamento,midia_url,midia_tipo)
     VALUES ${parts.join(',')}
     ON CONFLICT(slug) DO UPDATE SET
       midia_url=CASE WHEN public.avn_exercicios.midia_url IS NULL
          OR public.avn_exercicios.midia_url LIKE 'https://cdn.jsdelivr.net/gh/bryllim/workout-guide@%'
          OR public.avn_exercicios.midia_url LIKE '/avn/sistema/midias/%/frame-1.svg'
          THEN EXCLUDED.midia_url ELSE public.avn_exercicios.midia_url END,
       atualizado_em=NOW()`,values);
  }
  await client.query('COMMIT');
  return {ok:true,total:manifest.length,fonte:'Workout Guide / Bryl Lim / Everkinetic',licenca:LICENSE,origem:'npm-local',midias:906};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
module.exports={importarCatalogo,validManifest,normalizeExercise,normalizarMidia,loadManifest,alias,LOCAL_BASE,LICENSE};
