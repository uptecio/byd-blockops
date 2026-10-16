import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {access,copyFile,cp,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

// All version/package mutations belong to isolated, disposable build copies.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(process.env.ANDROID_FIXTURE_ARTIFACTS||'');
assert.ok(out.startsWith(join(root,'artifacts')+sep),'Explicit owned ANDROID_FIXTURE_ARTIFACTS required');
await mkdir(out,{recursive:true});assert.ok((await realpath(out)).startsWith(join(root,'artifacts')+sep));
const sdk='/home/alex/Android/Sdk',tools=join(sdk,'build-tools/36.0.0');
const gradle=process.env.GRADLE_BINARY||'/home/alex/.gradle/wrapper/dists/gradle-8.14.3-bin/cv11ve7ro1n3o1j4so8xd9n66/gradle-8.14.3/bin/gradle';
const signingHome=join(homedir(),'.android'),key=join(signingHome,'debug.keystore');
const pin='6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49';
const hash=b=>createHash('sha256').update(b).digest('hex');
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024,...options});if(r.error)throw r.error;assert.equal(r.status,0,`${command}: ${r.stdout}\n${r.stderr}`);return options.encoding===null?r.stdout:r.stdout+r.stderr;}
await access(key);assert.ok(run('keytool',['-list','-v','-keystore',key,'-alias','androiddebugkey','-storepass','android']).replace(/:/g,'').toLowerCase().includes(pin),'Original signing key must exist and match before build');
const baseline=resolve(process.env.ANDROID_BASELINE_APK_PATH||'');
assert.equal(hash(await readFile(baseline)),'e208ef6fd6fdefb0cc6ea1e49eb31d4e0deff2956f3299252e86c51ae7a6385b');
const env={...process.env,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,ANDROID_USER_HOME:signingHome,BUILD_DIR:join(out,'web')};
async function socketFixture(dir){
  const asset=join(dir,'app/build/updater-test-assets/socket-fixture-api26.p12');await mkdir(dirname(asset),{recursive:true});
  // Android8's keystore reader needs older container protection, not weaker TLS.
  // This disposable loopback key never signs an APK or enters platform trust.
  try{await access(asset);}catch{run('keytool',['-J-Dkeystore.pkcs12.keyProtectionAlgorithm=PBEWithSHA1AndDESede','-J-Dkeystore.pkcs12.certProtectionAlgorithm=PBEWithSHA1AndDESede','-J-Dkeystore.pkcs12.macAlgorithm=HmacPBESHA1','-genkeypair','-storetype','PKCS12','-keystore',asset,'-alias','socket','-storepass','socket-fixture','-keypass','socket-fixture','-keyalg','RSA','-keysize','2048','-sigalg','SHA256withRSA','-validity','2','-dname','CN=127.0.0.1','-ext','SAN=ip:127.0.0.1']);}
}
if(process.argv.includes('--test-only')){
  const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  assert.equal(hash(await readFile(manifest.candidate.path)),manifest.candidate.sha256,'Do not replace candidate production bytes');
  const dir=join(out,'candidate15-source');await cp(join(root,'android/app/src/androidTest'),join(dir,'app/src/androidTest'),{recursive:true});
  await socketFixture(dir);
  await writeFile(join(out,'instrumentation-rebuild.log'),run(gradle,['-p',dir,'--console=plain',':app:assembleDebugAndroidTest'],{env}));
  await copyFile(join(dir,'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'),manifest.instrumentation);
  const signature=run(join(tools,'apksigner'),['verify','--verbose','--print-certs',manifest.instrumentation]);assert.ok(signature.includes(pin));
  manifest.instrumentationIdentity={sha256:hash(await readFile(manifest.instrumentation)),signature};
  await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log('PASS rebuilt instrumentation only; candidate hash unchanged');
  process.exit(0);
}
if(process.argv.includes('--bind-candidate')){
  assert.ok(process.env.ANDROID_FROZEN_CANDIDATE_APK_PATH,'Explicit frozen candidate path required');
  const file=join(out,'manifest.json'),current=JSON.parse(await readFile(file,'utf8'));
  const candidate=await inspect(resolve(process.env.ANDROID_FROZEN_CANDIDATE_APK_PATH),15,'0.11.0');
  const assets=path=>run('unzip',['-Z1',path]).split('\n').filter(name=>name.startsWith('assets/')&&!name.endsWith('/')).sort();
  const names=assets(candidate.path);assert.ok(names.length>0,'Candidate must contain packaged assets');
  for(const reference of [current.candidate,current.fixtures.valid]){
    assert.equal(hash(await readFile(reference.path)),reference.sha256,'Existing fixture bytes must remain verified');
    assert.deepEqual(names,assets(reference.path),'Frozen candidate and final-source fixtures must have identical asset entries');
    for(const name of names){
      const bytes=path=>run('unzip',['-p',path,name],{encoding:null});
      assert.deepEqual(bytes(candidate.path),bytes(reference.path),`Final packaged asset equality: ${name}`);
    }
  }
  current.generatedCandidate=current.generatedCandidate||current.candidate;current.candidate=candidate;
  current.candidateBinding={frozen:true,assetEqualityWithFixture16:true,sourceParity:'Caller must build fixtures from the same reviewed final source; APK assets alone do not prove Java source parity.'};
  await writeFile(file,JSON.stringify(current,null,2));console.log('PASS bound exact original-signer frozen15; packaged assets match generated15 and fixture16');process.exit(0);
}
await writeFile(join(out,'web-build.log'),run('node',['scripts/build.mjs'],{env}));
const manifest={baseline:{path:baseline},fixtures:{}};
async function inspect(path,code,name,packageName='au.local.blockops',expectedSigner=pin){
  const badging=run(join(tools,'aapt2'),['dump','badging',path]);
  assert.ok(badging.includes(`package: name='${packageName}' versionCode='${code}' versionName='${name}'`),badging);
  const signature=run(join(tools,'apksigner'),['verify','--verbose','--print-certs',path]);
  const signer=/Signer #1 certificate SHA-256 digest: (\w+)/.exec(signature)[1];
  if(expectedSigner)assert.equal(signer,expectedSigner);else assert.notEqual(signer,pin);
  return {path,sha256:hash(await readFile(path)),size:(await readFile(path)).length,code,name,packageName,signer,badging,signature};
}
manifest.baseline=await inspect(baseline,14,'0.10.0');
async function build(label,code,name,packageName='au.local.blockops',test=false){
  const dir=join(out,`${label}-source`);await access(dir).then(()=>{throw Error(`Refuse to overwrite existing build copy ${dir}`);},()=>{});
  await cp(join(root,'android'),dir,{recursive:true,filter:p=>!['build','.gradle'].includes(p.split(sep).at(-1))});
  const config=join(dir,'app/build.gradle');let source=await readFile(config,'utf8');
  source=source.replace(/versionCode \d+/,`versionCode ${code}`).replace(/versionName '[^']+'/,`versionName '${name}'`).replace("applicationId 'au.local.blockops'",`applicationId '${packageName}'`);await writeFile(config,source);
  await cp(join(out,'web'),join(dir,'app/src/main/assets'),{recursive:true});
  if(test){const assets=join(dir,'app/build/updater-test-assets');await mkdir(assets,{recursive:true});for(const [id,fixture] of Object.entries(manifest.fixtures))await copyFile(fixture.path,join(assets,`${id}.apk`));await copyFile(baseline,join(assets,'baseline.apk'));await socketFixture(dir);}
  await writeFile(join(out,`${label}-build.log`),run(gradle,['-p',dir,'--console=plain',':app:assembleDebug',...(test?[':app:assembleDebugAndroidTest']:[])],{env}));
  const path=join(out,`${label}.apk`);await copyFile(join(dir,'app/build/outputs/apk/debug/app-debug.apk'),path);
  if(test){manifest.instrumentation=join(out,'instrumentation.apk');await copyFile(join(dir,'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'),manifest.instrumentation);}
  return inspect(path,code,name,packageName);
}
manifest.fixtures.valid=await build('fixture16',16,'0.11.1');
manifest.fixtures.wrongPackage=await build('wrong-package',16,'0.11.1','au.local.blockops.updaterfixture');
manifest.fixtures.older=await build('older',14,'0.11.1');
const disposable=join(out,'DISPOSABLE-wrong-signer.jks');await access(disposable).then(()=>{throw Error('Disposable key already exists');},()=>{});
run('keytool',['-genkeypair','-keystore',disposable,'-alias','fixture','-storepass','fixture-only','-keypass','fixture-only','-keyalg','RSA','-keysize','2048','-validity','2','-dname','CN=Disposable updater negative fixture']);
const wrong=join(out,'wrong-signer.apk');await copyFile(manifest.fixtures.valid.path,wrong);
run(join(tools,'apksigner'),['sign','--ks',disposable,'--ks-key-alias','fixture','--ks-pass','pass:fixture-only','--key-pass','pass:fixture-only',wrong]);
manifest.fixtures.wrongSigner=await inspect(wrong,16,'0.11.1','au.local.blockops',null);
for(const [id,bytes] of [['malformed',Buffer.from('This is deliberately not an APK.\n')],['truncated',(await readFile(manifest.fixtures.valid.path)).subarray(0,1024)]]){const path=join(out,`${id}.apk`);await writeFile(path,bytes);manifest.fixtures[id]={path,size:bytes.length,sha256:hash(bytes),deliberatelyInvalid:true};}
manifest.candidate=await build('candidate15',15,'0.11.0','au.local.blockops',true);
manifest.instrumentationIdentity={sha256:hash(await readFile(manifest.instrumentation)),signature:run(join(tools,'apksigner'),['verify','--verbose','--print-certs',manifest.instrumentation])};
assert.ok(manifest.instrumentationIdentity.signature.includes(pin));
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(`PASS fixture identities and original signer: ${join(out,'manifest.json')}`);
