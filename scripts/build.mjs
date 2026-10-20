import {readFileSync,writeFileSync} from 'node:fs';
const parts=["src/01_bootstrap.part.js","src/02_roles.part.js","src/03_modules.part.js","src/04_ui_1.part.js","src/04_ui_2.part.js","src/04_ui_3.part.js","src/04_ui_4.part.js"];
const combined=parts.map(path=>readFileSync(path,'utf8')).join('');
if(process.argv.includes('--check')){
 if(readFileSync('app.js','utf8')!==combined){
  console.error('Bundled app.js differs from modular source. Run node scripts/build.mjs');
  process.exit(1);
 }
 console.log('Production bundle matches source.');
}else{
 writeFileSync('app.js',combined,'utf8');
 console.log('Assembled production bundle.');
}
