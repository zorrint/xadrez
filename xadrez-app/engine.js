/* Motor local: conversa com o Stockfish (WASM) e usa chess.js para as regras */
function makeEngine(worker){
  let cb=null, q=Promise.resolve();
  worker.onmessage=e=>{const l=typeof e.data==='string'?e.data:String(e.data);if(cb)cb(l)};
  const send=c=>worker.postMessage(c);
  const wait=(cmd,until,onLine)=>new Promise(res=>{
    cb=l=>{if(onLine)onLine(l);if(l.startsWith(until)){cb=null;res(l)}};
    if(cmd)send(cmd)});
  const ready=wait('uci','uciok').then(()=>wait('isready','readyok'));
  const run=fn=>q=q.then(fn,fn);

  const mv=(ch,u)=>ch.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});

  function stateOf(ch){
    const over=ch.game_over();let result=null;
    if(over)result=ch.in_checkmate()?(ch.turn()==='w'?'0-1':'1-0'):'1/2-1/2';
    return {fen:ch.fen(),legal:ch.moves({verbose:true}).map(m=>m.from+m.to+(m.promotion||'')),
      check:ch.in_check(),over,result};
  }
  function state(fen){
    const v=new Chess().validate_fen(fen);
    if(!v.valid)return {error:'fen'};
    let ch;try{ch=new Chess(fen)}catch(e){return {error:'fen'}}
    return stateOf(ch);
  }
  function move(fen,uci){
    const ch=new Chess(fen);const m=mv(ch,uci);
    if(!m)return {error:'ilegal'};
    return {san:m.san,uci,...stateOf(ch)};
  }
  function analyze(fen,elo){
    const ch=new Chess(fen);
    if(ch.game_over())return Promise.resolve({ev:ch.in_checkmate()?(ch.turn()==='w'?-10000:10000):0});
    return run(async()=>{
      await ready;
      send('setoption name UCI_LimitStrength value false');
      send('setoption name Skill Level value 20');
      send('position fen '+fen);
      let score=null,pv=null;
      const bl=await wait('go depth 14','bestmove',l=>{
        if(l.startsWith('info')&&l.includes(' pv ')&&!/lowerbound|upperbound/.test(l)){
          const m=l.match(/score (cp|mate) (-?\d+)/),p=l.match(/ pv (.+)$/);
          if(m&&p){score={t:m[1],v:+m[2]};pv=p[1].trim().split(' ')}}});
      const best=bl.split(' ')[1];
      if(!pv||pv[0]!==best)pv=[best];
      if(elo>=1320){
        send('setoption name Skill Level value 20');
        send('setoption name UCI_LimitStrength value true');
        send('setoption name UCI_Elo value '+Math.min(elo,3190));
        var gl='go movetime 150';
      }else{
        send('setoption name UCI_LimitStrength value false');
        send('setoption name Skill Level value 0');
        var gl='go depth 1';
      }
      const sug=(await wait(gl,'bestmove')).split(' ')[1];
      const b2=new Chess(fen),line=[];
      for(const u of pv.slice(0,5)){const m=mv(b2,u);if(!m)break;line.push(m.san)}
      const bestSan=mv(new Chess(fen),best).san,sugSan=mv(new Chess(fen),sug).san;
      let cp=score?(score.t==='cp'?score.v:Math.sign(score.v)*(10000-Math.abs(score.v))):0;
      if(ch.turn()==='b')cp=-cp;
      return {ev:cp,best:bestSan,best_uci:best,line:line.join(' '),sug:sugSan,sug_uci:sug};
    });
  }
  return {state,move,analyze};
}
if(typeof module!=='undefined')module.exports={makeEngine};
