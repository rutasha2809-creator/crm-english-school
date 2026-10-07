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
function fmtMoney(n){if(!n)return"0 ₽";return Math.round(n).toLocaleString("ru-RU").replace(/ /g," ")+" ₽";}
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
function byName(a,b){return String(a.name).localeCompare(String(b.name),"ru");}
/* Все ученики. Ученик состоит максимум в одной группе. */
function students(){
  var a=[];
  for(var k in state.units){var u=state.units[k];if(u.kind==="solo"&&u.active!==false)a.push(u);}
  a.sort(byName);return a;
}
function groups(){
  var a=[];
  for(var k in state.units){var u=state.units[k];if(u.kind==="group"&&u.active!==false)a.push(u);}
  a.sort(function(x,y){return(x.order||999)-(y.order||999)||byName(x,y);});
  return a;
}
function groupOf(u){
  if(!u||!u.groupId)return null;
  var g=state.units[u.groupId];
  return g&&g.active!==false?g:null;
}
function groupMembers(g){
  return(g.memberIds||[]).map(function(id){return state.units[id];})
    .filter(function(u){return u&&u.active!==false;}).sort(byName);
}
/* Ученик в группе наследует от неё учителя, дни недели и формат занятий. */
function effTeacherId(u){var g=groupOf(u);return g?g.teacherId:u.teacherId;}
function effWeekdays(u){var g=groupOf(u);return(g?g.weekdays:u.weekdays)||[];}
function effFormat(u){var g=groupOf(u);return g?(g.format||"group"):(u.format||"individual");}
/* Занятия у ученика в группе — это занятия самой группы. */
function lessonUnit(u){return groupOf(u)||u;}
/* Строки журнала и расписания: группы и ученики без группы. */
function scheduleUnits(){
  return groups().concat(students().filter(function(u){return !groupOf(u);}));
}
function studentsOfTeacher(tid){
  return students().filter(function(u){return effTeacherId(u)===tid;});
}
function baseRates(){return(state.settings.baseRates)||{individual:1000,mini:1500,group:1000};}
/* Ставка педагога живёт только в справочнике «Тарифы педагогов»:
   личная ставка учителя, иначе базовая ставка по формату занятия. */
function rateOf(lu){
  var fmt=lu.kind==="group"?(lu.format||"group"):effFormat(lu);
  var t=state.teachers[lu.kind==="group"?lu.teacherId:effTeacherId(lu)];
  if(t&&t.rates&&typeof t.rates[fmt]==="number")return t.rates[fmt];
  var b=baseRates();return b[fmt]||0;
}
function mdoc(u,ym){return state.months[(ym||state.ym)+"__"+u.id]||{days:{},pay:{}};}
function planDays(u,ym){
  var wd=u.kind==="group"?(u.weekdays||[]):effWeekdays(u),out=[];
  if(!wd.length)return out;
  for(var d=1;d<=daysIn(ym);d++){if(wd.indexOf(dowOf(ym,d))>=0)out.push(d);}
  return out;
}
/* Состояние дня: 'plan' | 'done' | 'pc' | 'c' | 'off' | 'none' */
function dayStatus(u,ym,day,md){
  var raw=(md.days||{})[String(day)];
  if(raw)return raw;
  return planDays(u,ym).indexOf(day)>=0?"plan":"none";
}
/* Статистика занятий учебной единицы (группы или ученика без группы). */
function unitStats(lu,ym){
  ym=ym||state.ym;
  var md=mdoc(lu,ym),n=daysIn(ym);
  var plan=0,done=0,pc=0,canc=0;
  for(var d=1;d<=n;d++){
    var s=dayStatus(lu,ym,d,md);
    if(s==="plan")plan++;
    else if(s==="done"){done++;plan++;}
    else if(s==="pc"){pc++;plan++;}
    else if(s==="c")canc++;
  }
  var paidLessons=done+pc,rate=rateOf(lu);
  return{plan:plan,done:done,pc:pc,canc:canc,paidLessons:paidLessons,
    rate:rate,payout:paidLessons*rate,md:md};
}
/* Занятия конкретного ученика — через его группу, если он в ней. */
function studentLessons(u,ym){return unitStats(lessonUnit(u),ym);}
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

/* ---------- абонементы и начисление ---------- */
function packages(){return state.settings.packages||[];}
function tariffs(){return state.settings.tariffs||[];}
function tariffPrice(name){
  var t=tariffs().filter(function(x){return x.name===name;})[0];
  return t?(+t.price||0):0;
}
function packageTotal(x){
  var price=tariffPrice(x.tariff),gross=(+x.lessons||0)*price;
  return Math.round(gross-gross*(+x.discount||0)/100);
}
function packageOf(u){
  if(!u.pkg)return null;
  var ps=packages().filter(function(x){return x.name===u.pkg;});
  return ps.length?ps[0]:null;
}
/* Начисление ученику: занятий к оплате × цена урока минус скидка.
   Значения по умолчанию берутся из привязанного абонемента. */
function billing(u,ym){
  ym=ym||state.ym;
  var rec=(mdoc(u,ym).pay||{}).solo||{};
  var plan=planDays(lessonUnit(u),ym).length;
  var pkg=packageOf(u);
  var carry=+rec.carry||0;
  var defLessons=Math.max(0,(pkg?(+pkg.lessons||0):plan)-carry);
  var lessons=rec.lessons==null?defLessons:(+rec.lessons||0);
  var defPrice=pkg&&pkg.tariff?tariffPrice(pkg.tariff):(+u.price||0);
  var price=rec.price==null?defPrice:(+rec.price||0);
  var discount=rec.discount==null?(pkg?(+pkg.discount||0):0):(+rec.discount||0);
  var gross=lessons*price,charge=Math.round(gross-gross*discount/100);
  var amount=+rec.amount||0;
  return{plan:plan,carry:carry,lessons:lessons,price:price,discount:discount,
    charge:charge,amount:amount,left:charge-amount,pkg:pkg,
    date:rec.date||"",note:rec.note||""};
}
function saveBilling(u,patch){
  var rec=Object.assign({},(mdoc(u).pay||{}).solo||{});
  Object.keys(patch).forEach(function(k){rec[k]=patch[k];});
  return saveMonth(u,{pay:{solo:rec}});
}
/* Перенос занятий в следующий месяц уменьшает его абонемент. */
function carryForward(u,count){
  if(!needWrite())return;
  var nextYm=ymShift(state.ym,1),id=nextYm+"__"+u.id;
  var cur=state.months[id]||{unitId:u.id,month:nextYm,days:{},pay:{}};
  var rec=Object.assign({},(cur.pay||{}).solo||{});
  rec.carry=(+rec.carry||0)+count;
  var pkg=packageOf(u);
  var base=pkg?(+pkg.lessons||0):planDays(lessonUnit(u),nextYm).length;
  rec.lessons=Math.max(0,base-rec.carry);
  var next={unitId:u.id,month:nextYm,days:Object.assign({},cur.days||{}),
            pay:Object.assign({},cur.pay||{},{solo:rec}),note:cur.note||""};
  state.months[id]=next;render();
  return API.saveMonth(next).then(function(){
    toast("Перенесено в "+ymLabel(nextYm)+": "+count+" зан.");
  },saveFailed);
}
function lessonUnitsOf(tid){
  return scheduleUnits().filter(function(lu){
    return(lu.kind==="group"?lu.teacherId:effTeacherId(lu))===tid;
  });
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
  var tot={lessons:0,charge:0,amount:0,done:0,payout:0,plan:0},rows=[],paidOut=0;
  teacherList().forEach(function(t){
    var sts=studentsOfTeacher(t.id),lus=lessonUnitsOf(t.id);
    if(!sts.length&&!lus.length)return;
    var sub={lessons:0,charge:0,amount:0,done:0,payout:0,plan:0},inner=[];
    sts.forEach(function(u){
      var b=billing(u);
      sub.lessons+=b.lessons;sub.charge+=b.charge;sub.amount+=b.amount;
      inner.push({u:u,b:b});
    });
    lus.forEach(function(lu){
      var s=unitStats(lu);
      sub.done+=s.paidLessons;sub.payout+=s.payout;sub.plan+=s.plan;
    });
    var pd=payoutDoc(t.id);paidOut+=+pd.paid||0;
    ["lessons","charge","amount","done","payout","plan"].forEach(function(k){tot[k]+=sub[k];});
    rows.push({t:t,sub:sub,inner:inner,pd:pd});
  });

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
    '<span class="hint">Начисление — по абонементу ученика; выплата педагогу — за проведённые занятия</span></div>'+
    '<div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Ученик</th><th>Группа</th><th class="r">Абонемент зан.</th><th class="r">Начислено</th>'+
    '<th class="r">Получено</th><th class="r">Остаток</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody");
  rows.forEach(function(r){
    var pd=r.pd,diff=(+pd.requested||0)-r.sub.payout,pill;
    if(r.sub.payout>0&&+pd.paid>=r.sub.payout)pill='<span class="pill ok">выплачено '+esc(fmtDate(pd.paidDate))+"</span>";
    else if(+pd.paid>0)pill='<span class="pill warn">частично '+esc(fmtMoney(pd.paid))+"</span>";
    else if(r.sub.payout>0)pill='<span class="pill bad">не выплачено</span>';
    else pill='<span class="pill mute">нет проведённых</span>';
    if(pd.requested&&Math.abs(diff)>=1)
      pill+=' <span class="pill warn">запрос '+esc(fmtMoney(pd.requested))+" ("+(diff>0?"+":"")+esc(fmtMoney(diff))+")</span>";
    tb.appendChild(el('<tr class="grp"><td colspan="2">'+esc(r.t.name)+
      ' <span class="sub">'+fmtNum(r.sub.done)+" провед. · к выплате "+esc(fmtMoney(r.sub.payout))+" "+pill+
      '</span></td><td class="r">'+fmtNum(r.sub.lessons)+'</td><td class="r">'+esc(fmtMoney(r.sub.charge))+
      '</td><td class="r">'+esc(fmtMoney(r.sub.amount))+'</td><td class="r">'+
      esc(fmtMoney(r.sub.charge-r.sub.amount))+"</td></tr>"));
    r.inner.forEach(function(x){
      var u=x.u,b=x.b,g=groupOf(u),leftCell;
      if(!b.charge)leftCell='<span class="pill mute">не начислено</span>';
      else if(b.left>0)leftCell='<span class="pill warn">'+esc(fmtMoney(b.left))+"</span>";
      else if(b.left<0)leftCell='<span class="pill ok">переплата '+esc(fmtMoney(-b.left))+"</span>";
      else leftCell='<span class="pill ok">оплачено</span>';
      tb.appendChild(el('<tr><td style="padding-left:22px">'+esc(u.name)+
        (u.parent?' <span class="sub">'+esc(u.parent)+"</span>":"")+
        (u.pkg?"":' <span class="pill mute">без абонемента</span>')+
        '</td><td class="sub">'+(g?esc(g.name):"—")+'</td><td class="r">'+fmtNum(b.lessons)+
        '</td><td class="r">'+esc(fmtMoney(b.charge))+'</td><td class="r">'+esc(fmtMoney(b.amount))+
        '</td><td class="r nowrap">'+leftCell+"</td></tr>"));
    });
  });
  tb.appendChild(el('<tr class="tot"><td colspan="2">Итого по школе</td><td class="r">'+fmtNum(tot.lessons)+
    '</td><td class="r">'+esc(fmtMoney(tot.charge))+'</td><td class="r">'+esc(fmtMoney(tot.amount))+
    '</td><td class="r">'+esc(fmtMoney(tot.charge-tot.amount))+"</td></tr>"));
  card.querySelector(".tscroll").appendChild(tbl);
  wrap.appendChild(card);
  return wrap;
}

/* ---------- экран: журнал ---------- */
function viewJournal(){
  var ym=state.ym,n=daysIn(ym);
  var wrap=el('<div class="stack"></div>');
  var card=el('<div class="card"><div class="chead"><h2>Журнал занятий за '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Клик по клетке меняет её состояние. Занятие группы отмечается один раз</span></div></div>');
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
  confirmBtn.onclick=confirmPast;btns.appendChild(confirmBtn);
  bar.appendChild(btns);card.appendChild(bar);

  var scroll=el('<div class="tscroll" style="padding:0 0 10px"></div>');
  var grid=el('<div class="jgrid"></div>');
  grid.style.gridTemplateColumns="172px repeat("+n+",28px) 52px 52px";
  grid.appendChild(el('<div class="hd name">Группа или ученик</div>'));
  for(var d=1;d<=n;d++){
    var w=dowOf(ym,d);
    grid.appendChild(el('<div class="hd'+(w>=6?" we":"")+'"><span>'+d+"</span><span>"+DOW[w-1]+"</span></div>"));
  }
  grid.appendChild(el('<div class="hd" style="justify-content:center">план</div>'));
  grid.appendChild(el('<div class="hd" style="justify-content:center">факт</div>'));

  teacherList().forEach(function(t){
    var lus=lessonUnitsOf(t.id);if(!lus.length)return;
    grid.appendChild(el('<div class="trow">'+esc(t.name)+"</div>"));
    for(var i=0;i<n+2;i++)grid.appendChild(el('<div class="spacer"></div>'));
    lus.forEach(function(lu){
      var md=mdoc(lu),s=unitStats(lu);
      var label=lu.kind==="group"?lu.name+" ("+groupMembers(lu).length+")":lu.name;
      grid.appendChild(el('<div class="name" title="'+esc(label)+'">'+esc(label)+"</div>"));
      for(var d=1;d<=n;d++){
        var st=dayStatus(lu,ym,d,md);
        var b=document.createElement("button");
        b.type="button";
        b.className="cell"+(st!=="none"?" "+CLS[st]:"");
        b.textContent=MARK[st]||"";
        b.title=label+", "+d+" "+MONTHS_IN[ymParts(ym).m-1];
        b.setAttribute("data-u",lu.id);b.setAttribute("data-d",d);
        b.onclick=onCell;
        grid.appendChild(b);
      }
      grid.appendChild(el('<div class="sum">'+fmtNum(s.plan)+"</div>"));
      grid.appendChild(el('<div class="sum" style="color:var(--ok)">'+fmtNum(s.paidLessons)+"</div>"));
    });
  });
  scroll.appendChild(grid);card.appendChild(scroll);wrap.appendChild(card);

  var noWd=scheduleUnits().filter(function(lu){
    return !(lu.kind==="group"?(lu.weekdays||[]):effWeekdays(lu)).length;
  }).map(function(lu){return lu.name;});
  if(noWd.length)wrap.appendChild(el('<div class="card"><p class="warnbox" style="border-bottom:0;border-radius:var(--r)">'+
    'Без дней недели, поэтому план не строится: '+esc(noWd.join(", "))+"</p></div>"));
  return wrap;
}
function onCell(ev){
  var uid=ev.currentTarget.getAttribute("data-u"),d=+ev.currentTarget.getAttribute("data-d");
  var lu=state.units[uid];if(!lu)return;
  var md=mdoc(lu),cur=dayStatus(lu,state.ym,d,md);
  var isPlanDay=planDays(lu,state.ym).indexOf(d)>=0;
  var order=isPlanDay?STATUS_ORDER_PLAN:STATUS_ORDER_FREE;
  var i=order.indexOf(cur);if(i<0)i=0;
  var next=order[(i+1)%order.length];
  var patch={};
  patch[String(d)]=(next==="plan"||next==="none")?null:next;
  saveMonth(lu,{days:patch});
}
function confirmPast(){
  var ym=state.ym,today=new Date(),n=daysIn(ym);
  var lim=(ymOf(today)===ym)?today.getDate():(ym<ymOf(today)?n:0);
  if(!lim){toast("Месяц ещё не начался");return;}
  var count=0;
  scheduleUnits().forEach(function(lu){
    var md=mdoc(lu),patch={},any=false;
    planDays(lu,ym).forEach(function(d){
      if(d>lim)return;
      if(!(md.days||{})[String(d)]){patch[String(d)]="done";any=true;count++;}
    });
    if(any)saveMonth(lu,{days:patch});
  });
  toast(count?"Отмечено занятий: "+count:"Нечего подтверждать");
}

/* ---------- экран: расписание ---------- */
function viewSchedule(){
  var ym=state.ym,n=daysIn(ym),today=new Date();
  var todayDay=(ymOf(today)===ym)?today.getDate():0;
  var wrap=el('<div class="card"><div class="chead"><h2>Расписание на '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Только дни, в которые есть занятия</span></div></div>');
  var list=el('<div class="daylist"></div>');
  var units=scheduleUnits(),any=false;
  for(var d=1;d<=n;d++){
    var items=[];
    units.forEach(function(lu){
      var st=dayStatus(lu,ym,d,mdoc(lu));
      if(st==="none"||st==="off")return;
      items.push({u:lu,st:st});
    });
    if(!items.length)continue;
    any=true;
    items.sort(function(a,b){
      var ta=state.teachers[a.u.kind==="group"?a.u.teacherId:effTeacherId(a.u)]||{};
      var tb2=state.teachers[b.u.kind==="group"?b.u.teacherId:effTeacherId(b.u)]||{};
      return(ta.order||99)-(tb2.order||99)||byName(a.u,b.u);
    });
    var w=dowOf(ym,d);
    var card=el('<div class="day'+(d===todayDay?" today":"")+'"><div class="dh"><span>'+d+" "+
      MONTHS_IN[ymParts(ym).m-1]+"</span><em>"+DOW[w-1]+(d===todayDay?" · сегодня":"")+"</em></div></div>");
    var ul=document.createElement("ul");
    items.forEach(function(it){
      var t=state.teachers[it.u.kind==="group"?it.u.teacherId:effTeacherId(it.u)]||{};
      var badge=it.st==="done"?'<span class="pill ok">провед.</span>':
                it.st==="pc"?'<span class="pill warn">отм. с опл.</span>':
                it.st==="c"?'<span class="pill bad">отменено</span>':'<span class="pill mute">план</span>';
      ul.appendChild(el("<li><b>"+esc(it.u.name)+'</b> <span class="who">'+esc(t.name||"")+"</span> "+badge+"</li>"));
    });
    card.appendChild(ul);list.appendChild(card);
  }
  if(!any)list.appendChild(el('<div class="day empty">В этом месяце занятий нет. Задайте дни недели в справочнике или отметьте занятия в журнале.</div>'));
  wrap.appendChild(list);
  return wrap;
}

/* ---------- экран: абонементы и оплаты ---------- */
function viewMoney(){
  var wrap=el('<div class="stack"></div>'),nextLbl=ymLabel(ymShift(state.ym,1));
  var cardIn=el('<div class="card"><div class="chead"><h2>Абонементы родителей на '+esc(ymLabel(state.ym))+'</h2>'+
    '<span class="hint">Занятий к оплате = абонемент минус перенос с прошлого месяца</span></div><div class="tscroll"></div></div>');
  var t1=el('<table><thead><tr>'+
    '<th>Ученик</th><th>Родитель</th><th>Группа</th><th class="r">План</th><th class="r">Перенос</th>'+
    '<th class="r">К оплате зан.</th><th class="r">Цена</th><th class="r">Скидка, %</th><th class="r">Абонемент</th>'+
    '<th class="r">Оплачено</th><th>Дата</th><th></th><th class="r">Остаток</th>'+
    '<th class="nowrap">Перенести в '+esc(nextLbl)+"</th>"+
    "</tr></thead><tbody></tbody></table>");
  var b1=t1.querySelector("tbody"),T={charge:0,amount:0,lessons:0};
  teacherList().forEach(function(t){
    var sts=studentsOfTeacher(t.id);if(!sts.length)return;
    b1.appendChild(el('<tr class="grp"><td colspan="14">'+esc(t.name)+"</td></tr>"));
    sts.forEach(function(u){
      var d=billing(u),g=groupOf(u),ls=studentLessons(u);
      T.charge+=d.charge;T.amount+=d.amount;T.lessons+=d.lessons;
      var tr=document.createElement("tr");
      tr.appendChild(el("<td>"+esc(u.name)+"</td>"));
      tr.appendChild(el("<td>"+esc(u.parent||"—")+"</td>"));
      tr.appendChild(el('<td class="sub">'+(g?esc(g.name):"—")+"</td>"));
      tr.appendChild(el('<td class="r sub">'+fmtNum(d.plan)+"</td>"));
      tr.appendChild(billCell(u,"carry",d.carry,1,60));
      tr.appendChild(billCell(u,"lessons",d.lessons,1,66));
      tr.appendChild(billCell(u,"price",d.price,50,86));
      tr.appendChild(billCell(u,"discount",d.discount,1,68));
      tr.appendChild(el('<td class="r"><b>'+esc(fmtMoney(d.charge))+"</b></td>"));
      tr.appendChild(billCell(u,"amount",d.amount,100,96));
      var tdDt=document.createElement("td");
      var dt=document.createElement("input");dt.type="date";dt.className="dt";
      dt.id="dt-"+u.id;dt.value=d.date;
      dt.onchange=function(){saveBilling(u,{date:dt.value});};
      tdDt.appendChild(dt);tr.appendChild(tdDt);
      var tdB=document.createElement("td");
      var bt=el('<button class="btn sm" type="button">Оплачено</button>');
      bt.onclick=function(){saveBilling(u,{amount:d.charge,date:new Date().toISOString().slice(0,10)});};
      if(!d.charge||d.amount>=d.charge)bt.disabled=true;
      tdB.appendChild(bt);tr.appendChild(tdB);
      var leftCell;
      if(!d.charge)leftCell='<span class="pill mute">не начислено</span>';
      else if(d.left>0)leftCell='<span class="pill warn">'+esc(fmtMoney(d.left))+"</span>";
      else if(d.left<0)leftCell='<span class="pill ok">переплата '+esc(fmtMoney(-d.left))+"</span>";
      else leftCell='<span class="pill ok">оплачено</span>';
      tr.appendChild(el('<td class="r nowrap">'+leftCell+"</td>"));
      var tdC=document.createElement("td");
      var wrapC=el('<div class="btnrow" style="flex-wrap:nowrap"></div>');
      var ci=document.createElement("input");ci.type="number";ci.min="0";ci.max="31";
      ci.className="amt";ci.style.width="52px";ci.id="cf-"+u.id;
      ci.value=Math.max(0,d.lessons-ls.paidLessons)||"";ci.placeholder="0";
      var cb=el('<button class="btn sm" type="button">Перенести</button>');
      cb.onclick=function(){
        var k=+ci.value||0;
        if(!k){toast("Укажите количество занятий");return;}
        carryForward(u,k);
      };
      wrapC.appendChild(ci);wrapC.appendChild(cb);
      tdC.appendChild(wrapC);tr.appendChild(tdC);
      b1.appendChild(tr);
      if(d.pkg)b1.appendChild(el('<tr><td colspan="14" class="sub" style="padding-left:22px">абонемент «'+
        esc(d.pkg.name)+"»</td></tr>"));
    });
  });
  b1.appendChild(el('<tr class="tot"><td colspan="5">Итого</td><td class="r">'+fmtNum(T.lessons)+
    '</td><td colspan="2"></td><td class="r">'+esc(fmtMoney(T.charge))+'</td><td class="r">'+
    esc(fmtMoney(T.amount))+'</td><td colspan="2"></td><td class="r">'+
    esc(fmtMoney(T.charge-T.amount))+"</td><td></td></tr>"));
  cardIn.querySelector(".tscroll").appendChild(t1);
  wrap.appendChild(cardIn);

  var cardOut=el('<div class="card"><div class="chead"><h2>Выплаты педагогам</h2>'+
    '<span class="hint">По проведённым занятиям; занятие группы считается один раз</span></div><div class="tscroll"></div></div>');
  var t2=el('<table><thead><tr><th>Педагог</th><th class="r">Провед.</th><th class="r">По ставкам</th>'+
    '<th class="r">Запросил</th><th class="r">Разница</th><th class="r">Выплачено</th><th>Дата</th><th></th><th>Реквизиты</th>'+
    "</tr></thead><tbody></tbody></table>");
  var b2=t2.querySelector("tbody"),sumRate=0,sumPaid=0;
  teacherList().forEach(function(t){
    var lus=lessonUnitsOf(t.id);if(!lus.length)return;
    var lessons=0,payout=0;
    lus.forEach(function(lu){var s=unitStats(lu);lessons+=s.paidLessons;payout+=s.payout;});
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
function billCell(u,field,value,step,width){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.min="0";i.step=String(step);i.className="amt";
  i.style.width=width+"px";i.id="sl-"+field+"-"+u.id;
  i.value=(value===0&&field==="amount")?"":value;
  i.onchange=function(){
    var p={};p[field]=+i.value||0;
    if(field==="amount"&&(+i.value||0)>0&&!billing(u).date)p.date=new Date().toISOString().slice(0,10);
    saveBilling(u,p);
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

/* ---------- справочники ---------- */
var REF_BLOCKS=[
  {id:"teachers",label:"Учителя"},
  {id:"students",label:"Ученики"},
  {id:"groups",label:"Группы"},
  {id:"tariffs",label:"Тарифы клиентам"},
  {id:"rates",label:"Тарифы педагогов"},
  {id:"packages",label:"Абонементы"}
];
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
  var wd=u.kind==="group"?(u.weekdays||[]):effWeekdays(u);
  return wd.length?wd.map(function(d){return DOW[d-1];}).join(", "):"дни не заданы";
}
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
function refTeachers(){
  var c=el('<div class="card"><div class="chead"><h2>Учителя</h2>'+
    '<span class="hint">Реквизиты подставляются в выплаты</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref");
  teacherList().forEach(function(t){
    var sts=studentsOfTeacher(t.id).length,grp=groups().filter(function(g){return g.teacherId===t.id;}).length;
    var meta=[sts?sts+" уч.":"",grp?grp+" гр.":"",t.bank||""].filter(Boolean).join(" · ");
    h.appendChild(acc("t:"+t.id,esc(t.name),esc(meta),function(){return teacherRow(t);}));
  });
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить учителя</button>');
  add.onclick=addTeacher;h.appendChild(add);
  return c;
}
function refStudents(){
  var c=el('<div class="card"><div class="chead"><h2>Ученики</h2>'+
    '<span class="hint">Ученик в группе берёт учителя и дни занятий от неё</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref"),list=students();
  list.forEach(function(u){
    var t=state.teachers[effTeacherId(u)]||{},g=groupOf(u);
    var meta=[t.name||"учитель не выбран",g?g.name:"",u.pkg||"абонемент не выбран",
              u.parent||"",wdText(u)].filter(Boolean).join(" · ");
    h.appendChild(acc("u:"+u.id,esc(u.name),esc(meta),function(){return unitRow(u);}));
  });
  if(!list.length)h.appendChild(el('<p class="sub" style="margin:0">Пока ни одного ученика.</p>'));
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить ученика</button>');
  add.onclick=function(){addUnit("solo");};h.appendChild(add);
  return c;
}
function refGroups(){
  var c=el('<div class="card"><div class="chead"><h2>Группы</h2>'+
    '<span class="hint">Состав собирается из карточек учеников</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref"),list=groups();
  list.forEach(function(g){
    var t=state.teachers[g.teacherId]||{};
    var meta=[t.name||"учитель не выбран",groupMembers(g).length+" чел.",wdText(g)].join(" · ");
    h.appendChild(acc("g:"+g.id,esc(g.name),esc(meta),function(){return unitRow(g);}));
  });
  if(!list.length)h.appendChild(el('<p class="sub" style="margin:0">Пока ни одной группы.</p>'));
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
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
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
  var b=baseRates(),box=el('<div class="ref"></div>');
  box.appendChild(el('<h3 class="refh">Базовые ставки</h3>'));
  var f=el('<div class="fields"></div>');
  var FMT=[["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]];
  FMT.forEach(function(pr){
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
  box.appendChild(el('<h3 class="refh">Личные ставки педагогов</h3>'));
  box.appendChild(el('<p class="sub" style="margin:0">Пусто — действует базовая ставка по формату занятия.</p>'));
  var f2=el('<div class="ref" style="padding:0;gap:8px"></div>');
  teacherList().forEach(function(t){
    var rr=t.rates||{};
    var cur=FMT.map(function(x){
      return typeof rr[x[0]]==="number"?x[1]+" "+fmtMoney(rr[x[0]]):"";}).filter(Boolean).join(" · ");
    f2.appendChild(acc("rt:"+t.id,esc(t.name),esc(cur||"по базовым ставкам"),function(){
      var ff=el('<div class="fields"></div>');
      FMT.forEach(function(x){
        var lab=el('<label class="f">'+esc(x[1])+", ₽</label>");
        var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="50";
        inp.id="tr-"+t.id+"-"+x[0];
        inp.value=typeof rr[x[0]]==="number"?rr[x[0]]:"";
        inp.placeholder=String(b[x[0]]||0);
        inp.onchange=function(){
          var nr=Object.assign({},t.rates||{});
          if(inp.value==="")delete nr[x[0]];else nr[x[0]]=+inp.value||0;
          saveTeacher(t.id,{rates:nr});
        };
        lab.appendChild(inp);ff.appendChild(lab);
      });
      return ff;
    }));
  });
  box.appendChild(f2);
  c.appendChild(box);
  return c;
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
  var tb=tbl.querySelector("tbody"),list=packages();
  list.forEach(function(x,i){
    var tr=document.createElement("tr");
    tr.appendChild(settingCell("packages",i,"name",x.name,"text",210));
    tr.appendChild(settingSelect("packages",i,"tariff",x.tariff,
      [["","— выбрать —"]].concat(tariffs().map(function(t){return[t.name,t.name];}))));
    tr.appendChild(settingCell("packages",i,"lessons",x.lessons,"number",80));
    tr.appendChild(el('<td class="r sub">'+(x.tariff?esc(fmtMoney(tariffPrice(x.tariff))):"—")+"</td>"));
    tr.appendChild(settingCell("packages",i,"discount",x.discount,"number",72));
    tr.appendChild(el('<td class="r"><b>'+esc(fmtMoney(packageTotal(x)))+"</b></td>"));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){var l=packages().slice();l.splice(i,1);saveSettingList("packages",l);};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="7" class="sub">Пока ни одного абонемента.</td></tr>'));
  var trAdd=el('<tr><td colspan="7"></td></tr>');
  var add=el('<button class="btn sm" type="button">Добавить абонемент</button>');
  add.onclick=function(){saveSettingList("packages",packages().concat([{name:"",tariff:"",lessons:8,discount:0}]));};
  trAdd.firstChild.appendChild(add);tb.appendChild(trAdd);
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
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
function readField(label,text){
  return el('<label class="f">'+esc(label)+'<div class="readval">'+esc(text)+"</div></label>");
}

/* связь ученика с группой */
function joinGroup(g,uid){
  var u=state.units[uid];if(!u)return;
  var ids=(g.memberIds||[]).slice();
  if(ids.indexOf(uid)<0)ids.push(uid);
  saveUnit(uid,{groupId:g.id});
  saveUnit(g.id,{memberIds:ids});
  toast(u.name+" в группе «"+g.name+"»");
}
function leaveGroup(g,uid){
  var ids=(g.memberIds||[]).filter(function(x){return x!==uid;});
  saveUnit(uid,{groupId:""});
  saveUnit(g.id,{memberIds:ids});
}

function unitRow(u){
  var row=el('<div class="refrow"></div>');
  var top=el('<div class="top"><span class="pill mute">'+
    (u.kind==="group"?"группа":"индивидуально")+"</span></div>");
  var del=el('<button class="btn sm" type="button" style="margin-left:auto">В архив</button>');
  del.onclick=function(){
    if(u.kind==="solo"){var g=groupOf(u);if(g)leaveGroup(g,u.id);}
    saveUnit(u.id,{active:false});toast("Перенесено в архив");
  };
  top.appendChild(del);row.appendChild(top);
  var f=el('<div class="fields"></div>');
  f.appendChild(field("Имя","u-name-"+u.id,u.name,"text",function(v){saveUnit(u.id,{name:v});}));

  if(u.kind==="solo"){
    f.appendChild(field("Родитель","u-par-"+u.id,u.parent,"text",function(v){saveUnit(u.id,{parent:v});}));
    var g=groupOf(u);
    if(g){
      var t=state.teachers[g.teacherId]||{};
      f.appendChild(readField("Группа",g.name));
      f.appendChild(readField("Педагог",t.name||"не выбран"));
    }else{
      f.appendChild(readField("Группа","не состоит"));
      f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
        [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
    }
    f.appendChild(field("Абонемент","u-pkg-"+u.id,u.pkg||"",null,function(v){saveUnit(u.id,{pkg:v});},
      [["","— без абонемента —"]].concat(packages().map(function(x){
        return[x.name,x.name+" · "+(x.lessons||0)+" зан. · "+fmtMoney(packageTotal(x))];}))));
    row.appendChild(f);
    if(g){
      row.appendChild(readField("Дни недели",wdText(u)));
      var out=el('<button class="btn sm" type="button" style="justify-self:start">Убрать из группы</button>');
      out.onclick=function(){leaveGroup(g,u.id);toast(u.name+" больше не в группе");};
      row.appendChild(out);
    }else{
      var wdlab=el('<label class="f">Дни недели</label>');
      wdlab.appendChild(wdPicker(u));
      row.appendChild(wdlab);
    }
    return row;
  }

  /* группа */
  f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
    [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
  f.appendChild(field("Формат","u-f-"+u.id,u.format,null,function(v){saveUnit(u.id,{format:v});},
    [["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]]));
  row.appendChild(f);
  var wdlab2=el('<label class="f">Дни недели</label>');
  wdlab2.appendChild(wdPicker(u));
  row.appendChild(wdlab2);

  var ml=el('<label class="f">Состав группы</label>');
  var mems=el('<div class="mems"></div>');
  groupMembers(u).forEach(function(m){
    var mr=el('<div class="memrow"><span class="memname">'+esc(m.name)+
      '</span><span class="sub">'+esc(m.parent||"родитель не указан")+'</span>'+
      '<span class="sub">'+esc(m.pkg||"без абонемента")+"</span></div>");
    var rm=el('<button class="btn sm" type="button">Убрать</button>');
    rm.onclick=function(){leaveGroup(u,m.id);};
    mr.appendChild(rm);mems.appendChild(mr);
  });
  if(!groupMembers(u).length)mems.appendChild(el('<p class="sub" style="margin:0">Пока никого.</p>'));
  var free=students().filter(function(s){return !s.groupId;});
  var addRow=el('<div class="btnrow" style="margin-top:2px"></div>');
  var pick=document.createElement("select");
  pick.id="gp-"+u.id;
  var op0=document.createElement("option");op0.value="";op0.textContent="Добавить из списка учеников";
  pick.appendChild(op0);
  free.forEach(function(s){
    var o=document.createElement("option");o.value=s.id;
    o.textContent=s.name+(s.parent?" — "+s.parent:"");
    pick.appendChild(o);
  });
  pick.onchange=function(){if(pick.value)joinGroup(u,pick.value);};
  addRow.appendChild(pick);
  mems.appendChild(addRow);
  ml.appendChild(mems);row.appendChild(ml);
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
  var id=newId(kind==="group"?"g":"u");
  var body={kind:kind,name:kind==="group"?"Новая группа":"Новый ученик",parent:"",
    teacherId:"",format:kind==="group"?"group":"individual",
    price:0,weekdays:[],note:"",active:true,
    order:900+Object.keys(state.units).length,channel:"",
    members:[],memberIds:[],groupId:"",pkg:""};
  state.units[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open[(kind==="group"?"g:":"u:")+id]=1;
  render();
  API.saveUnit(id,body).catch(saveFailed);
}
function addTeacher(){
  if(!needWrite())return;
  var id=newId("t");
  var body={name:"Новый педагог",order:100+teacherList().length,active:true,rates:{},
    bank:"",recipient:"",phone:"",card:"",account:"",bik:"",corr:"",inn:"",kpp:"",purpose:"",note:""};
  state.teachers[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open["t:"+id]=1;
  render();
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
  if(!Object.keys(state.units).length&&!Object.keys(state.teachers).length){
    main.appendChild(el('<div class="card"><div class="boot"><b>Пока пусто</b>Начните со справочников: добавьте учителей, тарифы и учеников.</div></div>'));
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
    format:r.format||"individual",price:num(r.price),
    pkg:r.package_name||"",groupId:r.group_id||"",memberIds:r.member_ids||[],
    weekdays:(r.weekdays||[]).map(Number),members:r.members||[],channel:r.channel||"",
    note:r.note||"",active:r.active!==false,order:r.order_no};
}
function unitToRow(u){
  return{id:u.id,kind:u.kind||"solo",name:u.name||"",parent:u.parent||"",teacher_id:u.teacherId||"",
    format:u.format||"individual",price:num(u.price),rate:null,
    package_name:u.pkg||"",group_id:u.groupId||"",member_ids:u.memberIds||[],
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
