(function(){
"use strict";


var MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
var MONTHS_IN=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
var DOW=["пн","вт","ср","чт","пт","сб","вс"];
var FORMATS={individual:"Индивидуально",mini:"Мини-группа",group:"Группа"};
var STATUS_ORDER_PLAN=["plan","done","pc","c","off"];
var STATUS_ORDER_FREE=["none","done","pc"];
var MARK={plan:"",done:"✓",pc:"₽",c:"×",off:"–"};
var CLS={plan:"c-plan",done:"c-done",pc:"c-pc",c:"c-c",off:"c-off"};

var state={tab:"month",ref:"teachers",ym:null,teachers:{},units:{},months:{},payouts:{},settings:{},ready:false,err:null};


/* ---------- helpers ---------- */
function pad(n){return n<10?"0"+n:""+n;}
function ymOf(d){return d.getFullYear()+"-"+pad(d.getMonth()+1);}
function ymParts(ym){var a=ym.split("-");return{y:+a[0],m:+a[1]};}
function ymLabel(ym){var p=ymParts(ym);return MONTHS[p.m-1]+" "+p.y;}
function ymShift(ym,k){var p=ymParts(ym);var d=new Date(p.y,p.m-1+k,1);return ymOf(d);}
function daysIn(ym){var p=ymParts(ym);return new Date(p.y,p.m,0).getDate();}
function dowOf(ym,day){var p=ymParts(ym);var w=new Date(p.y,p.m-1,day).getDay();return w===0?7:w;}
function fmtMoney(n){if(!n)return"0 ₽";return Math.round(n).toLocaleString("ru-RU").replace(/ /g," ")+" ₽";}
function fmtNum(n){return(n||0).toLocaleString("ru-RU");}
function fmtDate(s){if(!s)return"";var a=String(s).split("-");if(a.length!==3)return s;return a[2]+"."+a[1]+"."+a[0].slice(2);}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function el(html){var t=document.createElement("template");t.innerHTML=html.trim();return t.content.firstElementChild;}
function toast(msg){var old=document.querySelector(".toast");if(old)old.remove();var t=el('<div class="toast">'+esc(msg)+"</div>");document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.remove();},2200);}

function teacherList(){
  var a=[];for(var k in state.teachers){a.push(state.teachers[k]);}
  a.sort(function(x,y){return(x.order||99)-(y.order||99)||String(x.name).localeCompare(String(y.name),"ru");});
  return a;
}
function unitsOf(tid){
  var a=[];for(var k in state.units){var u=state.units[k];if(u.teacherId===tid&&u.active!==false)a.push(u);}
  a.sort(function(x,y){return(x.order||999)-(y.order||999);});
  return a;
}
function baseRates(){return(state.settings.baseRates)||{individual:1000,mini:1500,group:1000};}
function rateOf(u){
  if(typeof u.rate==="number")return u.rate;
  var t=state.teachers[u.teacherId];
  if(t&&t.rates&&typeof t.rates[u.format]==="number")return t.rates[u.format];
  var b=baseRates();return b[u.format]||0;
}
function members(u){return(u.members||[]).filter(function(m){return m&&m.active!==false;});}
function lessonRevenue(u){
  if(u.kind==="group")return members(u).reduce(function(s,m){return s+(+m.price||0);},0);
  return +u.price||0;
}
function mdoc(u){return state.months[state.ym+"__"+u.id]||{days:{},pay:{}};}
function planDays(u,ym){
  var wd=u.weekdays||[],out=[];
  if(!wd.length)return out;
  for(var d=1;d<=daysIn(ym);d++){if(wd.indexOf(dowOf(ym,d))>=0)out.push(d);}
  return out;
}
/* effective status of a day: 'plan' | 'done' | 'pc' | 'c' | 'off' | 'none' */
function dayStatus(u,ym,day,md){
  var raw=(md.days||{})[String(day)];
  if(raw)return raw;
  return planDays(u,ym).indexOf(day)>=0?"plan":"none";
}
function unitStats(u){
  var md=mdoc(u),ym=state.ym,n=daysIn(ym);
  var plan=0,done=0,pc=0,canc=0;
  for(var d=1;d<=n;d++){
    var s=dayStatus(u,ym,d,md);
    if(s==="plan")plan++;
    else if(s==="done"){done++;plan++;}
    else if(s==="pc"){pc++;plan++;}
    else if(s==="c")canc++;
  }
  var paidLessons=done+pc;
  var rate=rateOf(u),rev=lessonRevenue(u);
  return{plan:plan,done:done,pc:pc,canc:canc,paidLessons:paidLessons,
    payout:paidLessons*rate,revenue:paidLessons*rev,planRevenue:plan*rev,
    margin:paidLessons*(rev-rate),rate:rate,perLesson:rev,md:md};
}
function payoutDoc(tid){return state.payouts[state.ym+"__"+tid]||{};}

/* ---------- writes ---------- */
function needWrite(){
  if(!session){toast("Сначала войдите");return false;}
  return true;
}
var pending={};
function saveMonth(u,patch){
  if(!needWrite())return Promise.resolve();
  var id=state.ym+"__"+u.id;
  var cur=state.months[id]||{unitId:u.id,month:state.ym,days:{},pay:{}};
  var next={unitId:u.id,month:state.ym,days:Object.assign({},cur.days||{}),pay:Object.assign({},cur.pay||{}),note:cur.note||""};
  if(patch.days)next.days=Object.assign(next.days,patch.days);
  if(patch.pay)for(var k in patch.pay){next.pay[k]=patch.pay[k];}
  if("note" in patch)next.note=patch.note;
  for(var d in next.days){if(!next.days[d])delete next.days[d];}
  state.months[id]=next;render();
  if(pending[id])return pending[id];
  pending[id]=API.saveMonth(next).catch(saveFailed).then(function(){delete pending[id];});
  return pending[id];
}
function savePayout(tid,patch){
  if(!needWrite())return Promise.resolve();
  var id=state.ym+"__"+tid;
  var cur=state.payouts[id]||{teacherId:tid,month:state.ym,requested:0,paid:0,paidDate:"",status:"unpaid",note:""};
  var next=Object.assign({},cur,patch,{teacherId:tid,month:state.ym});
  state.payouts[id]=next;render();
  return API.savePayout(next).catch(saveFailed);
}
function saveUnit(uid,patch){
  if(!needWrite())return Promise.resolve();
  var cur=state.units[uid];if(!cur)return Promise.resolve();
  var next=Object.assign({},cur,patch);next.id=uid;
  state.units[uid]=next;render();
  return API.saveUnit(uid,next).catch(saveFailed);
}
function saveTeacher(tid,patch){
  if(!needWrite())return Promise.resolve();
  var cur=state.teachers[tid];if(!cur)return Promise.resolve();
  var next=Object.assign({},cur,patch);next.id=tid;
  state.teachers[tid]=next;render();
  return API.saveTeacher(tid,next).catch(saveFailed);
}
function saveFailed(e){
  var msg=e&&(e.message||e.error_description||e.code)||"ошибка";
  toast("Не удалось сохранить: "+msg);
}
function newId(prefix){return prefix+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);}

/* ---------- абонементы: расчёт ---------- */
function paySlots(u){
  if(u.kind==="group")return members(u).map(function(m){
    return{key:m.id,name:m.name,parent:m.parent,defPrice:+m.price||0,note:m.note||""};});
  return[{key:"solo",name:u.name,parent:u.parent,defPrice:+u.price||0,note:u.note||""}];
}
/* Начисление идёт вперёд: занятий к оплате = план месяца минус перенос. */
function packageOf(u){
  if(!u.pkg)return null;
  var ps=packages().filter(function(x){return x.name===u.pkg;});
  return ps.length?ps[0]:null;
}
function slotData(u,sl,ym){
  ym=ym||state.ym;
  var md=state.months[ym+"__"+u.id]||{days:{},pay:{}};
  var rec=(md.pay||{})[sl.key]||{};
  var plan=planDays(u,ym).length;
  var pkg=packageOf(u);
  var carry=+rec.carry||0;
  var defLessons=pkg?(+pkg.lessons||0):Math.max(0,plan-carry);
  var lessons=rec.lessons==null?Math.max(0,defLessons-(pkg?carry:0)):(+rec.lessons||0);
  var defPrice=pkg&&pkg.tariff?tariffPrice(pkg.tariff):sl.defPrice;
  var price=rec.price==null?defPrice:(+rec.price||0);
  var discount=rec.discount==null?(pkg?(+pkg.discount||0):0):(+rec.discount||0);
  var gross=lessons*price;
  var charge=Math.round(gross-gross*discount/100);
  var amount=+rec.amount||0;
  return{key:sl.key,plan:plan,carry:carry,lessons:lessons,price:price,discount:discount,
    charge:charge,amount:amount,left:charge-amount,pkg:pkg,
    date:rec.date||"",note:rec.note||""};
}
function unitBilling(u,ym){
  var c=0,a=0,l=0;
  paySlots(u).forEach(function(sl){
    var d=slotData(u,sl,ym);c+=d.charge;a+=d.amount;l+=d.lessons;
  });
  return{charge:c,amount:a,left:c-a,lessons:l};
}
function packages(){return state.settings.packages||[];}
function tariffs(){return state.settings.tariffs||[];}

function saveSlot(u,key,patch){
  var md=mdoc(u),rec=Object.assign({},(md.pay||{})[key]||{});
  Object.keys(patch).forEach(function(k){rec[k]=patch[k];});
  var p={};p[key]=rec;
  return saveMonth(u,{pay:p});
}
/* Перенос занятий в следующий месяц: уменьшает его абонемент. */
function carryForward(u,key,count){
  if(!needWrite())return;
  var nextYm=ymShift(state.ym,1),id=nextYm+"__"+u.id;
  var cur=state.months[id]||{unitId:u.id,month:nextYm,days:{},pay:{}};
  var rec=Object.assign({},(cur.pay||{})[key]||{});
  rec.carry=(+rec.carry||0)+count;
  var plan=planDays(u,nextYm).length;
  rec.lessons=Math.max(0,plan-rec.carry);
  var pay=Object.assign({},cur.pay||{});pay[key]=rec;
  var next={unitId:u.id,month:nextYm,days:Object.assign({},cur.days||{}),pay:pay,note:cur.note||""};
  state.months[id]=next;render();
  return API.saveMonth(next).then(function(){
    toast("Перенесено в "+ymLabel(nextYm)+": "+count+" зан.");
  },saveFailed);
}

/* ---------- tabs ---------- */
var TABS=[
  {id:"month",label:"Месяц"},
  {id:"journal",label:"Журнал занятий"},
  {id:"schedule",label:"Расписание по дням"},
  {id:"money",label:"Абонементы и оплаты"},
  {id:"ref",label:"Справочники"}
];
function renderTabs(){
  var nav=document.getElementById("tabs");nav.innerHTML="";
  TABS.forEach(function(t){
    var b=el('<button type="button">'+esc(t.label)+"</button>");
    if(state.tab===t.id)b.setAttribute("aria-current","true");
    b.onclick=function(){state.tab=t.id;try{localStorage.setItem("oe.tab",t.id);}catch(e){}render();};
    nav.appendChild(b);
  });
  document.getElementById("m-lbl").textContent=ymLabel(state.ym);
}

/* ---------- экран: месяц ---------- */
function viewMonth(){
  var wrap=el('<div class="stack"></div>');
  var tot={lessons:0,charge:0,amount:0,done:0,payout:0,plan:0};
  var rows=[];
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    var sub={lessons:0,charge:0,amount:0,done:0,payout:0,plan:0};
    var inner=[];
    us.forEach(function(u){
      var s=unitStats(u),b=unitBilling(u);
      sub.lessons+=b.lessons;sub.charge+=b.charge;sub.amount+=b.amount;
      sub.done+=s.paidLessons;sub.payout+=s.payout;sub.plan+=s.plan;
      inner.push({u:u,s:s,b:b});
    });
    ["lessons","charge","amount","done","payout","plan"].forEach(function(k){tot[k]+=sub[k];});
    rows.push({t:t,sub:sub,inner:inner,pd:payoutDoc(t.id)});
  });
  var paidOut=0,requested=0;
  teacherList().forEach(function(t){var p=payoutDoc(t.id);paidOut+=+p.paid||0;requested+=+p.requested||0;});

  var kpis=el('<div class="kpis"></div>');
  function kpi(k,v,s,cls){return el('<div class="kpi'+(cls?" "+cls:"")+'"><div class="k">'+esc(k)+
    '</div><div class="v num">'+esc(v)+'</div><div class="s">'+esc(s||"")+"</div></div>");}
  kpis.appendChild(kpi("Начислено по абонементам",fmtMoney(tot.charge),fmtNum(tot.lessons)+" зан. к оплате"));
  kpis.appendChild(kpi("Получено от родителей",fmtMoney(tot.amount),
    tot.charge>tot.amount?"ждём "+fmtMoney(tot.charge-tot.amount):"всё поступило"));
  kpis.appendChild(kpi("К выплате педагогам",fmtMoney(tot.payout),
    "за "+fmtNum(tot.done)+" провед. · выплачено "+fmtMoney(paidOut)));
  kpis.appendChild(kpi("Заработок школы",fmtMoney(tot.charge-tot.payout),
    tot.charge?Math.round((tot.charge-tot.payout)/tot.charge*100)+"% от начисленного":"","accent"));
  kpis.appendChild(kpi("Занятий проведено",fmtNum(tot.done),"по плану "+fmtNum(tot.plan)));
  wrap.appendChild(kpis);

  var card=el('<div class="card"><div class="chead"><h2>По педагогам и ученикам</h2>'+
    '<span class="hint">Начисление — за запланированные занятия; выплата педагогу — за проведённые</span></div>'+
    '<div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Ученик или группа</th><th class="r">Абонемент</th><th class="r">Начислено</th>'+
    '<th class="r">Получено</th><th class="r">Остаток</th>'+
    '<th class="r">Провед.</th><th class="r">К выплате</th><th class="r">Заработок</th><th>Выплата педагогу</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody");
  rows.forEach(function(r){
    var pd=r.pd,diff=(+pd.requested||0)-r.sub.payout;
    var pill;
    if(r.sub.payout>0&&+pd.paid>=r.sub.payout)pill='<span class="pill ok">выплачено '+esc(fmtDate(pd.paidDate))+"</span>";
    else if(+pd.paid>0)pill='<span class="pill warn">частично '+esc(fmtMoney(pd.paid))+"</span>";
    else if(r.sub.payout>0)pill='<span class="pill bad">не выплачено</span>';
    else pill='<span class="pill mute">нет проведённых</span>';
    if(pd.requested&&Math.abs(diff)>=1)
      pill+=' <span class="pill warn">запрос '+esc(fmtMoney(pd.requested))+" ("+(diff>0?"+":"")+esc(fmtMoney(diff))+")</span>";
    tb.appendChild(el('<tr class="grp"><td>'+esc(r.t.name)+'</td><td class="r">'+fmtNum(r.sub.lessons)+
      '</td><td class="r">'+esc(fmtMoney(r.sub.charge))+'</td><td class="r">'+esc(fmtMoney(r.sub.amount))+
      '</td><td class="r">'+esc(fmtMoney(r.sub.charge-r.sub.amount))+'</td><td class="r">'+fmtNum(r.sub.done)+
      '</td><td class="r">'+esc(fmtMoney(r.sub.payout))+'</td><td class="r">'+esc(fmtMoney(r.sub.charge-r.sub.payout))+
      '</td><td class="nowrap">'+pill+"</td></tr>"));
    r.inner.forEach(function(x){
      var u=x.u,s=x.s,b=x.b;
      var nm=esc(u.name)+(u.kind==="group"?' <span class="sub">'+members(u).length+" чел.</span>":
        (u.parent?' <span class="sub">'+esc(u.parent)+"</span>":""));
      if(!(u.weekdays||[]).length)nm+=' <span class="pill mute">нет расписания</span>';
      var left=b.left,leftCell;
      if(!b.charge)leftCell='<span class="pill mute">не начислено</span>';
      else if(left>0)leftCell='<span class="pill warn">'+esc(fmtMoney(left))+"</span>";
      else if(left<0)leftCell='<span class="pill ok">переплата '+esc(fmtMoney(-left))+"</span>";
      else leftCell='<span class="pill ok">оплачено</span>';
      tb.appendChild(el('<tr><td style="padding-left:22px">'+nm+'</td><td class="r">'+fmtNum(b.lessons)+
        '</td><td class="r">'+esc(fmtMoney(b.charge))+'</td><td class="r">'+esc(fmtMoney(b.amount))+
        '</td><td class="r nowrap">'+leftCell+'</td><td class="r">'+fmtNum(s.paidLessons)+
        '</td><td class="r">'+esc(fmtMoney(s.payout))+'</td><td class="r">'+esc(fmtMoney(b.charge-s.payout))+
        '</td><td class="sub">'+esc(fmtMoney(s.rate))+" за занятие</td></tr>"));
    });
  });
  tb.appendChild(el('<tr class="tot"><td>Итого по школе</td><td class="r">'+fmtNum(tot.lessons)+
    '</td><td class="r">'+esc(fmtMoney(tot.charge))+'</td><td class="r">'+esc(fmtMoney(tot.amount))+
    '</td><td class="r">'+esc(fmtMoney(tot.charge-tot.amount))+'</td><td class="r">'+fmtNum(tot.done)+
    '</td><td class="r">'+esc(fmtMoney(tot.payout))+'</td><td class="r">'+esc(fmtMoney(tot.charge-tot.payout))+
    "</td><td></td></tr>"));
  card.querySelector(".tscroll").appendChild(tbl);
  wrap.appendChild(card);
  return wrap;
}

/* ---------- экран: журнал ---------- */
function viewJournal(){
  var ym=state.ym,n=daysIn(ym);
  var wrap=el('<div class="stack"></div>');
  var card=el('<div class="card"><div class="chead"><h2>Журнал занятий за '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Клик по клетке меняет её состояние</span></div></div>');
  var bar=el('<div style="padding:12px 14px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)"></div>');
  bar.appendChild(el('<div class="legend">'+
    '<span><i class="c-plan"></i>план</span>'+
    '<span><i class="c-done">✓</i>проведено</span>'+
    '<span><i class="c-pc">₽</i>отмена с оплатой</span>'+
    '<span><i class="c-c">×</i>отмена без оплаты</span>'+
    '<span><i class="c-off">–</i>снято с плана</span>'+
    "</div>"));
  var btns=el('<div class="btnrow"></div>');
  var confirmBtn=el('<button class="btn pri" type="button">Подтвердить план по сегодня</button>');
  confirmBtn.onclick=confirmPast;
  btns.appendChild(confirmBtn);
  bar.appendChild(btns);
  card.appendChild(bar);

  var scroll=el('<div class="tscroll" style="padding:0 0 10px"></div>');
  var grid=el('<div class="jgrid"></div>');
  grid.style.gridTemplateColumns="172px repeat("+n+",28px) 52px 52px";
  grid.appendChild(el('<div class="hd name">Ученик или группа</div>'));
  for(var d=1;d<=n;d++){
    var w=dowOf(ym,d);
    grid.appendChild(el('<div class="hd'+(w>=6?" we":"")+'"><span>'+d+"</span><span>"+DOW[w-1]+"</span></div>"));
  }
  grid.appendChild(el('<div class="hd" style="justify-content:center">план</div>'));
  grid.appendChild(el('<div class="hd" style="justify-content:center">факт</div>'));

  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    grid.appendChild(el('<div class="trow">'+esc(t.name)+"</div>"));
    for(var i=0;i<n+2;i++)grid.appendChild(el('<div class="spacer"></div>'));
    us.forEach(function(u){
      var md=mdoc(u),s=unitStats(u);
      grid.appendChild(el('<div class="name" title="'+esc(u.name+(u.parent?" — "+u.parent:""))+'">'+esc(u.name)+"</div>"));
      for(var d=1;d<=n;d++){
        var st=dayStatus(u,ym,d,md);
        var b=document.createElement("button");
        b.type="button";
        b.className="cell"+(st!=="none"?" "+CLS[st]:"");
        b.textContent=MARK[st]||"";
        b.title=u.name+", "+d+" "+MONTHS_IN[ymParts(ym).m-1];
        b.setAttribute("data-u",u.id);b.setAttribute("data-d",d);
        b.onclick=onCell;
        grid.appendChild(b);
      }
      grid.appendChild(el('<div class="sum">'+fmtNum(s.plan)+"</div>"));
      grid.appendChild(el('<div class="sum" style="color:var(--ok)">'+fmtNum(s.paidLessons)+"</div>"));
    });
  });
  scroll.appendChild(grid);
  card.appendChild(scroll);
  wrap.appendChild(card);

  var noWd=[];
  for(var k in state.units){var u2=state.units[k];if(u2.active!==false&&!(u2.weekdays||[]).length)noWd.push(u2.name);}
  if(noWd.length)wrap.appendChild(el('<div class="card"><p class="warnbox" style="border-bottom:0;border-radius:var(--r)">'+
    'Без дней недели, поэтому план не строится: '+esc(noWd.join(", "))+
    '. Задайте дни в справочнике «Ученики».</p></div>'));
  return wrap;
}
function onCell(ev){
  var uid=ev.currentTarget.getAttribute("data-u"),d=+ev.currentTarget.getAttribute("data-d");
  var u=state.units[uid];if(!u)return;
  var md=mdoc(u),cur=dayStatus(u,state.ym,d,md);
  var isPlanDay=planDays(u,state.ym).indexOf(d)>=0;
  var order=isPlanDay?STATUS_ORDER_PLAN:STATUS_ORDER_FREE;
  var i=order.indexOf(cur);if(i<0)i=0;
  var next=order[(i+1)%order.length];
  var patch={};
  patch[String(d)]=(next==="plan"||next==="none")?null:next;
  saveMonth(u,{days:patch});
}
function confirmPast(){
  var ym=state.ym,today=new Date(),n=daysIn(ym);
  var lim=(ymOf(today)===ym)?today.getDate():(ym<ymOf(today)?n:0);
  if(!lim){toast("Месяц ещё не начался");return;}
  var count=0;
  for(var k in state.units){
    var u=state.units[k];if(u.active===false)continue;
    var md=mdoc(u),patch={},any=false;
    planDays(u,ym).forEach(function(d){
      if(d>lim)return;
      if(!(md.days||{})[String(d)]){patch[String(d)]="done";any=true;count++;}
    });
    if(any)saveMonth(u,{days:patch});
  }
  toast(count?"Отмечено занятий: "+count:"Нечего подтверждать");
}

/* ---------- экран: расписание ---------- */
function viewSchedule(){
  var ym=state.ym,n=daysIn(ym),today=new Date();
  var todayDay=(ymOf(today)===ym)?today.getDate():0;
  var wrap=el('<div class="card"><div class="chead"><h2>Расписание на '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Только дни, в которые есть занятия</span></div></div>');
  var list=el('<div class="daylist"></div>');
  var any=false;
  for(var d=1;d<=n;d++){
    var items=[];
    for(var k in state.units){
      var u=state.units[k];if(u.active===false)continue;
      var st=dayStatus(u,ym,d,mdoc(u));
      if(st==="none"||st==="off")continue;
      items.push({u:u,st:st});
    }
    if(!items.length)continue;
    any=true;
    items.sort(function(a,b){
      var ta=state.teachers[a.u.teacherId]||{},tb2=state.teachers[b.u.teacherId]||{};
      return(ta.order||99)-(tb2.order||99)||String(a.u.name).localeCompare(String(b.u.name),"ru");
    });
    var w=dowOf(ym,d);
    var card=el('<div class="day'+(d===todayDay?" today":"")+'"><div class="dh"><span>'+d+" "+
      MONTHS_IN[ymParts(ym).m-1]+"</span><em>"+DOW[w-1]+(d===todayDay?" · сегодня":"")+"</em></div></div>");
    var ul=document.createElement("ul");
    items.forEach(function(it){
      var t=state.teachers[it.u.teacherId]||{};
      var badge=it.st==="done"?'<span class="pill ok">провед.</span>':
                it.st==="pc"?'<span class="pill warn">отм. с опл.</span>':
                it.st==="c"?'<span class="pill bad">отменено</span>':'<span class="pill mute">план</span>';
      ul.appendChild(el("<li><b>"+esc(it.u.name)+'</b> <span class="who">'+esc(t.name||"")+"</span> "+badge+"</li>"));
    });
    card.appendChild(ul);
    list.appendChild(card);
  }
  if(!any)list.appendChild(el('<div class="day empty">В этом месяце занятий нет. Задайте дни недели в справочнике или отметьте занятия в журнале.</div>'));
  wrap.appendChild(list);
  return wrap;
}

/* ---------- экран: абонементы и оплаты ---------- */
function viewMoney(){
  var wrap=el('<div class="stack"></div>');
  var nextLbl=ymLabel(ymShift(state.ym,1));

  var cardIn=el('<div class="card"><div class="chead"><h2>Абонементы родителей на '+esc(ymLabel(state.ym))+'</h2>'+
    '<span class="hint">Занятий к оплате = план месяца минус перенос с прошлого</span></div><div class="tscroll"></div></div>');
  var t1=el('<table><thead><tr>'+
    '<th>Ученик</th><th>Родитель</th><th class="r">План</th><th class="r">Перенос</th>'+
    '<th class="r">К оплате зан.</th><th class="r">Цена</th><th class="r">Скидка, %</th><th class="r">Абонемент</th>'+
    '<th class="r">Оплачено</th><th>Дата</th><th></th><th class="r">Остаток</th>'+
    '<th class="nowrap">Перенести в '+esc(nextLbl)+'</th>'+
    "</tr></thead><tbody></tbody></table>");
  var b1=t1.querySelector("tbody");
  var T={charge:0,amount:0,lessons:0};
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    b1.appendChild(el('<tr class="grp"><td colspan="13">'+esc(t.name)+"</td></tr>"));
    us.forEach(function(u){
      var s=unitStats(u);
      paySlots(u).forEach(function(sl){
        var d=slotData(u,sl);
        T.charge+=d.charge;T.amount+=d.amount;T.lessons+=d.lessons;
        var tr=document.createElement("tr");
        tr.appendChild(el("<td>"+esc(sl.name)+(u.kind==="group"?' <span class="sub">'+esc(u.name)+"</span>":"")+"</td>"));
        tr.appendChild(el("<td>"+esc(sl.parent||"—")+"</td>"));
        tr.appendChild(el('<td class="r sub">'+fmtNum(d.plan)+"</td>"));
        tr.appendChild(numCell(u,sl,"carry",d.carry,1,60));
        tr.appendChild(numCell(u,sl,"lessons",d.lessons,1,66));
        tr.appendChild(numCell(u,sl,"price",d.price,50,86));
        tr.appendChild(numCell(u,sl,"discount",d.discount,1,68));
        tr.appendChild(el('<td class="r"><b>'+esc(fmtMoney(d.charge))+"</b></td>"));
        tr.appendChild(numCell(u,sl,"amount",d.amount,100,96));
        var tdDt=document.createElement("td");
        var dt=document.createElement("input");dt.type="date";dt.className="dt";
        dt.id="dt-"+u.id+"-"+sl.key;dt.value=d.date;
        dt.onchange=function(){saveSlot(u,sl.key,{date:dt.value});};
        tdDt.appendChild(dt);tr.appendChild(tdDt);
        var tdB=document.createElement("td");
        var bt=el('<button class="btn sm" type="button">Оплачено</button>');
        bt.onclick=function(){saveSlot(u,sl.key,{amount:d.charge,date:new Date().toISOString().slice(0,10)});};
        if(!d.charge||d.amount>=d.charge)bt.disabled=true;
        tdB.appendChild(bt);tr.appendChild(tdB);
        var leftCell;
        if(!d.charge)leftCell='<span class="pill mute">не начислено</span>';
        else if(d.left>0)leftCell='<span class="pill warn">'+esc(fmtMoney(d.left))+"</span>";
        else if(d.left<0)leftCell='<span class="pill ok">переплата '+esc(fmtMoney(-d.left))+"</span>";
        else leftCell='<span class="pill ok">оплачено</span>';
        tr.appendChild(el('<td class="r nowrap">'+leftCell+"</td>"));
        /* перенос в следующий месяц */
        var tdC=document.createElement("td");
        var wrapC=el('<div class="btnrow" style="flex-wrap:nowrap"></div>');
        var ci=document.createElement("input");ci.type="number";ci.min="0";ci.max="31";ci.className="amt";
        ci.style.width="52px";ci.id="cf-"+u.id+"-"+sl.key;
        var miss=Math.max(0,d.lessons-s.paidLessons);
        ci.value=miss||"";
        ci.placeholder="0";
        var cb=el('<button class="btn sm" type="button">Перенести</button>');
        cb.onclick=function(){
          var k=+ci.value||0;
          if(!k){toast("Укажите количество занятий");return;}
          carryForward(u,sl.key,k);
        };
        wrapC.appendChild(ci);wrapC.appendChild(cb);
        tdC.appendChild(wrapC);tr.appendChild(tdC);
        b1.appendChild(tr);
        var sub=[d.pkg?"абонемент «"+d.pkg.name+"»":"",d.note].filter(Boolean).join(" · ");
        if(sub)b1.appendChild(el('<tr><td colspan="13" class="sub" style="padding-left:22px">'+esc(sub)+"</td></tr>"));
      });
    });
  });
  b1.appendChild(el('<tr class="tot"><td colspan="4">Итого</td><td class="r">'+fmtNum(T.lessons)+
    '</td><td colspan="2"></td><td class="r">'+esc(fmtMoney(T.charge))+'</td><td class="r">'+esc(fmtMoney(T.amount))+
    '</td><td colspan="2"></td><td class="r">'+esc(fmtMoney(T.charge-T.amount))+"</td><td></td></tr>"));
  cardIn.querySelector(".tscroll").appendChild(t1);
  wrap.appendChild(cardIn);

  /* выплаты педагогам */
  var cardOut=el('<div class="card"><div class="chead"><h2>Выплаты педагогам</h2>'+
    '<span class="hint">По проведённым занятиям; сверяется с суммой, которую назвал педагог</span></div><div class="tscroll"></div></div>');
  var t2=el('<table><thead><tr><th>Педагог</th><th class="r">Провед.</th><th class="r">По ставкам</th>'+
    '<th class="r">Запросил</th><th class="r">Разница</th><th class="r">Выплачено</th><th>Дата</th><th></th><th>Реквизиты</th>'+
    "</tr></thead><tbody></tbody></table>");
  var b2=t2.querySelector("tbody");
  var sumRate=0,sumPaid=0;
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    var lessons=0,payout=0;
    us.forEach(function(u){var s=unitStats(u);lessons+=s.paidLessons;payout+=s.payout;});
    var pd=payoutDoc(t.id),req=+pd.requested||0,paid=+pd.paid||0;
    sumRate+=payout;sumPaid+=paid;
    var tr=el('<tr><td>'+esc(t.name)+'</td><td class="r">'+fmtNum(lessons)+
      '</td><td class="r"><b>'+esc(fmtMoney(payout))+"</b></td></tr>");
    tr.appendChild(payoutCell(t,"requested",req,96));
    var diff=req?req-payout:0;
    tr.appendChild(el('<td class="r">'+(req?(Math.abs(diff)<1?'<span class="pill ok">совпало</span>':
      '<span class="pill bad">'+(diff>0?"+":"")+esc(fmtMoney(diff))+"</span>"):'<span class="sub">—</span>')+"</td>"));
    tr.appendChild(payoutCell(t,"paid",paid,96));
    var tdDt=document.createElement("td");
    var dt=document.createElement("input");dt.type="date";dt.className="dt";dt.id="pdt-"+t.id;dt.value=pd.paidDate||"";
    dt.onchange=function(){savePayout(t.id,{paidDate:dt.value});};
    tdDt.appendChild(dt);tr.appendChild(tdDt);
    var tdB=document.createElement("td");
    var bt=el('<button class="btn sm" type="button">Выплатила</button>');
    bt.onclick=function(){savePayout(t.id,{paid:req||payout,paidDate:new Date().toISOString().slice(0,10)});};
    if(!payout&&!req)bt.disabled=true;
    tdB.appendChild(bt);tr.appendChild(tdB);
    var bits=[t.bank,t.recipient,t.phone,t.card,t.account].filter(Boolean).join(" · ");
    tr.appendChild(el('<td class="sub" style="max-width:250px">'+esc(bits||"не заданы")+
      (t.purpose?'<br><span class="pill warn">'+esc(t.purpose)+"</span>":"")+"</td>"));
    b2.appendChild(tr);
    if(t.note||pd.note)b2.appendChild(el('<tr><td colspan="9" class="sub" style="padding-left:22px">'+
      esc([t.note,pd.note].filter(Boolean).join(" · "))+"</td></tr>"));
  });
  b2.appendChild(el('<tr class="tot"><td colspan="2">Итого</td><td class="r">'+esc(fmtMoney(sumRate))+
    '</td><td colspan="2"></td><td class="r">'+esc(fmtMoney(sumPaid))+'</td><td colspan="3"></td></tr>'));
  cardOut.querySelector(".tscroll").appendChild(t2);
  wrap.appendChild(cardOut);
  return wrap;
}
function numCell(u,sl,field,value,step,width){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.min="0";i.step=String(step);i.className="amt";
  i.style.width=width+"px";i.id="sl-"+field+"-"+u.id+"-"+sl.key;
  i.value=value===0&&field==="amount"?"":value;
  i.onchange=function(){
    var p={};p[field]=+i.value||0;
    if(field==="amount"&&(+i.value||0)>0){
      var cur=slotData(u,sl);if(!cur.date)p.date=new Date().toISOString().slice(0,10);
    }
    saveSlot(u,sl.key,p);
  };
  td.appendChild(i);return td;
}
function payoutCell(t,field,value,width){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.min="0";i.step="100";i.className="amt";i.style.width=width+"px";
  i.id="po-"+field+"-"+t.id;i.value=value||"";
  i.onchange=function(){
    var p={};p[field]=+i.value||0;
    if(field==="paid"&&(+i.value||0)>0&&!payoutDoc(t.id).paidDate)p.paidDate=new Date().toISOString().slice(0,10);
    savePayout(t.id,p);
  };
  td.appendChild(i);return td;
}

/* ---------- экран: справочники ---------- */
var REF_BLOCKS=[
  {id:"teachers",label:"Учителя"},
  {id:"students",label:"Ученики"},
  {id:"groups",label:"Группы"},
  {id:"tariffs",label:"Тарифы клиентам"},
  {id:"rates",label:"Тарифы педагогов"},
  {id:"packages",label:"Абонементы"}
];
function viewRef(){
  var wrap=el('<div class="stack"></div>');
  var nav=el('<div class="refnav"></div>');
  REF_BLOCKS.forEach(function(b){
    var btn=el('<button type="button">'+esc(b.label)+"</button>");
    if(state.ref===b.id)btn.setAttribute("aria-current","true");
    btn.onclick=function(){state.ref=b.id;try{localStorage.setItem("oe.ref",b.id);}catch(e){}render();};
    nav.appendChild(btn);
  });
  wrap.appendChild(nav);
  var fn={teachers:refTeachers,students:refStudents,groups:refGroups,
          tariffs:refTariffs,rates:refRates,packages:refPackages}[state.ref||"teachers"];
  wrap.appendChild((fn||refTeachers)());
  return wrap;
}
/* сворачивающиеся блоки */
function openMap(){return state.open||(state.open={});}
function isOpen(id){return !!openMap()[id];}
function toggleOpen(id){
  var o=openMap();
  if(o[id])delete o[id];else o[id]=1;
  try{localStorage.setItem("oe.open",JSON.stringify(o));}catch(e){}
  render();
}
function acc(id,title,meta,build,cls){
  var box=el('<div class="acc'+(cls?" "+cls:"")+'"></div>');
  var head=document.createElement("button");
  head.type="button";head.className="acchead";head.id="acc-"+id;
  head.setAttribute("aria-expanded",isOpen(id)?"true":"false");
  head.appendChild(el('<span class="accarrow" aria-hidden="true"></span>'));
  head.appendChild(el('<span class="acctitle">'+title+"</span>"));
  if(meta)head.appendChild(el('<span class="accmeta">'+meta+"</span>"));
  head.onclick=function(){toggleOpen(id);};
  box.appendChild(head);
  if(isOpen(id)){
    var body=el('<div class="accbody"></div>');
    body.appendChild(build());
    box.appendChild(body);
  }
  return box;
}
function wdText(u){
  var wd=(u.weekdays||[]);
  return wd.length?wd.map(function(d){return DOW[d-1];}).join(", "):"дни не заданы";
}
function refTeachers(){
  var c=el('<div class="card"><div class="chead"><h2>Учителя</h2>'+
    '<span class="hint">Реквизиты подставляются в выплаты</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref");
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);
    var solo=us.filter(function(u){return u.kind==="solo";}).length;
    var grp=us.filter(function(u){return u.kind==="group";}).length;
    var meta=[solo?solo+" уч.":"",grp?grp+" гр.":"",t.bank||""].filter(Boolean).join(" · ");
    h.appendChild(acc("t:"+t.id,esc(t.name),esc(meta),function(){return teacherRow(t);}));
  });
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить учителя</button>');
  add.onclick=addTeacher;h.appendChild(add);
  return c;
}
function soloUnits(){
  var a=[];
  for(var k in state.units){
    var u=state.units[k];
    if(u.kind==="solo"&&u.active!==false)a.push(u);
  }
  a.sort(function(x,y){return String(x.name).localeCompare(String(y.name),"ru");});
  return a;
}
function refStudents(){
  var c=el('<div class="card"><div class="chead"><h2>Ученики</h2>'+
    '<span class="hint">В карточке задаются учитель, абонемент и дни недели</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref");
  var list=soloUnits();
  list.forEach(function(u){
    var t=state.teachers[u.teacherId]||{};
    var meta=[t.name||"учитель не выбран",u.pkg||"абонемент не выбран",u.parent||"",wdText(u)]
      .filter(Boolean).join(" · ");
    h.appendChild(acc("u:"+u.id,esc(u.name),esc(meta),function(){return unitRow(u);}));
  });
  if(!list.length)h.appendChild(el('<p class="sub" style="margin:0">Пока ни одного ученика.</p>'));
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить ученика</button>');
  add.onclick=function(){addUnit("solo");};h.appendChild(add);
  return c;
}
function refGroups(){
  var c=el('<div class="card"><div class="chead"><h2>Группы</h2>'+
    '<span class="hint">У каждого ученика в группе своя цена занятия</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref");
  teacherList().forEach(function(t){
    var us=unitsOf(t.id).filter(function(u){return u.kind==="group";});
    if(!us.length)return;
    h.appendChild(acc("tg:"+t.id,esc(t.name),us.length+" гр.",function(){
      var box=el('<div class="accinner"></div>');
      us.forEach(function(u){
        var meta=[members(u).length+" чел.",wdText(u)].join(" · ");
        box.appendChild(acc("g:"+u.id,esc(u.name),esc(meta),function(){return unitRow(u);},"sub-acc"));
      });
      return box;
    },"acc-group"));
  });
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить группу</button>');
  add.onclick=function(){addUnit("group");};h.appendChild(add);
  return c;
}
function refTariffs(){
  var c=el('<div class="card"><div class="chead"><h2>Тарифы клиентам</h2>'+
    '<span class="hint">Цена одного занятия для ученика</span></div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Название</th><th class="r">Минут</th><th class="r">Цена занятия</th><th></th></tr></thead><tbody></tbody></table>');
  var tb=tbl.querySelector("tbody");
  tariffs().forEach(function(x,i){
    var tr=document.createElement("tr");
    tr.appendChild(settingCell("tariffs",i,"name",x.name,"text",230));
    tr.appendChild(settingCell("tariffs",i,"minutes",x.minutes,"number",70));
    tr.appendChild(settingCell("tariffs",i,"price",x.price,"number",96));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){var l=tariffs().slice();l.splice(i,1);saveSettingList("tariffs",l);};
    td.appendChild(rm);tr.appendChild(td);
    tb.appendChild(tr);
  });
  var trAdd=el('<tr><td colspan="4"></td></tr>');
  var add=el('<button class="btn sm" type="button">Добавить тариф</button>');
  add.onclick=function(){saveSettingList("tariffs",tariffs().concat([{name:"Новый тариф",minutes:45,price:2000}]));};
  trAdd.firstChild.appendChild(add);tb.appendChild(trAdd);
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}
function refRates(){
  var c=el('<div class="card"><div class="chead"><h2>Тарифы педагогов</h2>'+
    '<span class="hint">Сколько школа платит педагогу за одно занятие</span></div></div>');
  var b=baseRates();
  var box=el('<div class="ref"></div>');
  box.appendChild(el('<h3 class="refh">Базовые ставки</h3>'));
  var f=el('<div class="fields"></div>');
  [["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]].forEach(function(pr){
    var lab=el('<label class="f">'+esc(pr[1])+", ₽</label>");
    var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="50";
    inp.id="br-"+pr[0];inp.value=b[pr[0]]||0;
    inp.onchange=function(){
      var nb=Object.assign({},baseRates());nb[pr[0]]=+inp.value||0;
      saveSettingList("baseRates",nb);
    };
    lab.appendChild(inp);f.appendChild(lab);
  });
  box.appendChild(f);
  box.appendChild(el('<h3 class="refh">Личные ставки</h3>'));
  box.appendChild(el('<p class="sub" style="margin:0">Пусто — значит действует базовая ставка. Ставка конкретного ученика важнее личной.</p>'));
  var f2=el('<div class="fields"></div>');
  teacherList().forEach(function(t){
    var lab=el('<label class="f">'+esc(t.name)+", ₽</label>");
    var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="50";
    inp.id="tr-"+t.id;inp.value=(t.rates||{}).individual||"";
    inp.placeholder=String(b.individual||0);
    inp.onchange=function(){
      var r=Object.assign({},t.rates||{});
      if(+inp.value)r.individual=+inp.value;else delete r.individual;
      saveTeacher(t.id,{rates:r});
    };
    lab.appendChild(inp);f2.appendChild(lab);
  });
  box.appendChild(f2);
  c.appendChild(box);
  return c;
}
function tariffPrice(name){
  var t=tariffs().filter(function(x){return x.name===name;})[0];
  return t?(+t.price||0):0;
}
function packageTotal(x){
  var price=tariffPrice(x.tariff),gross=(+x.lessons||0)*price;
  return Math.round(gross-gross*(+x.discount||0)/100);
}
function refPackages(){
  var c=el('<div class="card"><div class="chead"><h2>Абонементы</h2>'+
    '<span class="hint">Стоимость = количество занятий × стоимость урока минус скидка</span>'+
    '</div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Название</th><th>Вид занятий</th><th class="r">Количество занятий</th>'+
    '<th class="r">Стоимость урока</th><th class="r">Скидка, %</th>'+
    '<th class="r">Стоимость абонемента</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody");
  var list=packages();
  list.forEach(function(x,i){
    var tr=document.createElement("tr");
    tr.appendChild(settingCell("packages",i,"name",x.name,"text",210));
    tr.appendChild(settingSelect("packages",i,"tariff",x.tariff,
      [["","— выбрать —"]].concat(tariffs().map(function(t){return[t.name,t.name];}))));
    tr.appendChild(settingCell("packages",i,"lessons",x.lessons,"number",80));
    var price=tariffPrice(x.tariff);
    tr.appendChild(el('<td class="r sub">'+(x.tariff?esc(fmtMoney(price)):"—")+"</td>"));
    tr.appendChild(settingCell("packages",i,"discount",x.discount,"number",72));
    tr.appendChild(el('<td class="r"><b>'+esc(fmtMoney(packageTotal(x)))+"</b></td>"));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){var l=packages().slice();l.splice(i,1);saveSettingList("packages",l);};
    td.appendChild(rm);tr.appendChild(td);
    tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="7" class="sub">Пока ни одного абонемента.</td></tr>'));
  var trAdd=el('<tr><td colspan="7"></td></tr>');
  var add=el('<button class="btn sm" type="button">Добавить абонемент</button>');
  add.onclick=function(){
    saveSettingList("packages",packages().concat([{name:"",tariff:"",lessons:8,discount:0}]));
  };
  trAdd.firstChild.appendChild(add);tb.appendChild(trAdd);
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}
function settingSelect(listName,idx,field,value,opts){
  var td=document.createElement("td");
  var sel=document.createElement("select");
  sel.id="st-"+listName+"-"+idx+"-"+field;
  opts.forEach(function(o){
    var op=document.createElement("option");op.value=o[0];op.textContent=o[1];
    if(String(o[0])===String(value||""))op.selected=true;
    sel.appendChild(op);
  });
  sel.onchange=function(){
    var l=(state.settings[listName]||[]).slice();
    l[idx]=Object.assign({},l[idx]);l[idx][field]=sel.value;
    saveSettingList(listName,l);
  };
  td.appendChild(sel);return td;
}
function settingCell(listName,idx,field,value,type,width){
  var td=document.createElement("td");
  if(type==="number")td.className="r";
  var i=document.createElement("input");
  i.type=type;i.style.width=width+"px";i.id="st-"+listName+"-"+idx+"-"+field;
  if(type==="number"){i.min="0";i.step="1";i.className="amt";}
  i.value=value==null?"":value;
  i.onchange=function(){
    var l=(state.settings[listName]||[]).slice();
    l[idx]=Object.assign({},l[idx]);
    l[idx][field]=type==="number"?(+i.value||0):i.value;
    saveSettingList(listName,l);
  };
  td.appendChild(i);return td;
}
function saveSettingList(name,value){
  if(!needWrite())return Promise.resolve();
  var next=Object.assign({},state.settings);next[name]=value;
  state.settings=next;render();
  return API.saveSettings(next).catch(saveFailed);
}
function wdPicker(u){
  var box=el('<div class="wd"></div>');
  DOW.forEach(function(name,i){
    var d=i+1;
    var b=el('<button type="button">'+name+"</button>");
    b.setAttribute("aria-pressed",(u.weekdays||[]).indexOf(d)>=0?"true":"false");
    b.onclick=function(){
      var wd=(u.weekdays||[]).slice(),k=wd.indexOf(d);
      if(k>=0)wd.splice(k,1);else wd.push(d);
      wd.sort(function(a,b2){return a-b2;});
      saveUnit(u.id,{weekdays:wd});
    };
    box.appendChild(b);
  });
  return box;
}
function field(label,id,value,type,onchange,opts){
  var lab=el('<label class="f">'+esc(label)+"</label>");
  var inp;
  if(opts){
    inp=document.createElement("select");
    opts.forEach(function(o){
      var op=document.createElement("option");op.value=o[0];op.textContent=o[1];
      if(String(o[0])===String(value))op.selected=true;
      inp.appendChild(op);
    });
  }else{
    inp=document.createElement("input");inp.type=type||"text";
    if(type==="number"){inp.min="0";inp.step="50";}
    inp.value=value==null?"":value;
  }
  inp.id=id;
  inp.onchange=function(){onchange(type==="number"?(+inp.value||0):inp.value);};
  lab.appendChild(inp);
  return lab;
}
function unitRow(u){
  var row=el('<div class="refrow"></div>');
  var top=el('<div class="top"><span class="pill mute">'+
    (u.kind==="group"?"группа":"индивидуально")+"</span></div>");
  var del=el('<button class="btn sm" type="button" style="margin-left:auto">В архив</button>');
  del.onclick=function(){saveUnit(u.id,{active:false});toast("Перенесено в архив");};
  top.appendChild(del);row.appendChild(top);
  var f=el('<div class="fields"></div>');
  f.appendChild(field("Имя","u-name-"+u.id,u.name,"text",function(v){saveUnit(u.id,{name:v});}));
  if(u.kind==="solo"){
    f.appendChild(field("Родитель","u-par-"+u.id,u.parent,"text",function(v){saveUnit(u.id,{parent:v});}));
    f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
      [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
    f.appendChild(field("Абонемент","u-pkg-"+u.id,u.pkg||"",null,function(v){saveUnit(u.id,{pkg:v});},
      [["","— без абонемента —"]].concat(packages().map(function(x){
        return[x.name,x.name+" · "+(x.lessons||0)+" зан. · "+fmtMoney(packageTotal(x))];}))));
    f.appendChild(field("Цена занятия, ₽","u-price-"+u.id,u.price,"number",function(v){saveUnit(u.id,{price:v});}));
  }
  if(u.kind==="group"){
    f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,
      function(v){saveUnit(u.id,{teacherId:v});},
      [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
    f.appendChild(field("Формат","u-f-"+u.id,u.format,null,function(v){saveUnit(u.id,{format:v});},
      [["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]]));
    f.appendChild(field("Ставка педагога, ₽","u-rate-"+u.id,u.rate,"number",function(v){saveUnit(u.id,{rate:v});}));
    f.appendChild(field("Заметка","u-note-"+u.id,u.note,"text",function(v){saveUnit(u.id,{note:v});}));
  }
  row.appendChild(f);
  var wdlab=el('<label class="f">Дни недели</label>');
  wdlab.appendChild(wdPicker(u));
  row.appendChild(wdlab);
  if(u.kind==="group"){
    var ml=el('<label class="f">Состав группы и цена занятия с каждого</label>');
    var mems=el('<div class="mems"></div>');
    (u.members||[]).forEach(function(m,idx){
      var mr=el('<div class="mem"></div>');
      var n1=document.createElement("input");n1.id="m-n-"+u.id+"-"+m.id;n1.value=m.name||"";n1.placeholder="Ученик";
      n1.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{name:n1.value});saveUnit(u.id,{members:ms});};
      var n2=document.createElement("input");n2.id="m-p-"+u.id+"-"+m.id;n2.value=m.parent||"";n2.placeholder="Родитель";
      n2.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{parent:n2.value});saveUnit(u.id,{members:ms});};
      var n3=document.createElement("input");n3.id="m-pr-"+u.id+"-"+m.id;n3.type="number";n3.min="0";n3.step="50";
      n3.className="amt";n3.value=m.price||0;
      n3.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{price:+n3.value||0});saveUnit(u.id,{members:ms});};
      var rm=el('<button class="btn sm" type="button">Убрать</button>');
      rm.onclick=function(){var ms=(u.members||[]).slice();ms.splice(idx,1);saveUnit(u.id,{members:ms});};
      mr.appendChild(n1);mr.appendChild(n2);mr.appendChild(n3);mr.appendChild(rm);
      mems.appendChild(mr);
      if(m.note)mems.appendChild(el('<div class="sub" style="margin-top:-2px">'+esc(m.note)+"</div>"));
    });
    var addRow=el('<div class="btnrow" style="margin-top:2px"></div>');
    var have={};(u.members||[]).forEach(function(m){have[(m.name||"").trim().toLowerCase()]=1;});
    var pool=[];
    for(var sk in state.units){
      var su=state.units[sk];
      if(su.kind!=="solo"||su.active===false)continue;
      if(have[(su.name||"").trim().toLowerCase()])continue;
      pool.push(su);
    }
    pool.sort(function(a,b){return String(a.name).localeCompare(String(b.name),"ru");});
    var pick=document.createElement("select");
    pick.id="gp-"+u.id;
    var op0=document.createElement("option");op0.value="";op0.textContent="Добавить из списка учеников";
    pick.appendChild(op0);
    pool.forEach(function(su){
      var t2=state.teachers[su.teacherId]||{};
      var o=document.createElement("option");o.value=su.id;
      o.textContent=su.name+(su.parent?" — "+su.parent:"")+(t2.name?" · "+t2.name:"");
      pick.appendChild(o);
    });
    pick.onchange=function(){
      var su=state.units[pick.value];if(!su)return;
      var ms=(u.members||[]).slice();
      ms.push({id:newId("m"),name:su.name,parent:su.parent||"",price:+su.price||0,channel:su.channel||"",note:""});
      saveUnit(u.id,{members:ms});
      toast(su.name+" добавлен в «"+u.name+"»");
    };
    addRow.appendChild(pick);
    var am=el('<button class="btn sm" type="button">Новый ученик</button>');
    am.onclick=function(){
      var ms=(u.members||[]).slice();
      ms.push({id:newId("m"),name:"Новый ученик",parent:"",price:2000,channel:"",note:""});
      saveUnit(u.id,{members:ms});
    };
    addRow.appendChild(am);
    mems.appendChild(addRow);
    ml.appendChild(mems);row.appendChild(ml);
  }
  return row;
}
function teacherRow(t){
  var row=el('<div class="refrow"></div>');
  var f=el('<div class="fields"></div>');
  f.appendChild(field("ФИО","t-name-"+t.id,t.name,"text",function(v){saveTeacher(t.id,{name:v});}));
  f.appendChild(field("Банк","t-bank-"+t.id,t.bank,"text",function(v){saveTeacher(t.id,{bank:v});}));
  f.appendChild(field("Получатель","t-rec-"+t.id,t.recipient,"text",function(v){saveTeacher(t.id,{recipient:v});}));
  f.appendChild(field("Телефон","t-ph-"+t.id,t.phone,"text",function(v){saveTeacher(t.id,{phone:v});}));
  f.appendChild(field("Карта","t-card-"+t.id,t.card,"text",function(v){saveTeacher(t.id,{card:v});}));
  f.appendChild(field("Счёт","t-acc-"+t.id,t.account,"text",function(v){saveTeacher(t.id,{account:v});}));
  f.appendChild(field("БИК","t-bik-"+t.id,t.bik,"text",function(v){saveTeacher(t.id,{bik:v});}));
  f.appendChild(field("Назначение платежа","t-pur-"+t.id,t.purpose,"text",function(v){saveTeacher(t.id,{purpose:v});}));
  f.appendChild(field("Заметка","t-note-"+t.id,t.note,"text",function(v){saveTeacher(t.id,{note:v});}));
  row.appendChild(f);
  return row;
}
function addUnit(kind){
  if(!needWrite())return;
  var id=newId(kind==="group"?"g":"u"),tl=teacherList();
  var body={kind:kind,name:kind==="group"?"Новая группа":"Новый ученик",parent:"",
    teacherId:tl.length?tl[0].id:"",format:kind==="group"?"group":"individual",
    price:kind==="group"?0:2500,rate:1000,weekdays:[],note:"",active:true,
    order:900+Object.keys(state.units).length,channel:"",members:[]};
  state.units[id]=Object.assign({id:id},body);render();
  API.saveUnit(id,body).catch(saveFailed);
}
function addTeacher(){
  if(!needWrite())return;
  var id=newId("t");
  var body={name:"Новый педагог",order:100+teacherList().length,active:true,rates:{},
    bank:"",recipient:"",phone:"",card:"",account:"",bik:"",corr:"",inn:"",kpp:"",purpose:"",note:""};
  state.teachers[id]=Object.assign({id:id},body);render();
  API.saveTeacher(id,body).catch(saveFailed);
}

/* ---------- render ---------- */
var VIEWS={month:viewMonth,journal:viewJournal,schedule:viewSchedule,money:viewMoney,ref:viewRef};
function render(){
  renderTabs();
  var main=document.getElementById("main");
  var active=document.activeElement,aid=active&&active.id?active.id:null;
  var ss=active&&("selectionStart" in active)?active.selectionStart:null;
  var sx=window.scrollX,sy=window.scrollY;
  main.innerHTML="";
  if(state.err){main.appendChild(el('<div class="boot"><b>Данные недоступны</b>'+esc(state.err)+"</div>"));return;}
  if(!state.ready){main.appendChild(el('<div class="boot"><b>Загружаю данные</b>Секунду.</div>'));return;}
  if(!Object.keys(state.units).length){
    main.appendChild(el('<div class="card"><div class="boot"><b>Пока пусто</b>Добавьте педагогов и учеников в справочнике, задайте им дни недели — и план на месяц построится сам.</div></div>'));
    return;
  }
  try{main.appendChild(VIEWS[state.tab]());}
  catch(e){main.appendChild(el('<div class="boot"><b>Ошибка на этом экране</b>'+esc(String(e&&e.message||e))+"</div>"));}
  var sub=document.getElementById("h-sub");
  sub.textContent=session&&session.user?session.user.email:"";
  window.scrollTo(sx,sy);
  if(aid){var n=document.getElementById(aid);if(n&&n.focus){n.focus();if(ss!=null&&"setSelectionRange" in n){try{n.setSelectionRange(ss,ss);}catch(e){}}}}
}
/* ---------- Supabase ---------- */
var sb=null,session=null;

function num(v){return v==null?0:+v;}
function teacherFromRow(r){
  return{id:r.id,name:r.name||"",order:r.order_no,active:r.active!==false,rates:r.rates||{},
    bank:r.bank||"",recipient:r.recipient||"",phone:r.phone||"",card:r.card||"",account:r.account||"",
    bik:r.bik||"",corr:r.corr_account||"",inn:r.inn||"",kpp:r.kpp||"",purpose:r.purpose||"",note:r.note||""};
}
function teacherToRow(t){
  return{id:t.id,name:t.name||"",order_no:t.order==null?100:t.order,active:t.active!==false,
    rates:t.rates||{},bank:t.bank||"",recipient:t.recipient||"",phone:t.phone||"",card:t.card||"",
    account:t.account||"",bik:t.bik||"",corr_account:t.corr||"",inn:t.inn||"",kpp:t.kpp||"",
    purpose:t.purpose||"",note:t.note||""};
}
function unitFromRow(r){
  return{id:r.id,kind:r.kind||"solo",name:r.name||"",parent:r.parent||"",teacherId:r.teacher_id||"",
    format:r.format||"individual",price:num(r.price),rate:r.rate==null?undefined:num(r.rate),
    pkg:r.package_name||"",
    weekdays:(r.weekdays||[]).map(Number),members:r.members||[],channel:r.channel||"",
    note:r.note||"",active:r.active!==false,order:r.order_no};
}
function unitToRow(u){
  return{id:u.id,kind:u.kind||"solo",name:u.name||"",parent:u.parent||"",teacher_id:u.teacherId||"",
    format:u.format||"individual",price:num(u.price),rate:u.rate==null?null:num(u.rate),
    package_name:u.pkg||"",
    weekdays:(u.weekdays||[]).map(Number),members:u.members||[],channel:u.channel||"",
    note:u.note||"",active:u.active!==false,order_no:u.order==null?900:u.order};
}
function monthFromRow(r){
  return{unitId:r.unit_id,month:r.month,days:r.days||{},pay:r.pay||{},note:r.note||""};
}
function payoutFromRow(r){
  return{teacherId:r.teacher_id,month:r.month,requested:num(r.requested),paid:num(r.paid),
    paidDate:r.paid_date||"",status:r.status||"unpaid",note:r.note||""};
}
function oops(res){if(res.error)throw res.error;return res.data;}

var API={
  loadStatic:function(){
    return Promise.all([
      sb.from("oe_teachers").select("*").order("order_no",{ascending:true}),
      sb.from("oe_units").select("*").order("order_no",{ascending:true}),
      sb.from("oe_settings").select("*").maybeSingle()
    ]).then(function(r){
      var teachers={},units={};
      oops(r[0]).forEach(function(row){teachers[row.id]=teacherFromRow(row);});
      oops(r[1]).forEach(function(row){units[row.id]=unitFromRow(row);});
      var s=r[2].error?null:r[2].data;
      return{teachers:teachers,units:units,
        settings:s?{baseRates:s.base_rates||{},tariffs:s.tariffs||[],packages:s.packages||[]}:{}};
    });
  },
  loadMonth:function(ym){
    return Promise.all([
      sb.from("oe_months").select("*").eq("month",ym),
      sb.from("oe_payouts").select("*").eq("month",ym)
    ]).then(function(r){
      var months={},payouts={};
      oops(r[0]).forEach(function(row){months[row.month+"__"+row.unit_id]=monthFromRow(row);});
      oops(r[1]).forEach(function(row){payouts[row.month+"__"+row.teacher_id]=payoutFromRow(row);});
      return{months:months,payouts:payouts};
    });
  },
  saveMonth:function(m){
    return sb.from("oe_months").upsert({owner:session.user.id,unit_id:m.unitId,month:m.month,
      days:m.days||{},pay:m.pay||{},note:m.note||""},{onConflict:"owner,unit_id,month"}).then(oops);
  },
  savePayout:function(p){
    return sb.from("oe_payouts").upsert({owner:session.user.id,teacher_id:p.teacherId,month:p.month,
      requested:num(p.requested),paid:num(p.paid),paid_date:p.paidDate||null,
      status:p.status||"unpaid",note:p.note||""},{onConflict:"owner,teacher_id,month"}).then(oops);
  },
  saveUnit:function(id,u){
    var row=unitToRow(Object.assign({},u,{id:id}));row.owner=session.user.id;
    return sb.from("oe_units").upsert(row,{onConflict:"owner,id"}).then(oops);
  },
  saveTeacher:function(id,t){
    var row=teacherToRow(Object.assign({},t,{id:id}));row.owner=session.user.id;
    return sb.from("oe_teachers").upsert(row,{onConflict:"owner,id"}).then(oops);
  },
  saveSettings:function(s){
    return sb.from("oe_settings").upsert({owner:session.user.id,base_rates:s.baseRates||{},
      tariffs:s.tariffs||[],packages:s.packages||[]},{onConflict:"owner"}).then(oops);
  }
};

/* ---------- вход ---------- */
function authScreen(msg,kind){
  var box=el('<div class="authwrap"><div class="authcard">'+
    '<h2>Занятия и оплаты</h2>'+
    '<p class="authsub">Учёт занятий, оплат родителей и выплат педагогам онлайн-школы.</p>'+
    '</div></div>');
  var card=box.querySelector(".authcard");
  var form=document.createElement("form");
  form.className="authform";
  var email=el('<label class="f">Email</label>');
  var ei=document.createElement("input");ei.type="email";ei.id="auth-email";ei.required=true;ei.autocomplete="username";
  try{ei.value=localStorage.getItem("oe.email")||"";}catch(e){}
  email.appendChild(ei);
  var pass=el('<label class="f">Пароль</label>');
  var pi=document.createElement("input");pi.type="password";pi.id="auth-pass";pi.required=true;pi.autocomplete="current-password";pi.minLength=8;
  pass.appendChild(pi);
  form.appendChild(email);form.appendChild(pass);
  var row=el('<div class="btnrow" style="margin-top:4px"></div>');
  var inBtn=el('<button class="btn pri" type="submit">Войти</button>');
  var upBtn=el('<button class="btn" type="button">Создать вход</button>');
  row.appendChild(inBtn);row.appendChild(upBtn);
  form.appendChild(row);
  var note=el('<p class="authnote" role="status">'+(msg?esc(msg):"")+"</p>");
  if(kind)note.classList.add(kind);
  form.appendChild(note);
  function busy(on){inBtn.disabled=on;upBtn.disabled=on;}
  function fail(e){
    busy(false);
    var m=e&&(e.message||e.error_description)||"не удалось";
    if(/Invalid login credentials/i.test(m))m="Неверный email или пароль";
    if(/Email not confirmed/i.test(m))m="Email ещё не подтверждён — откройте письмо от Supabase и перейдите по ссылке";
    if(/already registered/i.test(m))m="Такой email уже зарегистрирован — нажмите «Войти»";
    note.className="authnote bad";note.textContent=m;
  }
  form.onsubmit=function(ev){
    ev.preventDefault();busy(true);
    try{localStorage.setItem("oe.email",ei.value);}catch(e){}
    sb.auth.signInWithPassword({email:ei.value,password:pi.value}).then(function(r){
      if(r.error)return fail(r.error);
      session=r.data.session;boot();
    },fail);
  };
  upBtn.onclick=function(){
    if(!ei.value||pi.value.length<8){
      note.className="authnote bad";
      note.textContent="Укажите email и пароль не короче 8 символов";
      return;
    }
    busy(true);
    sb.auth.signUp({email:ei.value,password:pi.value}).then(function(r){
      if(r.error)return fail(r.error);
      busy(false);
      if(r.data.session){session=r.data.session;boot();return;}
      note.className="authnote ok";
      note.textContent="Вход создан. Supabase отправил письмо на "+ei.value+" — перейдите по ссылке и возвращайтесь сюда.";
    },fail);
  };
  card.appendChild(form);
  var main=document.getElementById("main");
  main.innerHTML="";main.appendChild(box);
  document.getElementById("chrome").hidden=true;
  ei.focus();
}
function signOut(){
  sb.auth.signOut().then(function(){session=null;state.ready=false;authScreen("Вы вышли.");});
}

/* ---------- загрузка данных ---------- */
function reloadStatic(){
  return API.loadStatic().then(function(d){
    state.teachers=d.teachers;state.units=d.units;state.settings=d.settings;
    state.ready=true;render();
  },dataFailed);
}
function reloadMonth(){
  var ym=state.ym;
  return API.loadMonth(ym).then(function(d){
    for(var k in state.months){if(k.indexOf(ym+"__")===0)delete state.months[k];}
    for(var k2 in state.payouts){if(k2.indexOf(ym+"__")===0)delete state.payouts[k2];}
    Object.assign(state.months,d.months);
    Object.assign(state.payouts,d.payouts);
    state.ready=true;render();
  },dataFailed);
}
function dataFailed(e){
  var m=e&&(e.message||e.code)||"ошибка";
  if(/JWT|token|session/i.test(m)){session=null;authScreen("Сессия истекла, войдите заново.");return;}
  state.err="Не удалось получить данные: "+m;
  render();
}
function setMonth(ym){
  state.ym=ym;
  try{localStorage.setItem("oe.ym",ym);}catch(e){}
  render();
  reloadMonth();
}

/* ---------- запуск ---------- */
function boot(){
  document.getElementById("chrome").hidden=false;
  state.err=null;
  render();
  reloadStatic();
  reloadMonth();
}
function start(){
  var ym=null,tab=null;
  try{ym=localStorage.getItem("oe.ym");}catch(e){}
  try{tab=localStorage.getItem("oe.tab");}catch(e){}
  try{state.ref=localStorage.getItem("oe.ref")||state.ref;}catch(e){}
  try{state.open=JSON.parse(localStorage.getItem("oe.open")||"{}")||{};}catch(e){state.open={};}
  state.ym=ym&&/^\d{4}-\d{2}$/.test(ym)?ym:ymOf(new Date());
  if(tab&&VIEWS[tab])state.tab=tab;
  document.getElementById("m-prev").onclick=function(){setMonth(ymShift(state.ym,-1));};
  document.getElementById("m-next").onclick=function(){setMonth(ymShift(state.ym,1));};
  document.getElementById("m-today").onclick=function(){setMonth(ymOf(new Date()));};
  document.getElementById("signout").onclick=signOut;

  var cfg=window.OE_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||cfg.SUPABASE_URL.indexOf("__")===0){
    document.getElementById("chrome").hidden=true;
    document.getElementById("main").innerHTML=
      '<div class="boot"><b>Нет подключения к базе</b>Проверьте config.js и доступ к интернету.</div>';
    return;
  }
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,
    {auth:{persistSession:true,autoRefreshToken:true}});
  sb.auth.getSession().then(function(r){
    session=r&&r.data?r.data.session:null;
    if(session)boot();else authScreen("");
  },function(){authScreen("Не удалось проверить вход. Попробуйте ещё раз.");});
}
document.addEventListener("DOMContentLoaded",start);
})();
