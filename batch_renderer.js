(() => {
  if (window.__batchV058) return;
  window.__batchV058 = true;

  const KEY = 'suno-batch-v058';
  const DEF = 20, MIN = 5, MAX = 300;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const num = (v,d) => Number.isFinite(Number(v)) ? Number(v) : d;
  let xlsxPromise, running = false, pauseRequested = false, countdown = 0;

  const emptyState = () => ({status:'idle',fileName:'',sheetName:'',defaultInterval:DEF,lastError:'',jobs:[]});
  let state = load();

  function load(){
    let s=emptyState();
    try{s={...s,...JSON.parse(localStorage.getItem(KEY)||'null')};}catch{}
    if(!Array.isArray(s.jobs))s.jobs=[];
    if(s.status==='running'){s.status='paused';s.lastError='上次批量运行被中断，已暂停。';}
    for(const j of s.jobs) if(j.status==='submitting'){
      j.status='interrupted';
      j.error='提交过程中程序被关闭。为避免重复生成，本行不会自动重提；请先检查 Suno 后再重试。';
    }
    save(s); return s;
  }
  function save(value=state){try{localStorage.setItem(KEY,JSON.stringify(value));}catch{}}

  function ensureXlsx(){
    if(window.XLSX)return Promise.resolve(window.XLSX);
    if(xlsxPromise)return xlsxPromise;
    xlsxPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='node_modules/xlsx/dist/xlsx.full.min.js';
      s.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('Excel组件加载失败'));
      s.onerror=()=>reject(new Error('无法加载Excel组件'));
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function pick(row,names){
    const e=Object.entries(row||{});
    for(const n of names){const k=String(n).trim().toLowerCase();const hit=e.find(([x])=>String(x).trim().toLowerCase()===k);if(hit)return hit[1];}
    return '';
  }
  const str=v=>String(v??'').trim();
  function model(v){
    const x=str(v).toLowerCase().replace(/\s/g,'');
    if(!x)return 'v5.5'; if(['v5.5','5.5'].includes(x))return 'v5.5'; if(['v5','5'].includes(x))return 'v5';
    if(['v4.5+','4.5+'].includes(x))return 'v4.5+'; if(['v4.5-all','4.5-all','v4.5all'].includes(x))return 'v4.5-all'; return str(v);
  }
  function gender(v){const x=str(v).toLowerCase();if(!x||['不指定','不限','none','auto'].includes(x))return '';if(['女声','女','female','f'].includes(x))return 'female';if(['男声','男','male','m'].includes(x))return 'male';return 'bad';}
  function enabled(v){const x=str(v).toLowerCase();return !['0','false','no','否','禁用','跳过'].includes(x);}

  function rowToJob(row,i){
    const title=str(pick(row,['歌名','歌曲名','title']));
    const lyrics=String(pick(row,['歌词','lyrics'])??'').trim();
    const m=model(pick(row,['模型','model','modelversion']));
    const g=gender(pick(row,['人声','性别','gender','vocalgender']));
    const rawSlot=str(pick(row,['账号','账号位','slot']))||'1';
    const slot=['1','2','3'].includes(rawSlot)?rawSlot:'1';
    const intervalRaw=str(pick(row,['提交间隔秒','间隔秒','等待秒数','intervalseconds']));
    const interval=intervalRaw?clamp(num(intervalRaw,DEF),MIN,MAX):null;
    const on=enabled(pick(row,['启用','是否提交','enabled']));
    const errors=[];
    if(on&&!title)errors.push('缺少歌名'); if(on&&!lyrics)errors.push('缺少歌词');
    if(on&&!['v5.5','v5','v4.5+','v4.5-all'].includes(m))errors.push(`模型无效:${m}`);
    if(on&&g==='bad')errors.push('人声只支持不指定/女声/男声'); if(on&&!['1','2','3'].includes(rawSlot))errors.push('账号只支持1/2/3');
    return {
      no:i+1,row:i+2,title,lyrics,
      stylePrompt:str(pick(row,['风格','风格提示词','style','styleprompt'])),
      negativeStyle:str(pick(row,['排除风格','negativestyle','negative style','negative_tags'])),
      modelVersion:m,vocalGender:g==='bad'?'':g,
      weirdness:clamp(num(pick(row,['Weirdness','weirdness']),50),0,100),
      styleInfluence:clamp(num(pick(row,['风格影响','style influence','styleinfluence']),50),0,100),
      slot,interval,status:!on?'skipped':errors.length?'invalid':'queued',error:errors.join('；'),clipIds:[]
    };
  }

  function inject(){
    const tabs=document.querySelector('.tabs'),wrap=document.querySelector('.wrap'); if(!tabs||!wrap||$('tabBatch'))return;
    const style=document.createElement('style'); style.textContent='.batchbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.batchbar input{width:90px}.batchstats{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0;color:#aab4c8;font-size:12px}.batchbox{margin-top:10px;padding:10px;border:1px solid #2b3040;border-radius:9px;background:#0f1117}.batchtable{overflow:auto;max-height:470px;margin-top:12px;border:1px solid #292e3b;border-radius:10px}.batchtable table{min-width:1000px}.batcherr{max-width:300px;color:#f97066;white-space:normal}';document.head.appendChild(style);
    const tab=document.createElement('button');tab.id='tabBatch';tab.className='tab';tab.textContent='Excel 批量原创';tabs.appendChild(tab);
    const sec=document.createElement('section');sec.id='batchView';sec.className='hidden';sec.innerHTML=`<div class="card"><h2>Excel 批量原创</h2><div class="small">一行一首，按顺序逐首提交；每首结束后等待一段时间再提交下一首。默认20秒，可设5-300秒。</div><div class="batchbar" style="margin-top:14px"><input id="batchFile" type="file" accept=".xlsx,.xls" style="display:none"><button id="batchChoose">选择Excel</button><button id="batchTpl" class="secondary">下载模板</button><label style="margin:0">默认间隔(秒) <input id="batchInterval" type="number" min="5" max="300"></label><button id="batchStart">开始批量</button><button id="batchPause" class="secondary">暂停</button><button id="batchRetry" class="secondary">重试失败/中断</button><button id="batchClear" class="danger">清空</button></div><div id="batchStats" class="batchstats"></div><div id="batchState" class="batchbox">等待导入Excel。</div><div class="batchtable"><table><thead><tr><th>#</th><th>Excel行</th><th>歌名</th><th>账号</th><th>模型</th><th>人声</th><th>间隔</th><th>状态</th><th>结果/错误</th></tr></thead><tbody id="batchBody"></tbody></table></div><div id="batchLog" class="log">批量模块准备就绪。</div></div>`;
    wrap.insertBefore(sec,$('deaiView')||null);
    ['tabOriginal','tabLibrary','tabDeai'].forEach(id=>$(id)?.addEventListener('click',()=>{sec.classList.add('hidden');tab.classList.remove('active');}));
    tab.onclick=()=>{['originalView','libraryView','deaiView'].forEach(id=>$(id)?.classList.add('hidden'));sec.classList.remove('hidden');['tabOriginal','tabLibrary','tabDeai'].forEach(id=>$(id)?.classList.remove('active'));tab.classList.add('active');render();};
    $('batchChoose').onclick=()=>$('batchFile').click(); $('batchFile').onchange=importExcel; $('batchTpl').onclick=template;
    $('batchStart').onclick=start; $('batchPause').onclick=()=>{if(running){pauseRequested=true;state.lastError='已请求暂停；当前歌曲提交结束后暂停。';save();render();}};
    $('batchRetry').onclick=retry; $('batchClear').onclick=clear;
    $('batchInterval').onchange=()=>{state.defaultInterval=clamp(num($('batchInterval').value,DEF),MIN,MAX);save();render();};
    const h=document.querySelector('h1');if(h)h.textContent='Suno Original Studio v0.5.9';document.title='Suno Original Studio v0.5.9';render();
  }

  function log(t,cls=''){const b=$('batchLog');if(!b)return;b.innerHTML+=`\n<span class="${cls}">[${new Date().toLocaleTimeString()}] ${esc(t)}</span>`;b.scrollTop=b.scrollHeight;}
  const stText=s=>({idle:'未导入',ready:'待开始',running:'运行中',paused:'已暂停',completed:'已完成',queued:'等待',submitting:'提交中',submitted:'已提交',partial:'版本不完整',error:'失败',invalid:'参数错误',interrupted:'中断待确认',skipped:'跳过'}[s]||s);
  function render(){
    if(!$('batchView'))return; const jobs=state.jobs||[], count=s=>jobs.filter(j=>j.status===s).length;
    $('batchInterval').value=state.defaultInterval||DEF;
    $('batchStats').innerHTML=`<span>${esc(state.fileName||'未导入')}</span><span>总计 <b>${jobs.length}</b></span><span>待提交 <b>${count('queued')}</b></span><span>完整提交 <b>${count('submitted')}</b></span><span>版本不完整 <b>${count('partial')}</b></span><span>失败 <b>${count('error')}</b></span><span>中断 <b>${count('interrupted')}</b></span><span>参数错误 <b>${count('invalid')}</b></span>`;
    $('batchState').textContent=`${stText(state.status)}${countdown?` · 下一首 ${countdown} 秒后提交`:''}${state.lastError?` · ${state.lastError}`:''}`;
    $('batchBody').innerHTML=jobs.length?jobs.map(j=>`<tr><td>${j.no}</td><td>${j.row}</td><td><b>${esc(j.title||'—')}</b></td><td>账号${esc(j.slot)}</td><td>${esc(j.modelVersion)}</td><td>${j.vocalGender==='female'?'女声':j.vocalGender==='male'?'男声':'不指定'}</td><td>${j.interval||state.defaultInterval||DEF}秒</td><td>${esc(stText(j.status))}</td><td class="batcherr">${esc(['submitted','partial'].includes(j.status)?`${j.clipIds.length}个版本 · ${j.clipIds.map(x=>String(x).slice(0,8)).join(',')}${j.error?` · ${j.error}`:''}`:j.error||'')}</td></tr>`).join(''):'<tr><td colspan="9" class="library-empty">还没有导入Excel。</td></tr>';
    $('batchStart').disabled=running||!jobs.some(j=>j.status==='queued'); $('batchStart').textContent=state.status==='paused'?'继续批量':'开始批量';
    $('batchPause').disabled=!running; $('batchChoose').disabled=running; $('batchInterval').disabled=running;
    $('batchRetry').disabled=running||!jobs.some(j=>['error','interrupted'].includes(j.status)); $('batchClear').disabled=running||!jobs.length;
  }

  async function importExcel(e){
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    try{const X=await ensureXlsx(),wb=X.read(await file.arrayBuffer(),{type:'array'}),name=wb.SheetNames[0];if(!name)throw new Error('Excel没有工作表');const rows=X.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false});const jobs=rows.map(rowToJob).filter(j=>j.title||j.lyrics||j.error);if(!jobs.length)throw new Error('Excel没有歌曲数据');state={...emptyState(),fileName:file.name,sheetName:name,defaultInterval:state.defaultInterval||DEF,status:jobs.some(j=>j.status==='queued')?'ready':'paused',jobs};save();log(`导入${jobs.length}行，可提交${jobs.filter(j=>j.status==='queued').length}首。`,'oktxt');render();}catch(err){log(err.message||err,'err');alert(err.message||String(err));}
  }

  async function template(){
    try{const X=await ensureXlsx(),ws=X.utils.aoa_to_sheet([['歌名','歌词','风格','排除风格','模型','人声','Weirdness','风格影响','账号','提交间隔秒','启用'],['示例歌曲','[Verse]\n歌词……','sad piano pop','rap, metal','v5.5','女声',50,50,1,20,'是']]);ws['!cols']=[{wch:28},{wch:55},{wch:32},{wch:28},{wch:12},{wch:10},{wch:12},{wch:12},{wch:8},{wch:14},{wch:8}];const note=X.utils.aoa_to_sheet([['字段','说明'],['歌名/歌词','必填'],['模型','v5.5 / v5 / v4.5+ / v4.5-all'],['人声','不指定 / 女声 / 男声'],['账号','1 / 2 / 3，空白默认1'],['提交间隔秒','5-300秒，空白使用软件默认20秒'],['启用','是/否，空白默认是']]);const wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,'批量原创');X.utils.book_append_sheet(wb,note,'填写说明');const out=X.write(wb,{type:'array',bookType:'xlsx'}),url=URL.createObjectURL(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='SunoOriginalStudio批量原创模板.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);log('模板已生成。','oktxt');}catch(err){log(err.message||err,'err');}
  }

  const payload=j=>({title:j.title,lyrics:j.lyrics,stylePrompt:j.stylePrompt,negativeStyle:j.negativeStyle,slot:j.slot,modelVersion:j.modelVersion,vocalGender:j.vocalGender,weirdness:j.weirdness,styleInfluence:j.styleInfluence});
  const pauseError=m=>/尚未登录|登录状态|登录.*失效|额度不足|out of credits|not enough credits/i.test(String(m));
  async function spacing(sec){countdown=clamp(num(sec,DEF),MIN,MAX);while(countdown>0&&!pauseRequested){render();await wait(1000);countdown--;}countdown=0;render();}

  async function run(){
    if(running)return;running=true;pauseRequested=false;state.status='running';state.lastError='';save();render();
    try{
      while(!pauseRequested){
        const j=state.jobs.find(x=>x.status==='queued');if(!j)break;
        const acc=await window.demoApi.accountStatus(j.slot).catch(()=>({loggedIn:false}));if(!acc.loggedIn){state.status='paused';state.lastError=`账号${j.slot}未登录，请登录后继续。`;log(state.lastError,'err');break;}
        j.status='submitting';j.error='';save();render();log(`提交Excel第${j.row}行：${j.title} / 账号${j.slot}`);
        try{
          const p=payload(j),task=await window.demoApi.submitOriginal(p);
          await window.demoApi.saveSongSubmission({task,input:p});
          j.clipIds=task.clipIds||[];
          if(task.partial||j.clipIds.length<2){
            j.status='partial';
            j.error=task.warning||`Suno 本次只确认到 ${j.clipIds.length} 个版本；不会自动重提，避免重复扣费。`;
            log(`版本不完整：${j.title}，仅确认${j.clipIds.length}个版本。${j.error}`,'err');
          }else{
            j.status='submitted';j.error='';
            log(`提交成功：${j.title}，2个版本。`,'oktxt');
          }
          save();
        }
        catch(err){const m=err.message||String(err);j.status='error';j.error=m;state.lastError=m;save();log(`提交失败：${j.title}：${m}`,'err');if(pauseError(m)){state.status='paused';break;}}
        render();if(pauseRequested)break;if(!state.jobs.some(x=>x.status==='queued'))break;const sec=j.interval||state.defaultInterval||DEF;log(`等待${sec}秒后提交下一首。`);await spacing(sec);
      }
      if(pauseRequested||state.status==='paused')state.status='paused';else if(!state.jobs.some(x=>x.status==='queued')){state.status='completed';state.lastError='';const ok=state.jobs.filter(x=>x.status==='submitted').length,partial=state.jobs.filter(x=>x.status==='partial').length;log(`批次结束：完整提交${ok}首${partial?`，版本不完整${partial}首`:''}。`,partial?'err':'oktxt');}else state.status='paused';
    }finally{running=false;pauseRequested=false;countdown=0;save();render();}
  }

  function start(){if(!running&&state.jobs.some(j=>j.status==='queued'))run().catch(err=>{running=false;state.status='paused';state.lastError=err.message||String(err);save();log(state.lastError,'err');render();});}
  function retry(){let n=0;for(const j of state.jobs)if(['error','interrupted'].includes(j.status)){j.status='queued';j.error='';j.clipIds=[];n++;}if(n){state.status='paused';state.lastError='';save();log(`已把${n}首失败/中断歌曲放回队列。中断歌曲请先确认Suno中没有实际提交成功，避免重复。`);render();}}
  function clear(){if(running||!confirm('确定清空当前批次吗？已写入歌曲列表的作品不会删除。'))return;const d=state.defaultInterval||DEF;state={...emptyState(),defaultInterval:d};save();$('batchLog').textContent='批量列表已清空。';render();}

  inject();
})();
