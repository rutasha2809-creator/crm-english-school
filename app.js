(function(){"use strict";

var MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
var MONTHS_IN=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
var DOW=["пн","вт","ср","чт","пт","сб","вс"];
var STATUS_ORDER_PLAN=["plan","done","pc","c","off"];
var STATUS_ORDER_FREE=["none","done","pc"];
var MARK={plan:"",done:"✓",pc:"₽",c:"×",off:"–"};
var CLS={plan:"c-plan",done:"c-done",pc:"c-pc",c:"c-c",off:"c-off"};

var state={tab:"month",ref:"teachers",sale:null,rep:{from:null,to:null},ym:null,
  teachers:{},units:{},months:{},subs:{},payments:{},settings:{},open:{},
  ready:false,err:null};

/* ---------- helpers ---------- */
function pad(n){return n<10?"0"+n:""+n;}
function ymOf(d){return d.getFullYear()+"-"+pad(d.getMonth()+1);}
function ymParts(ym){var a=ym.split("-");return{y:+a[0],m:+a[1]};}
function ymLabel(ym){var p=ymParts(ym);return MONTHS[p.m-1]+" "+p.y;}
function ymShift(ym,k){var p=ymParts(ym);var d=new Date(p.y,p.m-1+k,1);return ymOf(d);}
function daysIn(ym){var p=ymParts(ym);return new Date(p.y,p.m,0).getDate();}
function dowOf(ym,day){var p=ymParts(ym);var w=new Date(p.y,p.m-1,day).getDay();return w===0?7:w;}
function today(){return new Date().toISOString().slice(0,10);}
function ymOfDate(s){return String(s||"").slice(0,7);}
function fmtMoney(n){if(!n)return"0 ₽";return Math.round(n).toLocaleString("ru-RU").replace(/ /g," ")+" ₽";}
function fmtNum(n){return(n||0).toLocaleString("ru-RU");}
function fmtDate(s){if(!s)return"";var a=String(s).split("-");if(a.length!==3)return s;return a[2]+"."+a[1]+"."+a[0].slice(2);}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function el(html){var t=document.createElement("template");t.innerHTML=html.trim();return t.content.firstElementChild;}
function toast(msg){var old=document.querySelector(".toast");if(old)old.remove();var t=el('<div class="toast">'+esc(msg)+"</div>");document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.remove();},2200);}

/* ---------- справочники ---------- */
function teacherList(){
  var a=[];for(var k in state.teachers){a.push(state.teachers[k]);}
  a.sort(function(x,y){return(x.order||99)-(y.order||99)||String(x.name).localeCompare(String(y.name),"ru");});
  return a;
}
function byName(a,b){return String(a.name).localeCompare(String(b.name),"ru");}
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
/* Ученик в группе наследует от неё учителя, дни занятий и ставку педагога. */
function effTeacherId(u){var g=groupOf(u);return g?g.teacherId:u.teacherId;}
function effWeekdays(u){var g=groupOf(u);return(g?g.weekdays:u.weekdays)||[];}
function lessonUnit(u){return groupOf(u)||u;}
/* Ученики, занимающиеся индивидуально: они сами — учебная единица. */
function soloUnits(){
  return students().filter(function(u){return !groupOf(u);});
}
function scheduleUnits(){return groups().concat(soloUnits());}
function studentsOfTeacher(tid){
  return students().filter(function(u){return effTeacherId(u)===tid;});
}
function tariffs(){return state.settings.tariffs||[];}
function packages(){return state.settings.packages||[];}
function teacherTariffs(){return state.settings.teacherTariffs||[];}
function tariffPrice(name){
  var t=tariffs().filter(function(x){return x.name===name;})[0];
  return t?(+t.price||0):0;
}
function packageOf(name){
  var p=packages().filter(function(x){return x.name===name;})[0];
  return p||null;
}
function packageTotal(x){
  var price=tariffPrice(x.tariff),gross=(+x.lessons||0)*price;
  return Math.round(gross-gross*(+x.discount||0)/100);
}
function teacherRate(name){
  var t=teacherTariffs().filter(function(x){return x.name===name;})[0];
  return t?(+t.price||0):0;
}
function rateExists(name){
  return !name||teacherTariffs().some(function(x){return x.name===name;});
}
function rateNameOf(lu){
  if(lu.kind==="group")return lu.rateName||"";
  var g=groupOf(lu);
  return g?(g.rateName||""):(lu.rateName||"");
}
function rateOf(lu){return teacherRate(rateNameOf(lu));}

/* ---------- занятия ---------- */
function mdoc(u,ym){return state.months[(ym||state.ym)+"__"+u.id]||{days:{},pay:{}};}
function planDays(u,ym){
  var wd=u.kind==="group"?(u.weekdays||[]):effWeekdays(u),out=[];
  if(!wd.length)return out;
  for(var d=1;d<=daysIn(ym);d++){if(wd.indexOf(dowOf(ym,d))>=0)out.push(d);}
  return out;
}
function dayStatus(u,ym,day,md){
  var raw=(md.days||{})[String(day)];
  if(raw)return raw;
  return planDays(u,ym).indexOf(day)>=0?"plan":"none";
}
/* Занятия учебной единицы за месяц. Проведённым считается и поздняя отмена с оплатой. */
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
  var held=done+pc,rate=rateOf(lu);
  return{plan:plan,done:done,pc:pc,canc:canc,held:held,paidLessons:held,
    rate:rate,payout:held*rate,md:md};
}
/* Все месяцы, по которым есть отметки занятий. */
function monthsWithLessons(){
  var set={};
  for(var k in state.months){
    var m=state.months[k];
    if(m&&m.days&&Object.keys(m.days).length)set[m.month]=1;
  }
  return Object.keys(set).sort();
}
/* Сколько занятий проведено у ученика за всё время или за месяц. */
function heldOf(u,ym){
  var lu=lessonUnit(u);
  if(ym)return unitStats(lu,ym).held;
  var total=0;
  monthsWithLessons().forEach(function(m){total+=unitStats(lu,m).held;});
  return total;
}

/* ---------- документы: продажи и деньги ---------- */
function subsList(){
  var a=[];for(var k in state.subs){a.push(state.subs[k]);}
  a.sort(function(x,y){return String(y.soldOn).localeCompare(String(x.soldOn));});
  return a;
}
function paymentsList(){
  var a=[];for(var k in state.payments){a.push(state.payments[k]);}
  a.sort(function(x,y){return String(y.paidOn).localeCompare(String(x.paidOn));});
  return a;
}
/* Перенос занятий с прошлого периода — не продажа: денег за него нет. */
function isCarry(s){return s.note==="carry"||s.total===0&&s.pkg==="Перенос с прошлого периода";}
function subsOf(sid){return subsList().filter(function(s){return s.studentId===sid;});}
/* Сколько занятий куплено ученику за всё время. */
function lessonsBought(u){
  var bought=0;
  subsOf(u.id).forEach(function(s){bought+=+s.lessons||0;});
  return bought;
}
/* Остаток занятий: куплено минус проведено. */
function lessonsLeft(u){return lessonsBought(u)-heldOf(u);}
/* Долг родителя: продано на сумму минус поступило. */
function debtOf(u){
  var billed=0,paid=0;
  subsOf(u.id).forEach(function(s){billed+=+s.total||0;});
  paymentsList().forEach(function(p){
    if(p.direction==="in"&&p.studentId===u.id)paid+=+p.amount||0;
  });
  return billed-paid;
}
/* Долг школы перед педагогом: начислено по проведённым минус выплачено. */
function teacherDebt(tid){
  var accrued=0,paid=0;
  monthsWithLessons().forEach(function(ym){
    lessonUnitsOf(tid).forEach(function(lu){accrued+=unitStats(lu,ym).payout;});
  });
  paymentsList().forEach(function(p){
    if(p.direction==="out"&&p.teacherId===tid)paid+=+p.amount||0;
  });
  return{accrued:accrued,paid:paid,left:accrued-paid};
}
function lessonUnitsOf(tid){
  return scheduleUnits().filter(function(lu){
    return(lu.kind==="group"?lu.teacherId:effTeacherId(lu))===tid;
  });
}
function newId(prefix){return prefix+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36);}
/* ---------- запись ---------- */
function needWrite(){
  if(!session){toast("Сначала войдите");return false;}
  return true;
}
function saveFailed(e){
  var msg=e&&(e.message||e.error_description||e.code)||"ошибка";
  toast("Не удалось сохранить: "+msg);
}
var pending={};
function saveMonth(u,patch){
  if(!needWrite())return Promise.resolve();
  var id=state.ym+"__"+u.id;
  var cur=state.months[id]||{unitId:u.id,month:state.ym,days:{}};
  var next={unitId:u.id,month:state.ym,days:Object.assign({},cur.days||{}),note:cur.note||""};
  if(patch.days)next.days=Object.assign(next.days,patch.days);
  if("note" in patch)next.note=patch.note;
  for(var d in next.days){if(!next.days[d])delete next.days[d];}
  state.months[id]=next;render();
  if(pending[id])return pending[id];
  pending[id]=API.saveMonth(next).catch(saveFailed).then(function(){delete pending[id];});
  return pending[id];
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
function saveSettingList(name,value){
  if(!needWrite())return Promise.resolve();
  var next=Object.assign({},state.settings);next[name]=value;
  state.settings=next;render();
  return API.saveSettings(next).catch(saveFailed);
}
/* продажа абонемента */
function saveSub(sub){
  if(!needWrite())return Promise.resolve();
  state.subs[sub.id]=sub;render();
  return API.saveSub(sub).catch(saveFailed);
}
function deleteSub(id){
  if(!needWrite())return Promise.resolve();
  delete state.subs[id];render();
  return API.deleteSub(id).catch(saveFailed);
}
/* движение денег */
function savePayment(p){
  if(!needWrite())return Promise.resolve();
  state.payments[p.id]=p;render();
  return API.savePayment(p).catch(saveFailed);
}
function deletePayment(id){
  if(!needWrite())return Promise.resolve();
  delete state.payments[id];render();
  return API.deletePayment(id).catch(saveFailed);
}
/* ---------- переименование в справочниках ---------- */
/* Ссылки на старое название обновляются сами. Проданные абонементы не трогаем:
   в них цена и количество занятий зафиксированы в момент продажи. */
function renameRefs(kind,oldName,newName){
  if(!oldName||oldName===newName)return;
  if(kind==="tariffs"){
    var ps=packages().map(function(x){
      return x.tariff===oldName?Object.assign({},x,{tariff:newName}):x;});
    if(JSON.stringify(ps)!==JSON.stringify(packages()))saveSettingList("packages",ps);
  }
  if(kind==="teacherTariffs"){
    for(var k in state.units){
      var u=state.units[k];
      if(u.rateName===oldName)saveUnit(u.id,{rateName:newName});
    }
  }
}

/* ---------- вкладки ---------- */
var TABS=[
  {id:"month",label:"Месяц"},
  {id:"journal",label:"Журнал занятий"},
  {id:"schedule",label:"Расписание по дням"},
  {id:"docs",label:"Начисления и оплаты"},
  {id:"reports",label:"Отчёты"},
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
function kpiCard(k,v,s,cls){
  return el('<div class="kpi'+(cls?" "+cls:"")+'"><div class="k">'+esc(k)+
    '</div><div class="v num">'+esc(v)+'</div><div class="s">'+esc(s||"")+"</div></div>");
}
function viewMonth(){
  var ym=state.ym,wrap=el('<div class="stack"></div>');

  /* факты месяца */
  var sold=0,soldCount=0,soldLessons=0;
  subsList().forEach(function(s){
    if(ymOfDate(s.soldOn)!==ym||isCarry(s))return;
    sold+=+s.total||0;soldCount++;soldLessons+=+s.lessons||0;
  });
  var gotIn=0,paidOut=0;
  paymentsList().forEach(function(p){
    if(ymOfDate(p.paidOn)!==ym)return;
    if(p.direction==="in")gotIn+=+p.amount||0;else paidOut+=+p.amount||0;
  });
  var held=0,accrued=0,plan=0;
  scheduleUnits().forEach(function(lu){
    var st=unitStats(lu,ym);held+=st.held;accrued+=st.payout;plan+=st.plan;
  });

  var kpis=el('<div class="kpis"></div>');
  kpis.appendChild(kpiCard("Начислено родителям",fmtMoney(sold),
    soldCount?fmtNum(soldCount)+" начисл. · "+fmtNum(soldLessons)+" зан.":"начислений в этом месяце нет"));
  kpis.appendChild(kpiCard("Получено от родителей",fmtMoney(gotIn),
    sold>gotIn?"из начисленного ждём "+fmtMoney(sold-gotIn):"поступило всё начисленное"));
  kpis.appendChild(kpiCard("Начислено педагогам",fmtMoney(accrued),
    "за "+fmtNum(held)+" провед. · выплачено "+fmtMoney(paidOut)));
  kpis.appendChild(kpiCard("Заработок школы",fmtMoney(sold-accrued),
    sold?Math.round((sold-accrued)/sold*100)+"% от начисленного":"","accent"));
  kpis.appendChild(kpiCard("Занятий проведено",fmtNum(held),"по плану "+fmtNum(plan)));
  wrap.appendChild(kpis);

  /* по педагогам и ученикам */
  var card=el('<div class="card"><div class="chead"><h2>По педагогам и ученикам</h2>'+
    '<span class="hint">Остаток занятий и долг считаются по всем продажам и занятиям, не только за этот месяц</span></div>'+
    '<div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Ученик</th><th>Группа</th><th class="r">Провед. в месяце</th>'+
    '<th class="r">Остаток занятий</th><th class="r">Долг</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),anyRow=false,totDebt=0,totLeft=0;
  teacherList().forEach(function(t){
    var sts=studentsOfTeacher(t.id),lus=lessonUnitsOf(t.id);
    if(!sts.length&&!lus.length)return;
    anyRow=true;
    var tHeld=0,tAccr=0;
    lus.forEach(function(lu){var st=unitStats(lu,ym);tHeld+=st.held;tAccr+=st.payout;});
    var tPaid=0;
    paymentsList().forEach(function(p){
      if(p.direction==="out"&&p.teacherId===t.id&&ymOfDate(p.paidOn)===ym)tPaid+=+p.amount||0;
    });
    var pill=(tAccr<=0&&tHeld>0)?'<span class="pill bad">ставка за занятие не назначена</span>':
      tAccr<=0?'<span class="pill mute">нет проведённых</span>':
      tPaid>=tAccr?'<span class="pill ok">выплачено</span>':
      tPaid>0?'<span class="pill warn">выплачено '+esc(fmtMoney(tPaid))+" из "+esc(fmtMoney(tAccr))+"</span>":
      '<span class="pill bad">не выплачено</span>';
    tb.appendChild(el('<tr class="grp"><td colspan="5">'+esc(t.name)+
      ' <span class="sub">'+fmtNum(tHeld)+" провед. · начислено "+esc(fmtMoney(tAccr))+" "+pill+
      "</span></td></tr>"));
    sts.forEach(function(u){
      var g=groupOf(u),left=lessonsLeft(u),debt=debtOf(u);
      totDebt+=debt;totLeft+=left;
      var leftPill=!lessonsBought(u)?'<span class="pill mute">не начислялось</span>':
        left>0?'<span class="pill ok">'+fmtNum(left)+"</span>":
        left<0?'<span class="pill bad">перерасход '+fmtNum(-left)+"</span>":
        '<span class="pill warn">абонемент закончился</span>';
      var debtPill=debt>0?'<span class="pill warn">'+esc(fmtMoney(debt))+"</span>":
        debt<0?'<span class="pill ok">переплата '+esc(fmtMoney(-debt))+"</span>":
        '<span class="pill ok">нет долга</span>';
      tb.appendChild(el('<tr><td style="padding-left:22px">'+esc(u.name)+
        (u.parent?' <span class="sub">'+esc(u.parent)+"</span>":"")+
        '</td><td class="sub">'+(g?esc(g.name):"—")+
        '</td><td class="r">'+fmtNum(heldOf(u,ym))+
        '</td><td class="r nowrap">'+leftPill+
        '</td><td class="r nowrap">'+debtPill+"</td></tr>"));
    });
  });
  if(!anyRow)tb.appendChild(el('<tr><td colspan="5" class="sub">Пока нет ни учеников, ни групп у педагогов.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td colspan="3">Итого по школе</td><td class="r">'+
    fmtNum(totLeft)+'</td><td class="r">'+esc(fmtMoney(totDebt))+"</td></tr>"));
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
      for(var d2=1;d2<=n;d2++){
        var st=dayStatus(lu,ym,d2,md);
        var b=document.createElement("button");
        b.type="button";
        b.className="cell"+(st!=="none"?" "+CLS[st]:"");
        b.textContent=MARK[st]||"";
        b.title=label+", "+d2+" "+MONTHS_IN[ymParts(ym).m-1];
        b.setAttribute("data-u",lu.id);b.setAttribute("data-d",d2);
        b.onclick=onCell;
        grid.appendChild(b);
      }
      grid.appendChild(el('<div class="sum">'+fmtNum(s.plan)+"</div>"));
      grid.appendChild(el('<div class="sum" style="color:var(--ok)">'+fmtNum(s.held)+"</div>"));
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
  var ym=state.ym,now=new Date(),n=daysIn(ym);
  var lim=(ymOf(now)===ym)?now.getDate():(ym<ymOf(now)?n:0);
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
  var ym=state.ym,n=daysIn(ym),now=new Date();
  var todayDay=(ymOf(now)===ym)?now.getDate():0;
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

/* ---------- справочники ---------- */
var REF_BLOCKS=[
  {id:"teachers",label:"Учителя"},
  {id:"students",label:"Ученики"},
  {id:"groups",label:"Группы"},
  {id:"solos",label:"Индивидуальные занятия"},
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
  var fn={teachers:refTeachers,students:refStudents,groups:refGroups,solos:refSolos,
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
    '<span class="hint">Ученик в группе берёт учителя, дни занятий и ставку педагога от неё</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref"),list=students();
  list.forEach(function(u){
    var t=state.teachers[effTeacherId(u)]||{},g=groupOf(u);
    var meta=[t.name||"педагог не выбран",g?g.name:"индивидуально",
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
    var meta=[t.name||"учитель не выбран",
      rateExists(g.rateName)?(g.rateName||"ставка не выбрана"):"ставки нет в справочнике",
      groupMembers(g).length+" чел.",wdText(g)].join(" · ");
    h.appendChild(acc("g:"+g.id,esc(g.name),esc(meta),function(){return unitRow(g);}));
  });
  if(!list.length)h.appendChild(el('<p class="sub" style="margin:0">Пока ни одной группы.</p>'));
  var add=el('<button class="btn" type="button" style="justify-self:start">Добавить группу</button>');
  add.onclick=function(){addUnit("group");};h.appendChild(add);
  return c;
}
function refSolos(){
  var c=el('<div class="card"><div class="chead"><h2>Индивидуальные занятия</h2>'+
    '<span class="hint">Сюда попадает каждый ученик, не состоящий в группе</span></div><div class="ref"></div></div>');
  var h=c.querySelector(".ref"),list=soloUnits();
  list.forEach(function(u){
    var t=state.teachers[u.teacherId]||{};
    var meta=[t.name||"педагог не выбран",
      rateExists(u.rateName)?(u.rateName||"ставка не выбрана"):"ставки нет в справочнике",
      wdText(u)].join(" · ");
    h.appendChild(acc("il:"+u.id,esc(u.name),esc(meta),function(){return soloLessonRow(u);}));
  });
  if(!list.length)h.appendChild(el('<p class="sub" style="margin:0">Все ученики занимаются в группах.</p>'));
  return c;
}
/* Карточка индивидуального занятия: педагог, ставка и дни недели. */
function soloLessonRow(u){
  var row=el('<div class="refrow"></div>');
  var f=el('<div class="fields"></div>');
  f.appendChild(field("Педагог","il-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
    [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
  f.appendChild(field("Ставка педагога","il-rn-"+u.id,u.rateName||"",null,
    function(v){saveUnit(u.id,{rateName:v});},rateOptions(u.rateName)));
  f.appendChild(readField("Родитель",u.parent||"не указан"));
  row.appendChild(f);
  var wdlab=el('<label class="f">Дни недели</label>');
  wdlab.appendChild(wdPicker(u));
  row.appendChild(wdlab);
  row.appendChild(el('<p class="sub" style="margin:0">Остаток занятий: '+fmtNum(lessonsLeft(u))+
    " · долг: "+esc(fmtMoney(debtOf(u)))+"</p>"));
  return row;
}
function refTariffs(){
  var c=el('<div class="card"><div class="chead"><h2>Тарифы клиентам</h2>'+
    '<span class="hint">Цена одного занятия для ученика</span></div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Название</th><th class="r">Минут</th><th class="r">Цена занятия</th><th></th></tr></thead><tbody></tbody></table>');
  var tb=tbl.querySelector("tbody"),list=tariffs();
  list.forEach(function(x,i){
    var tr=document.createElement("tr");
    tr.appendChild(settingCell("tariffs",i,"name",x.name,"text",280));
    tr.appendChild(settingCell("tariffs",i,"minutes",x.minutes,"number",70));
    tr.appendChild(settingCell("tariffs",i,"price",x.price,"number",96));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){var l=tariffs().slice();l.splice(i,1);saveSettingList("tariffs",l);};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="4" class="sub">Пока ни одного тарифа.</td></tr>'));
  var trAdd=el('<tr><td colspan="4"></td></tr>');
  var add=el('<button class="btn sm" type="button">Добавить тариф</button>');
  add.onclick=function(){saveSettingList("tariffs",tariffs().concat([{name:"",minutes:0,price:0}]));};
  trAdd.firstChild.appendChild(add);tb.appendChild(trAdd);
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}
function refRates(){
  var c=el('<div class="card"><div class="chead"><h2>Тарифы педагогов</h2>'+
    '<span class="hint">Сколько школа платит педагогу за одно занятие</span></div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Название</th><th class="r">Ставка за занятие</th><th></th></tr></thead><tbody></tbody></table>');
  var tb=tbl.querySelector("tbody"),list=teacherTariffs();
  list.forEach(function(x,i){
    var tr=document.createElement("tr");
    tr.appendChild(settingCell("teacherTariffs",i,"name",x.name,"text",300));
    tr.appendChild(settingCell("teacherTariffs",i,"price",x.price,"number",110));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){var l=teacherTariffs().slice();l.splice(i,1);saveSettingList("teacherTariffs",l);};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="3" class="sub">Пока ни одного тарифа.</td></tr>'));
  var trAdd=el('<tr><td colspan="3"></td></tr>');
  var add=el('<button class="btn sm" type="button">Добавить тариф</button>');
  add.onclick=function(){saveSettingList("teacherTariffs",teacherTariffs().concat([{name:"",price:0}]));};
  trAdd.firstChild.appendChild(add);tb.appendChild(trAdd);
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}
function rateOptions(current){
  var opts=[["","— без тарифа —"]].concat(teacherTariffs().map(function(x){
    return[x.name,x.name+" · "+fmtMoney(x.price)];}));
  /* если назначенный тариф удалён из справочника, не теряем его молча */
  if(current&&!rateExists(current))opts.push([current,current+" — тарифа нет в справочнике"]);
  return opts;
}
function refPackages(){
  var c=el('<div class="card"><div class="chead"><h2>Абонементы</h2>'+
    '<span class="hint">Заготовки для продажи: стоимость = количество занятий × цена занятия минус скидка</span>'+
    '</div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Название</th><th>Тариф ученика</th><th class="r">Количество занятий</th>'+
    '<th class="r">Цена занятия</th><th class="r">Скидка, %</th>'+
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
  add.onclick=function(){saveSettingList("packages",packages().concat([{name:"",tariff:"",lessons:0,discount:0}]));};
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
    var was=l[idx]&&l[idx][field];
    l[idx]=Object.assign({},l[idx]);
    l[idx][field]=type==="number"?(+i.value||0):i.value;
    saveSettingList(listName,l);
    if(field==="name")renameRefs(listName,was,l[idx].name);
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
    if(u.kind==="solo"){var g0=groupOf(u);if(g0)leaveGroup(g0,u.id);}
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
      f.appendChild(readField("Ставка педагога",(g.rateName||"не выбрана")+
        (g.rateName?" · "+fmtMoney(teacherRate(g.rateName)):"")));
    }else{
      var ti=state.teachers[u.teacherId]||{};
      f.appendChild(readField("Группа","занимается индивидуально"));
      f.appendChild(readField("Педагог",ti.name||"не выбран"));
      f.appendChild(readField("Ставка педагога",(u.rateName||"не выбрана")+
        (u.rateName?" · "+fmtMoney(teacherRate(u.rateName)):"")));
    }
    row.appendChild(f);
    row.appendChild(readField("Дни недели",wdText(u)));
    row.appendChild(el('<p class="sub" style="margin:0">Остаток занятий: '+fmtNum(lessonsLeft(u))+
      " · долг: "+esc(fmtMoney(debtOf(u)))+"</p>"));
    if(g){
      var out=el('<button class="btn sm" type="button" style="justify-self:start">Убрать из группы</button>');
      out.onclick=function(){leaveGroup(g,u.id);toast(u.name+" больше не в группе");};
      row.appendChild(out);
    }else{
      row.appendChild(el('<p class="sub" style="margin:0">Педагог, ставка и дни недели задаются в разделе «Индивидуальные занятия».</p>'));
    }
    return row;
  }

  /* группа */
  f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
    [["","— выбрать педагога —"]].concat(teacherList().map(function(x){return[x.id,x.name];}))));
  f.appendChild(field("Ставка педагога","u-rn-"+u.id,u.rateName||"",null,
    function(v){saveUnit(u.id,{rateName:v});},rateOptions(u.rateName)));
  row.appendChild(f);
  var wdlab2=el('<label class="f">Дни недели</label>');
  wdlab2.appendChild(wdPicker(u));
  row.appendChild(wdlab2);

  var ml=el('<label class="f">Состав группы</label>');
  var mems=el('<div class="mems"></div>');
  var list=groupMembers(u);
  list.forEach(function(m){
    var mr=el('<div class="memrow"><span class="memname">'+esc(m.name)+
      '</span><span class="sub">'+esc(m.parent||"родитель не указан")+'</span>'+
      '<span class="sub">остаток '+fmtNum(lessonsLeft(m))+" зан.</span></div>");
    var rm=el('<button class="btn sm" type="button">Убрать</button>');
    rm.onclick=function(){leaveGroup(u,m.id);};
    mr.appendChild(rm);mems.appendChild(mr);
  });
  if(!list.length)mems.appendChild(el('<p class="sub" style="margin:0">Пока никого.</p>'));
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
  row.appendChild(f);
  return row;
}
function addUnit(kind){
  if(!needWrite())return;
  var id=newId(kind==="group"?"g":"u");
  var body={kind:kind,name:kind==="group"?"Новая группа":"Новый ученик",parent:"",
    teacherId:"",rateName:"",weekdays:[],active:true,
    order:900+Object.keys(state.units).length,channel:"",
    memberIds:[],groupId:""};
  state.units[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open[(kind==="group"?"g:":"u:")+id]=1;
  render();
  API.saveUnit(id,body).catch(saveFailed);
}
function addTeacher(){
  if(!needWrite())return;
  var id=newId("t");
  var body={name:"Новый педагог",order:100+teacherList().length,active:true,
    bank:"",recipient:"",phone:"",card:"",account:"",bik:"",corr:"",inn:"",kpp:"",purpose:"",note:""};
  state.teachers[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open["t:"+id]=1;
  render();
  API.saveTeacher(id,body).catch(saveFailed);
}

/* ---------- render ---------- */
var VIEWS={month:viewMonth,journal:viewJournal,schedule:viewSchedule,docs:viewDocs,
           reports:viewReports,ref:viewRef};
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
/* ---------- экран: продажи и деньги ---------- */
/* Три вводимых факта: продажа абонемента, проведённое занятие (журнал) и движение
   денег. Остаток занятий, долг и заработок считаются из них. */

function sel(id,opts,value){
  var s=document.createElement("select");s.id=id;
  opts.forEach(function(o){
    var op=document.createElement("option");op.value=o[0];op.textContent=o[1];
    if(String(o[0])===String(value||""))op.selected=true;
    s.appendChild(op);
  });
  return s;
}
function inp(id,type,value,width,step){
  var i=document.createElement("input");
  i.id=id;i.type=type;i.value=value==null?"":value;
  if(width)i.style.width=width+"px";
  if(type==="number"){i.min="0";i.step=step||"1";i.className="amt";}
  return i;
}
function labeled(text,node){
  var l=el('<label class="f">'+esc(text)+"</label>");l.appendChild(node);return l;
}
function studentOptions(empty){
  return[["",empty||"— выбрать ученика —"]].concat(students().map(function(u){
    var g=groupOf(u);
    return[u.id,u.name+(g?" · "+g.name:"")+(u.parent?" — "+u.parent:"")];
  }));
}
function packageOptions(){
  return[["","— выбрать абонемент —"]].concat(packages().filter(function(p){return p.name;})
    .map(function(p){
      return[p.name,p.name+" · "+(+p.lessons||0)+" зан. · "+fmtMoney(packageTotal(p))];
    }));
}

/* ---------- счёт на следующий месяц ---------- */
/* Родители платят за месяц вперёд: занятий по плану минус то, что осталось
   неиспользованным, — столько занятий и нужно продать. */
function billYm(){return ymShift(state.ym,1);}
function billRow(u){
  var ym=billYm(),plan=planDays(lessonUnit(u),ym).length;
  var left=lessonsLeft(u),toSell=Math.max(0,plan-Math.max(0,left));
  return{u:u,plan:plan,left:left,toSell:toSell};
}
/* Остаток можно поправить прямо в таблице: разница сохраняется отдельной
   строкой-корректировкой, чтобы не выдумывать историю прошлых месяцев. */
function adjId(u){return "adj-"+u.id;}
function setLeft(u,value){
  var cur=lessonsLeft(u),old=state.subs[adjId(u)],had=old?+old.lessons||0:0;
  var next=had+(value-cur);
  saveSub({id:adjId(u),studentId:u.id,soldOn:ymShift(state.ym,-1)+"-28",
    pkg:"Перенос с прошлого периода",lessons:next,price:0,discount:0,total:0,note:"carry"});
}
function leftCell(u){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.step="1";i.className="amt";i.style.width="68px";
  i.id="left-"+u.id;i.value=lessonsLeft(u);
  i.onchange=function(){setLeft(u,+i.value||0);};
  td.appendChild(i);return td;
}
function billCard(){
  var ym=billYm();
  var c=el('<div class="card"><div class="chead"><h2>Начисление на '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Остаток можно исправить прямо в таблице — например, вписать занятия, перенесённые с прошлого месяца</span>'+
    '</div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Ученик</th><th>Группа</th>'+
    '<th class="r">По плану</th><th class="r">Остаток</th><th class="r">К оплате занятий</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),rows=[],T={plan:0,sell:0};
  students().forEach(function(u){
    var r=billRow(u);
    rows.push(r);T.plan+=r.plan;T.sell+=r.toSell;
  });
  rows.forEach(function(r){
    var g=groupOf(r.u);
    var tr=el("<tr><td>"+esc(r.u.name)+'</td><td class="sub">'+(g?esc(g.name):"—")+
      '</td><td class="r">'+fmtNum(r.plan)+"</td></tr>");
    tr.appendChild(leftCell(r.u));
    tr.appendChild(el('<td class="r"><b>'+fmtNum(r.toSell)+"</b></td>"));
    var td=document.createElement("td");
    var b=el('<button class="btn sm" type="button">Начислить</button>');
    b.onclick=function(){
      state.sale={studentId:r.u.id,lessons:r.toSell};
      state.open=state.open||{};state.open["sale:new"]=1;
      try{localStorage.setItem("oe.open",JSON.stringify(state.open));}catch(e){}
      render();
    };
    if(!r.toSell)b.disabled=true;
    td.appendChild(b);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!rows.length)tb.appendChild(el('<tr><td colspan="6" class="sub">Не задано ни одного дня занятий, поэтому план на '+
    esc(ymLabel(ym))+" пустой.</td></tr>"));
  else tb.appendChild(el('<tr class="tot"><td colspan="2">Итого</td><td class="r">'+fmtNum(T.plan)+
    '</td><td></td><td class="r">'+fmtNum(T.sell)+"</td><td></td></tr>"));
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}

/* ---------- продажа абонемента ---------- */
function saleForm(){
  var draft=state.sale||{};
  var box=el('<div class="refrow"></div>');
  var f=el('<div class="fields"></div>');
  var whoSel=sel("sale-who",[["one","Одному ученику"],["group","Всей группе"]],"one");
  var stu=sel("sale-student",studentOptions(),draft.studentId||"");
  var grp=sel("sale-group",[["","— выбрать группу —"]].concat(groups().map(function(g){
    return[g.id,g.name+" · "+groupMembers(g).length+" чел."];})),"");
  var pkg=sel("sale-pkg",packageOptions(),"");
  var date=inp("sale-date","date",today());
  var lessons=inp("sale-lessons","number",draft.lessons||"",80);
  var total=inp("sale-total","number","",110,"50");

  var whoLab=labeled("Кому",whoSel);
  var stuLab=labeled("Ученик",stu);
  var grpLab=labeled("Группа",grp);
  function syncWho(){
    stuLab.hidden=whoSel.value!=="one";
    grpLab.hidden=whoSel.value!=="group";
  }
  whoSel.onchange=syncWho;
  /* стоимость всегда считается от количества занятий и цены выбранного абонемента */
  function recalc(){
    var p=packageOf(pkg.value);
    if(!p)return;
    var price=tariffPrice(p.tariff),n=+lessons.value||0,gross=n*price;
    total.value=Math.round(gross-gross*(+p.discount||0)/100);
  }
  pkg.onchange=function(){
    var p=packageOf(pkg.value);
    if(!p)return;
    if(!(+lessons.value))lessons.value=+p.lessons||0;
    recalc();
  };
  lessons.onchange=recalc;
  f.appendChild(whoLab);f.appendChild(stuLab);f.appendChild(grpLab);
  f.appendChild(labeled("Абонемент",pkg));
  f.appendChild(labeled("Дата продажи",date));
  f.appendChild(labeled("Занятий",lessons));
  f.appendChild(labeled("Стоимость",total));
  box.appendChild(f);
  syncWho();
  if(draft.studentId){
    var du=state.units[draft.studentId]||{};
    box.appendChild(el('<p class="sub" style="margin:0">Подставлено из счёта на '+
      esc(ymLabel(billYm()))+": "+esc(du.name||"")+", "+fmtNum(draft.lessons)+
      " зан. Выберите абонемент — сумма пересчитается по этому количеству.</p>"));
  }

  var row=el('<div class="btnrow" style="margin-top:4px"></div>');
  var btn=el('<button class="btn pri" type="button">Начислить</button>');
  btn.onclick=function(){
    var targets=[];
    if(whoSel.value==="group"){
      var g=state.units[grp.value];
      if(!g){toast("Выберите группу");return;}
      targets=groupMembers(g);
      if(!targets.length){toast("В группе никого нет");return;}
    }else{
      var u=state.units[stu.value];
      if(!u){toast("Выберите ученика");return;}
      targets=[u];
    }
    if(!pkg.value){toast("Выберите абонемент");return;}
    var n=+lessons.value||0,sum=+total.value||0;
    if(!n){toast("Укажите количество занятий");return;}
    var p=packageOf(pkg.value)||{};
    state.sale=null;
    targets.forEach(function(u2){
      saveSub({id:newId("s"),studentId:u2.id,soldOn:date.value||today(),
        pkg:pkg.value,lessons:n,price:tariffPrice(p.tariff),
        discount:+p.discount||0,total:sum,note:""});
    });
    toast(targets.length>1?"Начислено ученикам: "+targets.length:"Начислено");
  };
  row.appendChild(btn);box.appendChild(row);
  return box;
}
function salesCard(){
  var c=el('<div class="card"><div class="chead"><h2>Начисления</h2>'+
    '<span class="hint">Количество занятий и сумма фиксируются в момент начисления и дальше не меняются</span>'+
    "</div></div>");
  var h=el('<div class="ref"></div>');
  h.appendChild(acc("sale:new",'<b>Начислить вручную</b>',"",saleForm));
  c.appendChild(h);
  var scroll=el('<div class="tscroll"></div>');
  var tbl=el('<table><thead><tr><th>Дата</th><th>Ученик</th><th>Тариф</th>'+
    '<th class="r">Занятий</th><th class="r">Стоимость</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),list=subsList(),sum=0,cnt=0;
  list.forEach(function(s){
    var u=state.units[s.studentId]||{};
    sum+=+s.total||0;cnt+=+s.lessons||0;
    var tr=el("<tr><td>"+esc(fmtDate(s.soldOn))+"</td><td>"+esc(u.name||"ученик удалён")+
      '</td><td class="sub">'+esc(s.pkg||"—")+'</td><td class="r">'+fmtNum(s.lessons)+
      '</td><td class="r">'+esc(fmtMoney(s.total))+"</td></tr>");
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){deleteSub(s.id);toast("Запись удалена");};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="6" class="sub">Начислений пока нет.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td colspan="3">Итого</td><td class="r">'+fmtNum(cnt)+
    '</td><td class="r">'+esc(fmtMoney(sum))+"</td><td></td></tr>"));
  scroll.appendChild(tbl);c.appendChild(scroll);
  return c;
}

/* ---------- движение денег ---------- */
function payForm(){
  var box=el('<div class="refrow"></div>');
  var f=el('<div class="fields"></div>');
  var dir=sel("pay-dir",[["in","Поступление от родителя"],["out","Выплата педагогу"]],"in");
  var stu=sel("pay-student",studentOptions(),"");
  var tch=sel("pay-teacher",[["","— выбрать педагога —"]].concat(teacherList().map(function(t){
    return[t.id,t.name];})),"");
  var date=inp("pay-date","date",today());
  var amount=inp("pay-amount","number","",120,"50");
  var stuLab=labeled("Ученик",stu),tchLab=labeled("Педагог",tch);
  function syncDir(){
    stuLab.hidden=dir.value!=="in";
    tchLab.hidden=dir.value!=="out";
    amount.placeholder=dir.value==="in"?"сумма оплаты":"сумма выплаты";
  }
  dir.onchange=syncDir;
  f.appendChild(labeled("Операция",dir));
  f.appendChild(stuLab);f.appendChild(tchLab);
  f.appendChild(labeled("Дата",date));
  f.appendChild(labeled("Сумма",amount));
  box.appendChild(f);
  syncDir();

  var row=el('<div class="btnrow" style="margin-top:4px"></div>');
  var btn=el('<button class="btn pri" type="button">Внести</button>');
  btn.onclick=function(){
    var amt=+amount.value||0;
    if(!amt){toast("Укажите сумму");return;}
    if(dir.value==="in"&&!stu.value){toast("Выберите ученика");return;}
    if(dir.value==="out"&&!tch.value){toast("Выберите педагога");return;}
    savePayment({id:newId("p"),paidOn:date.value||today(),direction:dir.value,
      studentId:dir.value==="in"?stu.value:"",teacherId:dir.value==="out"?tch.value:"",
      amount:amt,note:""});
    amount.value="";
    toast("Внесено");
  };
  row.appendChild(btn);box.appendChild(row);
  return box;
}
function paymentsCard(){
  var c=el('<div class="card"><div class="chead"><h2>Движение денег</h2>'+
    '<span class="hint">Оплаты родителей и выплаты педагогам одним списком</span></div></div>');
  var h=el('<div class="ref"></div>');
  h.appendChild(acc("pay:new",'<b>Внести оплату или выплату</b>',"",payForm));
  c.appendChild(h);
  var scroll=el('<div class="tscroll"></div>');
  var tbl=el('<table><thead><tr><th>Дата</th><th>Операция</th><th>Кто</th>'+
    '<th class="r">Поступило</th><th class="r">Выплачено</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),list=paymentsList(),sIn=0,sOut=0;
  list.forEach(function(p){
    var isIn=p.direction==="in";
    var who=isIn?(state.units[p.studentId]||{}).name:(state.teachers[p.teacherId]||{}).name;
    if(isIn)sIn+=+p.amount||0;else sOut+=+p.amount||0;
    var tr=el("<tr><td>"+esc(fmtDate(p.paidOn))+"</td><td>"+
      (isIn?'<span class="pill ok">от родителя</span>':'<span class="pill warn">педагогу</span>')+
      "</td><td>"+esc(who||"запись удалена")+'</td><td class="r">'+
      (isIn?esc(fmtMoney(p.amount)):'<span class="sub">—</span>')+'</td><td class="r">'+
      (isIn?'<span class="sub">—</span>':esc(fmtMoney(p.amount)))+"</td></tr>");
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){deletePayment(p.id);toast("Запись удалена");};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="6" class="sub">Записей пока нет.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td colspan="3">Итого</td><td class="r">'+
    esc(fmtMoney(sIn))+'</td><td class="r">'+esc(fmtMoney(sOut))+"</td><td></td></tr>"));
  scroll.appendChild(tbl);c.appendChild(scroll);
  return c;
}

/* ---------- долги: подсказка, с кого спросить ---------- */
function debtsCard(){
  var rows=[];
  students().forEach(function(u){
    var d=debtOf(u);if(d<=0)return;
    rows.push({u:u,d:d,left:lessonsLeft(u)});
  });
  rows.sort(function(a,b){return b.d-a.d;});
  if(!rows.length)return null;
  var c=el('<div class="card"><div class="chead"><h2>Кто не доплатил</h2>'+
    '<span class="hint">Продано больше, чем поступило</span></div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Ученик</th><th>Родитель</th><th>Группа</th>'+
    '<th class="r">Остаток занятий</th><th class="r">Долг</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),tot=0;
  rows.forEach(function(r){
    var g=groupOf(r.u);tot+=r.d;
    tb.appendChild(el("<tr><td>"+esc(r.u.name)+"</td><td>"+esc(r.u.parent||"—")+
      '</td><td class="sub">'+(g?esc(g.name):"—")+'</td><td class="r">'+fmtNum(r.left)+
      '</td><td class="r"><b>'+esc(fmtMoney(r.d))+"</b></td></tr>"));
  });
  tb.appendChild(el('<tr class="tot"><td colspan="4">Итого</td><td class="r">'+
    esc(fmtMoney(tot))+"</td></tr>"));
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}

/* ---------- долги школы перед педагогами ---------- */
function teacherDebtCard(){
  var c=el('<div class="card"><div class="chead"><h2>Сколько должны педагогам</h2>'+
    '<span class="hint">Начислено по проведённым занятиям за всё время минус выплаты</span>'+
    '</div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr><th>Педагог</th><th class="r">Начислено</th>'+
    '<th class="r">Выплачено</th><th class="r">Осталось выплатить</th><th>Реквизиты</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),any=false,T={a:0,p:0};
  teacherList().forEach(function(t){
    var d=teacherDebt(t.id);
    if(!d.accrued&&!d.paid)return;
    any=true;T.a+=d.accrued;T.p+=d.paid;
    var bits=[t.bank,t.recipient,t.phone,t.card,t.account].filter(Boolean).join(" · ");
    tb.appendChild(el("<tr><td>"+esc(t.name)+'</td><td class="r">'+esc(fmtMoney(d.accrued))+
      '</td><td class="r">'+esc(fmtMoney(d.paid))+'</td><td class="r"><b>'+esc(fmtMoney(d.left))+
      '</b></td><td class="sub" style="max-width:250px">'+esc(bits||"не заданы")+"</td></tr>"));
  });
  if(!any)tb.appendChild(el('<tr><td colspan="5" class="sub">Пока нечего начислять.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td>Итого</td><td class="r">'+esc(fmtMoney(T.a))+
    '</td><td class="r">'+esc(fmtMoney(T.p))+'</td><td class="r">'+esc(fmtMoney(T.a-T.p))+
    "</td><td></td></tr>"));
  c.querySelector(".tscroll").appendChild(tbl);
  return c;
}

function viewDocs(){
  var wrap=el('<div class="stack"></div>');
  wrap.appendChild(billCard());
  wrap.appendChild(salesCard());
  wrap.appendChild(paymentsCard());
  var d=debtsCard();if(d)wrap.appendChild(d);
  wrap.appendChild(teacherDebtCard());
  return wrap;
}
/* ---------- экран: отчёты ---------- */
function ymRange(from,to){
  var out=[],cur=from;
  if(!from||!to||from>to)return out;
  for(var i=0;i<60&&cur<=to;i++){out.push(cur);cur=ymShift(cur,1);}
  return out;
}
function repFrom(){return state.rep.from||ymShift(state.ym,-2);}
function repTo(){return state.rep.to||state.ym;}

/* Итоги месяца считаются по фактам: продажи, поступления, проведённые занятия, выплаты. */
function monthTotals(ym){
  var t={sold:0,soldCount:0,got:0,accrued:0,paid:0,held:0,plan:0};
  subsList().forEach(function(s){
    if(ymOfDate(s.soldOn)!==ym||isCarry(s))return;
    t.sold+=+s.total||0;t.soldCount+=+s.lessons||0;
  });
  paymentsList().forEach(function(p){
    if(ymOfDate(p.paidOn)!==ym)return;
    if(p.direction==="in")t.got+=+p.amount||0;else t.paid+=+p.amount||0;
  });
  scheduleUnits().forEach(function(lu){
    var s=unitStats(lu,ym);t.held+=s.held;t.accrued+=s.payout;t.plan+=s.plan;
  });
  t.profit=t.sold-t.accrued;
  return t;
}
function csvCell(v){
  var s=String(v==null?"":v);
  return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function downloadCsv(name,rows){
  var csv=rows.map(function(r){return r.map(csvCell).join(";");}).join("\r\n");
  var blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;a.download=String(name).replace(/[^\wА-Яа-яёЁ.-]+/g,"_")+".csv";
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},0);
  toast("Файл скачан");
}
function repCard(title,hint,headers,rows,totalRow,fileName){
  var c=el('<div class="card"><div class="chead"><h2>'+esc(title)+'</h2>'+
    (hint?'<span class="hint">'+esc(hint)+"</span>":"")+"</div></div>");
  var bar=el('<div class="btnrow" style="padding:10px 14px 0"></div>');
  var dl=el('<button class="btn sm" type="button">Скачать Excel</button>');
  dl.onclick=function(){
    var data=[headers].concat(rows.map(function(r){return r.map(function(c2){return c2.v;});}));
    if(totalRow)data.push(totalRow.map(function(c2){return c2.v;}));
    downloadCsv(fileName,data);
  };
  bar.appendChild(dl);c.appendChild(bar);
  var scroll=el('<div class="tscroll"></div>');
  var tbl=document.createElement("table");
  var thead=el("<thead><tr>"+headers.map(function(h,i){
    return'<th'+(i?' class="r"':"")+">"+esc(h)+"</th>";}).join("")+"</tr></thead>");
  tbl.appendChild(thead);
  var tb=document.createElement("tbody");
  rows.forEach(function(r){
    tb.appendChild(el("<tr>"+r.map(function(c2,i){
      return"<td"+(i?' class="r"':"")+">"+esc(c2.t==null?c2.v:c2.t)+"</td>";}).join("")+"</tr>"));
  });
  if(!rows.length)tb.appendChild(el('<tr><td colspan="'+headers.length+'" class="sub">Нет данных за выбранный период.</td></tr>'));
  if(totalRow&&rows.length)tb.appendChild(el('<tr class="tot">'+totalRow.map(function(c2,i){
    return"<td"+(i?' class="r"':"")+">"+esc(c2.t==null?c2.v:c2.t)+"</td>";}).join("")+"</tr>"));
  tbl.appendChild(tb);scroll.appendChild(tbl);c.appendChild(scroll);
  return c;
}
function viewReports(){
  var wrap=el('<div class="stack"></div>');
  var from=repFrom(),to=repTo(),list=ymRange(from,to);

  /* выбор периода */
  var head=el('<div class="card"><div class="chead"><h2>Период</h2>'+
    '<span class="hint">Финансовый итог и свод по педагогам строятся по выбранным месяцам</span></div></div>');
  var picks=el('<div class="ref" style="grid-auto-flow:column;justify-content:start;gap:12px;align-items:end"></div>');
  function monthOptions(){
    var opts=[],cur=ymShift(ymOf(new Date()),-23);
    for(var i=0;i<36;i++){opts.push([cur,ymLabel(cur)]);cur=ymShift(cur,1);}
    return opts;
  }
  picks.appendChild(field("С месяца","rep-from",from,null,function(v){
    state.rep.from=v;if(v>repTo())state.rep.to=v;render();},monthOptions()));
  picks.appendChild(field("По месяц","rep-to",to,null,function(v){
    state.rep.to=v;if(v<repFrom())state.rep.from=v;render();},monthOptions()));
  head.appendChild(picks);
  wrap.appendChild(head);

  /* 1. финансовый итог по месяцам */
  var T={sold:0,soldCount:0,got:0,accrued:0,paid:0,held:0,profit:0};
  var fin=list.map(function(ym){
    var m=monthTotals(ym);
    ["sold","soldCount","got","accrued","paid","held","profit"].forEach(function(k){T[k]+=m[k];});
    return[{v:ymLabel(ym)},{v:m.soldCount},{v:m.held},
      {v:m.sold,t:fmtMoney(m.sold)},{v:m.got,t:fmtMoney(m.got)},
      {v:m.accrued,t:fmtMoney(m.accrued)},{v:m.paid,t:fmtMoney(m.paid)},
      {v:m.profit,t:fmtMoney(m.profit)}];
  });
  wrap.appendChild(repCard("Финансовый итог за период",
    "Начислено родителям — по датам начисления; начислено педагогам — по проведённым занятиям",
    ["Месяц","Начислено занятий","Проведено","Начислено родителям","Получено",
     "Начислено педагогам","Выплачено","Заработок школы"],
    fin,
    [{v:"Итого"},{v:T.soldCount},{v:T.held},
     {v:T.sold,t:fmtMoney(T.sold)},{v:T.got,t:fmtMoney(T.got)},
     {v:T.accrued,t:fmtMoney(T.accrued)},{v:T.paid,t:fmtMoney(T.paid)},
     {v:T.profit,t:fmtMoney(T.profit)}],
    "Финансовый_итог_"+from+"_"+to));

  /* 2. долги родителей — по всем продажам и оплатам, без привязки к месяцу */
  var debts=[],dTot=0;
  students().forEach(function(u){
    var d=debtOf(u);
    if(d<=0)return;
    var t=state.teachers[effTeacherId(u)]||{},g=groupOf(u);
    dTot+=d;
    debts.push([{v:u.name},{v:u.parent||""},{v:g?g.name:""},{v:t.name||""},
      {v:lessonsLeft(u)},{v:d,t:fmtMoney(d)}]);
  });
  debts.sort(function(a,b){return b[5].v-a[5].v;});
  wrap.appendChild(repCard("Долги родителей",
    "Начислено больше, чем поступило денег; считается за всё время",
    ["Ученик","Родитель","Группа","Педагог","Остаток занятий","Долг"],
    debts,[{v:"Итого"},{v:""},{v:""},{v:""},{v:""},{v:dTot,t:fmtMoney(dTot)}],
    "Долги_родителей"));

  /* 3. по педагогам за период */
  var byT=[],P={held:0,accrued:0,paid:0};
  teacherList().forEach(function(t){
    var held=0,accrued=0,paid=0;
    list.forEach(function(ym){
      lessonUnitsOf(t.id).forEach(function(lu){
        var s=unitStats(lu,ym);held+=s.held;accrued+=s.payout;
      });
      paymentsList().forEach(function(p){
        if(p.direction==="out"&&p.teacherId===t.id&&ymOfDate(p.paidOn)===ym)paid+=+p.amount||0;
      });
    });
    if(!held&&!accrued&&!paid)return;
    P.held+=held;P.accrued+=accrued;P.paid+=paid;
    byT.push([{v:t.name},{v:held},{v:accrued,t:fmtMoney(accrued)},{v:paid,t:fmtMoney(paid)},
      {v:accrued-paid,t:fmtMoney(accrued-paid)}]);
  });
  wrap.appendChild(repCard("По педагогам",
    "Начислено — за проведённые занятия по назначенной ставке",
    ["Педагог","Проведено","Начислено","Выплачено","Разница"],
    byT,[{v:"Итого"},{v:P.held},{v:P.accrued,t:fmtMoney(P.accrued)},
      {v:P.paid,t:fmtMoney(P.paid)},{v:P.accrued-P.paid,t:fmtMoney(P.accrued-P.paid)}],
    "По_педагогам_"+from+"_"+to));
  return wrap;
}
/* ---------- Supabase ---------- */
var sb=null,session=null;

function num(v){return v==null?0:+v;}
function teacherFromRow(r){
  return{id:r.id,name:r.name||"",order:r.order_no,active:r.active!==false,
    bank:r.bank||"",recipient:r.recipient||"",phone:r.phone||"",card:r.card||"",account:r.account||"",
    bik:r.bik||"",corr:r.corr_account||"",inn:r.inn||"",kpp:r.kpp||"",purpose:r.purpose||"",note:r.note||""};
}
function teacherToRow(t){
  return{id:t.id,name:t.name||"",order_no:t.order==null?100:t.order,active:t.active!==false,
    bank:t.bank||"",recipient:t.recipient||"",phone:t.phone||"",card:t.card||"",
    account:t.account||"",bik:t.bik||"",corr_account:t.corr||"",inn:t.inn||"",kpp:t.kpp||"",
    purpose:t.purpose||"",note:t.note||""};
}
function unitFromRow(r){
  return{id:r.id,kind:r.kind||"solo",name:r.name||"",parent:r.parent||"",teacherId:r.teacher_id||"",
    weekdays:(r.weekdays||[]).map(Number),memberIds:r.member_ids||[],groupId:r.group_id||"",
    rateName:r.rate_name||"",channel:r.channel||"",active:r.active!==false,order:r.order_no};
}
function unitToRow(u){
  return{id:u.id,kind:u.kind||"solo",name:u.name||"",parent:u.parent||"",teacher_id:u.teacherId||"",
    weekdays:(u.weekdays||[]).map(Number),member_ids:u.memberIds||[],group_id:u.groupId||"",
    rate_name:u.rateName||"",channel:u.channel||"",active:u.active!==false,
    order_no:u.order==null?900:u.order,format:u.kind==="group"?"group":"individual"};
}
function monthFromRow(r){return{unitId:r.unit_id,month:r.month,days:r.days||{},note:r.note||""};}
function subFromRow(r){
  return{id:r.id,studentId:r.student_id,soldOn:r.sold_on,pkg:r.package_name||"",
    lessons:+r.lessons||0,price:num(r.price),discount:num(r.discount),total:num(r.total),note:r.note||""};
}
function subToRow(s){
  return{id:s.id,student_id:s.studentId,sold_on:s.soldOn,package_name:s.pkg||"",
    lessons:+s.lessons||0,price:num(s.price),discount:num(s.discount),total:num(s.total),note:s.note||""};
}
function payFromRow(r){
  return{id:r.id,paidOn:r.paid_on,direction:r.direction,studentId:r.student_id||"",
    teacherId:r.teacher_id||"",amount:num(r.amount),note:r.note||""};
}
function payToRow(p){
  return{id:p.id,paid_on:p.paidOn,direction:p.direction,student_id:p.studentId||"",
    teacher_id:p.teacherId||"",amount:num(p.amount),note:p.note||""};
}
function oops(res){if(res.error)throw res.error;return res.data;}

var API={
  loadAll:function(){
    return Promise.all([
      sb.from("oe_teachers").select("*").order("order_no",{ascending:true}),
      sb.from("oe_units").select("*").order("order_no",{ascending:true}),
      sb.from("oe_settings").select("*").maybeSingle(),
      sb.from("oe_months").select("*"),
      sb.from("oe_subscriptions").select("*"),
      sb.from("oe_payments").select("*")
    ]).then(function(r){
      var teachers={},units={},months={},subs={},payments={};
      oops(r[0]).forEach(function(row){teachers[row.id]=teacherFromRow(row);});
      oops(r[1]).forEach(function(row){units[row.id]=unitFromRow(row);});
      var s=r[2].error?null:r[2].data;
      oops(r[3]).forEach(function(row){months[row.month+"__"+row.unit_id]=monthFromRow(row);});
      oops(r[4]).forEach(function(row){subs[row.id]=subFromRow(row);});
      oops(r[5]).forEach(function(row){payments[row.id]=payFromRow(row);});
      return{teachers:teachers,units:units,months:months,subs:subs,payments:payments,
        settings:s?{tariffs:s.tariffs||[],packages:s.packages||[],
                    teacherTariffs:s.teacher_tariffs||[]}:{}};
    });
  },
  saveMonth:function(m){
    return sb.from("oe_months").upsert({owner:session.user.id,unit_id:m.unitId,month:m.month,
      days:m.days||{},pay:{},note:m.note||""},{onConflict:"owner,unit_id,month"}).then(oops);
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
    return sb.from("oe_settings").upsert({owner:session.user.id,
      tariffs:s.tariffs||[],packages:s.packages||[],
      teacher_tariffs:s.teacherTariffs||[]},{onConflict:"owner"}).then(oops);
  },
  saveSub:function(s){
    var row=subToRow(s);row.owner=session.user.id;
    return sb.from("oe_subscriptions").upsert(row,{onConflict:"owner,id"}).then(oops);
  },
  deleteSub:function(id){
    return sb.from("oe_subscriptions").delete().eq("id",id).then(oops);
  },
  savePayment:function(p){
    var row=payToRow(p);row.owner=session.user.id;
    return sb.from("oe_payments").upsert(row,{onConflict:"owner,id"}).then(oops);
  },
  deletePayment:function(id){
    return sb.from("oe_payments").delete().eq("id",id).then(oops);
  }
};

/* ---------- вход ---------- */
function authScreen(msg,kind){
  var box=el('<div class="authwrap"><div class="authcard">'+
    '<h2>Занятия и оплаты</h2>'+
    '<p class="authsub">Учёт занятий, абонементов и денег онлайн-школы.</p>'+
    '</div></div>');
  var card=box.querySelector(".authcard");
  var form=document.createElement("form");form.className="authform";
  var email=el('<label class="f">Email</label>');
  var ei=document.createElement("input");ei.type="email";ei.id="auth-email";ei.required=true;ei.autocomplete="username";
  try{ei.value=localStorage.getItem("oe.email")||"";}catch(e){}
  email.appendChild(ei);
  var pass=el('<label class="f">Пароль</label>');
  var pi=document.createElement("input");pi.type="password";pi.id="auth-pass";pi.required=true;
  pi.autocomplete="current-password";pi.minLength=8;
  pass.appendChild(pi);
  form.appendChild(email);form.appendChild(pass);
  var row=el('<div class="btnrow" style="margin-top:4px"></div>');
  var inBtn=el('<button class="btn pri" type="submit">Войти</button>');
  var upBtn=el('<button class="btn" type="button">Создать вход</button>');
  row.appendChild(inBtn);row.appendChild(upBtn);form.appendChild(row);
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

/* ---------- загрузка ---------- */
function reloadAll(){
  return API.loadAll().then(function(d){
    state.teachers=d.teachers;state.units=d.units;state.settings=d.settings;
    state.months=d.months;state.subs=d.subs;state.payments=d.payments;
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
}

/* ---------- запуск ---------- */
function boot(){
  document.getElementById("chrome").hidden=false;
  state.err=null;render();reloadAll();
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
