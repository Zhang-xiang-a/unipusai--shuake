import fs from 'node:fs';
import path from 'node:path';
import {ROOT_DIR} from './paths.mjs';

// Small dotenv subset: no interpolation or command execution; shell values win.
export function loadLocalEnv({file=path.join(ROOT_DIR,'.env'),env=process.env}={}) {
  let body;
  try {body=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');}
  catch(error){if(error.code==='ENOENT')return env;throw error;}
  for(const line of body.split(/\r?\n/)) {
    const match=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(!match || Object.hasOwn(env,match[1]))continue;
    let value=match[2];
    if(value.startsWith('"') || value.startsWith("'")) {
      const end=value.lastIndexOf(value[0]);
      if(end===0)throw new Error(`.env 中 ${match[1]} 的引号未闭合`);
      value=value.slice(1,end);
    } else value=value.replace(/\s+#.*$/,'').trim();
    env[match[1]]=value;
  }
  return env;
}
