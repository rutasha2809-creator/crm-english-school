(function(){"use strict";

var MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
var MONTHS_IN=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
var DOW=["пн","вт","ср","чт","пт","сб","вс"];
var STATUS_ORDER_PLAN=["none","plan","done","pc","c"];
var MARK={plan:"",done:"✓",pc:"₽",c:"×"};
var CLS={plan:"c-plan",done:"c-done",pc:"c-pc",c:"c-c",off:"c-off"};

var state={tab:"month",ref:"teachers",sale:null,cal:{},rep:{from:null,to:null},ym:null,
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
function teacherTariffs(){return state.settings.teacherTariffs||[];}
/* Цена одного занятия для ученика по тарифу клиента. */
function tariffPrice(name){
  var t=tariffs().filter(function(x){return x.name===name;})[0];
  return t?(+t.price||0):0;
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
/* План месяца — даты, отмеченные в календаре учебной единицы. */
function planDays(u,ym){
  var md=mdoc(u,ym),days=md.days||{},out=[];
  for(var d=1;d<=daysIn(ym);d++){
    var s=days[String(d)];
    if(s&&s!=="off")out.push(d);
  }
  return out;
}
function dayStatus(u,ym,day,md){
  return(md.days||{})[String(day)]||"none";
}
/* Скопировать план прошлого месяца: те же дни недели, те же недели месяца. */
function copyPlanFrom(u,fromYm,toYm){
  var src=mdoc(u,fromYm).days||{},patch={},n=0;
  var wd={};
  Object.keys(src).forEach(function(k){
    var d=+k;if(!d||src[k]==="off")return;
    wd[dowOf(fromYm,d)]=1;
  });
  if(!Object.keys(wd).length)return 0;
  for(var d2=1;d2<=daysIn(toYm);d2++){
    if(wd[dowOf(toYm,d2)]&&!(mdoc(u,toYm).days||{})[String(d2)]){patch[String(d2)]="plan";n++;}
  }
  if(n)saveMonth2(u,toYm,patch);
  return n;
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
/* Посещение ученика в конкретный день.
   По умолчанию ученик идёт за своей учебной единицей; отметка в его строке
   журнала — исключение: не пришёл или пропустил с оплатой. */
function studentStatus(u,ym,day){
  var own=(mdoc(u,ym).days||{})[String(day)];
  if(own)return own;
  var g=groupOf(u);
  return g?dayStatus(g,ym,day,mdoc(g,ym)):"none";
}
function isOwnMark(u,ym,day){return !!(mdoc(u,ym).days||{})[String(day)];}
/* Занятия ученика за месяц: израсходованными считаются проведённые
   и пропуски с оплатой. */
function studentStats(u,ym){
  ym=ym||state.ym;
  var n=daysIn(ym),plan=0,done=0,pc=0,canc=0;
  for(var d=1;d<=n;d++){
    var s=studentStatus(u,ym,d);
    if(s==="plan")plan++;
    else if(s==="done"){done++;plan++;}
    else if(s==="pc"){pc++;plan++;}
    else if(s==="c"){canc++;plan++;}
  }
  return{plan:plan,done:done,pc:pc,canc:canc,held:done+pc};
}
/* Сколько занятий израсходовано учеником за всё время или за месяц. */
function heldOf(u,ym){
  if(ym)return studentStats(u,ym).held;
  var total=0;
  monthsWithLessons().forEach(function(m){total+=studentStats(u,m).held;});
  return total;
}

/* ---------- начисления и оплаты ---------- */
/* Тариф клиента: ученик в группе берёт его от группы, как и ставку педагога. */
function tariffNameOf(u){
  var g=groupOf(u);
  return(g?g.tariffName:u.tariffName)||"";
}
function priceOf(u){return tariffPrice(tariffNameOf(u));}
/* Начисление ученику за месяц — одна строка на «ученик + месяц». */
function billId(u,ym){return "bill-"+ym+"-"+u.id;}
function billOf(u,ym){return state.subs[billId(u,ym)]||null;}
function billTotal(b){
  var gross=(+b.lessons||0)*(+b.price||0);
  return Math.max(0,Math.round(gross-gross*(+b.discount||0)/100)-(+b.gift||0));
}
/* Фактическая оплата родителя за месяц — одна строка на «ученик + месяц». */
function payId(u,ym){return "in-"+ym+"-"+u.id;}
function paidOf(u,ym){var p=state.payments[payId(u,ym)];return p?+p.amount||0:0;}

/* ---------- документы ---------- */
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
/* Видимое подтверждение: каждая правка уходит в базу сразу, индикатор в шапке
   показывает, идёт ли запись и когда данные сохранились. */
var saving=0,savedAt=null,saveErr=null;
function saveBadge(){
  var n=document.getElementById("h-save");
  if(!n)return;
  n.className="savebadge";
  if(saveErr){n.classList.add("bad");n.textContent="Не сохранено: "+saveErr;return;}
  if(saving>0){n.classList.add("busy");n.textContent="Сохраняю…";return;}
  if(savedAt){
    n.classList.add("ok");
    n.textContent="Сохранено в "+pad(savedAt.getHours())+":"+pad(savedAt.getMinutes());
    return;
  }
  n.textContent="";
}
function track(p){
  saving++;saveErr=null;saveBadge();
  return p.then(function(r){
    saving--;savedAt=new Date();saveBadge();return r;
  },function(e){
    saving--;saveErr=(e&&(e.message||e.code))||"ошибка";saveBadge();throw e;
  });
}
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
  pending[id]=track(API.saveMonth(next)).catch(saveFailed).then(function(){delete pending[id];});
  return pending[id];
}
/* Запись отметок в произвольный месяц, не только в выбранный. */
function saveMonth2(u,ym,days){
  if(!needWrite())return Promise.resolve();
  var id=ym+"__"+u.id;
  var cur=state.months[id]||{unitId:u.id,month:ym,days:{}};
  var next={unitId:u.id,month:ym,days:Object.assign({},cur.days||{},days),note:cur.note||""};
  for(var k in next.days){if(!next.days[k])delete next.days[k];}
  state.months[id]=next;render();
  return track(API.saveMonth(next)).catch(saveFailed);
}
function saveUnit(uid,patch){
  if(!needWrite())return Promise.resolve();
  var cur=state.units[uid];if(!cur)return Promise.resolve();
  var next=Object.assign({},cur,patch);next.id=uid;
  state.units[uid]=next;render();
  return track(API.saveUnit(uid,next)).catch(saveFailed);
}
function saveTeacher(tid,patch){
  if(!needWrite())return Promise.resolve();
  var cur=state.teachers[tid];if(!cur)return Promise.resolve();
  var next=Object.assign({},cur,patch);next.id=tid;
  state.teachers[tid]=next;render();
  return track(API.saveTeacher(tid,next)).catch(saveFailed);
}
function saveSettingList(name,value){
  if(!needWrite())return Promise.resolve();
  var next=Object.assign({},state.settings);next[name]=value;
  state.settings=next;render();
  return track(API.saveSettings(next)).catch(saveFailed);
}
/* продажа абонемента */
function saveSub(sub){
  if(!needWrite())return Promise.resolve();
  state.subs[sub.id]=sub;render();
  return track(API.saveSub(sub)).catch(saveFailed);
}
function deleteSub(id){
  if(!needWrite())return Promise.resolve();
  delete state.subs[id];render();
  return track(API.deleteSub(id)).catch(saveFailed);
}
/* движение денег */
function savePayment(p){
  if(!needWrite())return Promise.resolve();
  state.payments[p.id]=p;render();
  return track(API.savePayment(p)).catch(saveFailed);
}
function deletePayment(id){
  if(!needWrite())return Promise.resolve();
  delete state.payments[id];render();
  return track(API.deletePayment(id)).catch(saveFailed);
}
/* ---------- переименование в справочниках ---------- */
/* Ссылки на старое название обновляются сами. Проданные абонементы не трогаем:
   в них цена и количество занятий зафиксированы в момент продажи. */
function renameRefs(kind,oldName,newName){
  if(!oldName||oldName===newName)return;
  if(kind==="tariffs"){
    for(var j in state.units){
      var u2=state.units[j];
      if(u2.tariffName===oldName)saveUnit(u2.id,{tariffName:newName});
    }
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
    '<span><i class="c-c">×</i>не было, без оплаты</span>'+
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
      var members=lu.kind==="group"?groupMembers(lu):[];
      var label=lu.kind==="group"?lu.name+" ("+members.length+")":lu.name;
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
      /* посещаемость каждого ученика группы: по умолчанию как у группы */
      members.forEach(function(m){
        var ms=studentStats(m,ym);
        grid.appendChild(el('<div class="name sub" title="'+esc(m.name)+'" style="padding-left:16px">'+
          esc(m.name)+"</div>"));
        for(var d3=1;d3<=n;d3++){
          var gst=dayStatus(lu,ym,d3,md);
          var st2=studentStatus(m,ym,d3),own=isOwnMark(m,ym,d3);
          var mb=document.createElement("button");
          mb.type="button";
          mb.className="cell"+(st2!=="none"?" "+CLS[st2]:"")+(own?"":" inherit");
          mb.textContent=MARK[st2]||"";
          mb.title=m.name+", "+d3+" "+MONTHS_IN[ymParts(ym).m-1]+
            (own?"":" — как у группы");
          mb.disabled=gst==="none";
          mb.setAttribute("data-m",m.id);mb.setAttribute("data-g",lu.id);mb.setAttribute("data-d",d3);
          mb.onclick=onMemberCell;
          grid.appendChild(mb);
        }
        grid.appendChild(el('<div class="sum sub">'+fmtNum(ms.plan)+"</div>"));
        grid.appendChild(el('<div class="sum sub" style="color:var(--ok)">'+fmtNum(ms.held)+"</div>"));
      });
    });
  });
  scroll.appendChild(grid);card.appendChild(scroll);wrap.appendChild(card);

  var noWd=scheduleUnits().filter(function(lu){return !planDays(lu,ym).length;})
    .map(function(lu){return lu.name;});
  if(noWd.length)wrap.appendChild(el('<div class="card"><p class="warnbox" style="border-bottom:0;border-radius:var(--r)">'+
    'Занятия в этом месяце не назначены: '+esc(noWd.join(", "))+"</p></div>"));
  return wrap;
}
function onCell(ev){
  var uid=ev.currentTarget.getAttribute("data-u"),d=+ev.currentTarget.getAttribute("data-d");
  var lu=state.units[uid];if(!lu)return;
  var md=mdoc(lu),cur=dayStatus(lu,state.ym,d,md);
  var order=STATUS_ORDER_PLAN;
  var i=order.indexOf(cur);if(i<0)i=0;
  var next=order[(i+1)%order.length];
  var patch={};
  patch[String(d)]=next==="none"?null:next;
  saveMonth(lu,{days:patch});
}
/* Клик по строке ученика: как у группы → не пришёл → пропуск с оплатой. */
function onMemberCell(ev){
  var mid=ev.currentTarget.getAttribute("data-m"),d=+ev.currentTarget.getAttribute("data-d");
  var m=state.units[mid];if(!m)return;
  var own=(mdoc(m,state.ym).days||{})[String(d)];
  var next=own==="c"?"pc":own==="pc"?null:"c";
  var patch={};patch[String(d)]=next;
  saveMonth(m,{days:patch});
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
  {id:"rates",label:"Тарифы педагогов"}
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
/* Короткая сводка плана месяца. */
function wdText(u){
  var lu=u.kind==="group"?u:lessonUnit(u),n=planDays(lu,state.ym).length;
  return n?n+" зан. в "+MONTHS_IN[ymParts(state.ym).m-1]:"занятия не назначены";
}
/* Полный список дат — для карточки ученика, где план только для просмотра. */
function planText(u){
  var lu=u.kind==="group"?u:lessonUnit(u),days=planDays(lu,state.ym);
  if(!days.length)return "занятия не назначены";
  return days.join(", ")+" "+MONTHS_IN[ymParts(state.ym).m-1];
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
          tariffs:refTariffs,rates:refRates}[state.ref||"teachers"];
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
      g.tariffName||"тариф не выбран",
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
      u.tariffName||"тариф не выбран",wdText(u)].join(" · ");
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
  f.appendChild(field("Тариф ученика","il-tn-"+u.id,u.tariffName||"",null,
    function(v){saveUnit(u.id,{tariffName:v});},tariffOptions(u.tariffName)));
  f.appendChild(readField("Родитель",u.parent||"не указан"));
  row.appendChild(f);
  row.appendChild(planField(u));
  row.appendChild(el('<p class="sub" style="margin:0">Остаток занятий: '+fmtNum(lessonsLeft(u))+
    " · долг по всем месяцам: "+esc(fmtMoney(debtOf(u)))+"</p>"));
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
function tariffOptions(current){
  var opts=[["","— без тарифа —"]].concat(tariffs().map(function(x){
    return[x.name,x.name+" · "+fmtMoney(x.price)];}));
  if(current&&!tariffs().some(function(x){return x.name===current;}))
    opts.push([current,current+" — тарифа нет в справочнике"]);
  return opts;
}
function rateOptions(current){
  var opts=[["","— без тарифа —"]].concat(teacherTariffs().map(function(x){
    return[x.name,x.name+" · "+fmtMoney(x.price)];}));
  /* если назначенный тариф удалён из справочника, не теряем его молча */
  if(current&&!rateExists(current))opts.push([current,current+" — тарифа нет в справочнике"]);
  return opts;
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
/* Календарь месяца: клик по дате ставит или снимает занятие.
   Месяц выбирается стрелками в самой карточке, независимо от шапки. */
function calYm(u){return(state.cal||{})[u.id]||state.ym;}
function setCalYm(u,ym){
  state.cal=state.cal||{};state.cal[u.id]=ym;render();
}
function datePicker(u,ym){
  var n=daysIn(ym),md=mdoc(u,ym);
  var box=el('<div class="cal"></div>');
  DOW.forEach(function(name){box.appendChild(el('<span class="calhd">'+name+"</span>"));});
  var shift=dowOf(ym,1)-1;
  for(var i=0;i<shift;i++)box.appendChild(el('<span class="calgap"></span>'));
  for(var d=1;d<=n;d++){
    (function(day){
      var st=dayStatus(u,ym,day,md),on=st!=="none";
      var b=el('<button type="button" class="calday'+(on?" on":"")+'">'+day+"</button>");
      b.id="cd-"+u.id+"-"+day;
      b.setAttribute("aria-pressed",on?"true":"false");
      b.title=day+" "+MONTHS_IN[ymParts(ym).m-1]+", "+DOW[dowOf(ym,day)-1];
      b.onclick=function(){
        var patch={};patch[String(day)]=on?null:"plan";
        saveMonth2(u,ym,patch);
      };
      box.appendChild(b);
    })(d);
  }
  return box;
}
function planField(u){
  var ym=calYm(u);
  var lab=el('<label class="f">Занятия по месяцам</label>');
  var nav=el('<div class="calnav"></div>');
  var prevM=el('<button class="btn sm" type="button" aria-label="Предыдущий месяц">‹</button>');
  var nextM=el('<button class="btn sm" type="button" aria-label="Следующий месяц">›</button>');
  var lbl=el('<b class="calmonth">'+esc(ymLabel(ym))+"</b>");
  prevM.onclick=function(){setCalYm(u,ymShift(ym,-1));};
  nextM.onclick=function(){setCalYm(u,ymShift(ym,1));};
  nav.appendChild(prevM);nav.appendChild(lbl);nav.appendChild(nextM);
  lab.appendChild(nav);
  lab.appendChild(datePicker(u,ym));
  var row=el('<div class="btnrow" style="margin-top:6px"></div>');
  var copy=el('<button class="btn sm" type="button">Повторить '+esc(ymLabel(ymShift(ym,-1)))+"</button>");
  copy.onclick=function(){
    var n=copyPlanFrom(u,ymShift(ym,-1),ym);
    toast(n?"Добавлено занятий: "+n:"В "+ymLabel(ymShift(ym,-1))+" занятий не было");
  };
  row.appendChild(copy);
  lab.appendChild(row);
  return lab;
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
      f.appendChild(readField("Тариф ученика",(g.tariffName||"не выбран")+
        (g.tariffName?" · "+fmtMoney(tariffPrice(g.tariffName)):"")));
    }else{
      var ti=state.teachers[u.teacherId]||{};
      f.appendChild(readField("Группа","занимается индивидуально"));
      f.appendChild(readField("Педагог",ti.name||"не выбран"));
      f.appendChild(readField("Ставка педагога",(u.rateName||"не выбрана")+
        (u.rateName?" · "+fmtMoney(teacherRate(u.rateName)):"")));
      f.appendChild(readField("Тариф ученика",(u.tariffName||"не выбран")+
        (u.tariffName?" · "+fmtMoney(tariffPrice(u.tariffName)):"")));
    }
    row.appendChild(f);
    row.appendChild(readField("Занятия в "+ymLabel(state.ym),planText(u)));
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
  f.appendChild(field("Тариф ученика","u-tn-"+u.id,u.tariffName||"",null,
    function(v){saveUnit(u.id,{tariffName:v});},tariffOptions(u.tariffName)));
  row.appendChild(f);
  row.appendChild(planField(u));

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
    teacherId:"",rateName:"",tariffName:"",weekdays:[],active:true,
    order:900+Object.keys(state.units).length,channel:"",
    memberIds:[],groupId:""};
  state.units[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open[(kind==="group"?"g:":"u:")+id]=1;
  render();
  track(API.saveUnit(id,body)).catch(saveFailed);
}
function addTeacher(){
  if(!needWrite())return;
  var id=newId("t");
  var body={name:"Новый педагог",order:100+teacherList().length,active:true,
    bank:"",recipient:"",phone:"",card:"",account:"",bik:"",corr:"",inn:"",kpp:"",purpose:"",note:""};
  state.teachers[id]=Object.assign({id:id},body);
  state.open=state.open||{};state.open["t:"+id]=1;
  render();
  track(API.saveTeacher(id,body)).catch(saveFailed);
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
/* ---------- начисление за месяц ---------- */
/* Одна строка на ученика: занятия по плану минус остаток, цена занятия из его
   тарифа, скидка и подарок, сумма и фактическая оплата. */
function billYm(){return state.ym;}
function billRow(u){
  var ym=billYm(),plan=planDays(lessonUnit(u),ym).length;
  var b=billOf(u,ym),left=lessonsLeft(u);
  var leftBefore=left+(b?+b.lessons||0:0);
  var toBill=Math.max(0,plan-Math.max(0,leftBefore));
  return{u:u,plan:plan,left:left,leftBefore:leftBefore,toBill:toBill,b:b,
    paid:paidOf(u,ym)};
}
/* Остаток правится прямо в таблице: разница живёт отдельной строкой-поправкой. */
function adjId(u){return "adj-"+u.id;}
function setLeft(u,value){
  var cur=lessonsLeft(u),old=state.subs[adjId(u)],had=old?+old.lessons||0:0;
  saveSub({id:adjId(u),studentId:u.id,ym:"",soldOn:ymShift(state.ym,-1)+"-28",
    pkg:"Перенос с прошлого периода",lessons:had+(value-cur),price:0,discount:0,
    gift:0,total:0,note:"carry"});
}
function leftCell(u){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.step="1";i.className="amt";i.style.width="68px";
  i.id="left-"+u.id;i.value=lessonsLeft(u);
  i.onchange=function(){setLeft(u,+i.value||0);};
  td.appendChild(i);return td;
}
function makeBill(u,lessons){
  var ym=billYm();
  saveSub({id:billId(u,ym),studentId:u.id,ym:ym,soldOn:ym+"-01",pkg:tariffNameOf(u),
    lessons:lessons,price:priceOf(u),discount:0,gift:0,
    total:Math.round(lessons*priceOf(u)),note:""});
}
function patchBill(u,patch){
  var ym=billYm(),cur=billOf(u,ym);if(!cur)return;
  var next=Object.assign({},cur,patch);
  next.total=billTotal(next);
  saveSub(next);
}
function setPaid(u,amount){
  var ym=billYm();
  savePayment({id:payId(u,ym),paidOn:ym+"-01",direction:"in",studentId:u.id,
    teacherId:"",amount:amount,note:""});
}
function numCell(id,value,width,step,onchange,suffix){
  var td=document.createElement("td");td.className="r";
  var i=document.createElement("input");
  i.type="number";i.step=step||"1";i.className="amt";i.style.width=width+"px";
  i.id=id;i.value=value===0?"0":value;
  i.onchange=function(){onchange(+i.value||0);};
  td.appendChild(i);
  if(suffix)td.appendChild(document.createTextNode(" "+suffix));
  return td;
}
function billCard(){
  var ym=billYm();
  var c=el('<div class="card"><div class="chead"><h2>Начисления за '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Занятий по плану минус остаток, цена из тарифа ученика; скидка в процентах, подарок в рублях</span>'+
    '</div></div>');
  var bar=el('<div class="btnrow" style="padding:10px 14px 0"></div>');
  var all=el('<button class="btn pri" type="button">Начислить всем по плану</button>');
  all.onclick=function(){
    var n=0;
    students().forEach(function(u){
      var r=billRow(u);
      if(r.b||!r.toBill)return;
      makeBill(u,r.toBill);n++;
    });
    toast(n?"Начислено ученикам: "+n:"Всем уже начислено");
  };
  bar.appendChild(all);c.appendChild(bar);
  var scroll=el('<div class="tscroll"></div>');
  var tbl=el('<table><thead><tr><th>Ученик</th><th>Группа</th>'+
    '<th class="r">По плану</th><th class="r">Остаток</th><th class="r">Занятий</th>'+
    '<th class="r">Цена</th><th class="r">Скидка, %</th><th class="r">Подарок, ₽</th>'+
    '<th class="r">К оплате</th><th class="r">Оплачено</th><th class="r">Долг</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),T={plan:0,charge:0,paid:0};
  students().forEach(function(u){
    var r=billRow(u),g=groupOf(u),tr=document.createElement("tr");
    T.plan+=r.plan;
    tr.appendChild(el("<td>"+esc(u.name)+"</td>"));
    tr.appendChild(el('<td class="sub">'+(g?esc(g.name):"—")+"</td>"));
    tr.appendChild(el('<td class="r sub">'+fmtNum(r.plan)+"</td>"));
    tr.appendChild(leftCell(u));
    if(!r.b){
      tr.appendChild(el('<td class="r"><b>'+fmtNum(r.toBill)+"</b></td>"));
      tr.appendChild(el('<td colspan="5" class="sub">'+
        (priceOf(u)?"начисление ещё не сделано":"не выбран тариф ученика")+"</td>"));
      tr.appendChild(el('<td class="r sub">—</td>'));
      var td0=document.createElement("td");
      var mk=el('<button class="btn sm" type="button">Начислить</button>');
      mk.onclick=function(){makeBill(u,r.toBill);};
      if(!r.toBill||!priceOf(u))mk.disabled=true;
      td0.appendChild(mk);tr.appendChild(td0);
      tb.appendChild(tr);return;
    }
    var b=r.b,charge=billTotal(b),debt=charge-r.paid;
    T.charge+=charge;T.paid+=r.paid;
    tr.appendChild(numCell("b-les-"+u.id,b.lessons,66,"1",function(v){patchBill(u,{lessons:v});}));
    tr.appendChild(numCell("b-pr-"+u.id,b.price,86,"50",function(v){patchBill(u,{price:v});}));
    tr.appendChild(numCell("b-dis-"+u.id,b.discount||0,66,"1",function(v){patchBill(u,{discount:v});}));
    tr.appendChild(numCell("b-gift-"+u.id,b.gift||0,86,"100",function(v){patchBill(u,{gift:v});}));
    tr.appendChild(el('<td class="r"><b>'+esc(fmtMoney(charge))+"</b></td>"));
    tr.appendChild(numCell("b-paid-"+u.id,r.paid,96,"100",function(v){setPaid(u,v);}));
    tr.appendChild(el('<td class="r nowrap">'+
      (debt>0?'<span class="pill warn">'+esc(fmtMoney(debt))+"</span>":
       debt<0?'<span class="pill ok">переплата '+esc(fmtMoney(-debt))+"</span>":
       '<span class="pill ok">оплачено</span>')+"</td>"));
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Убрать</button>');
    rm.onclick=function(){deleteSub(b.id);toast("Начисление убрано");};
    td.appendChild(rm);tr.appendChild(td);
    tb.appendChild(tr);
  });
  if(!students().length)tb.appendChild(el('<tr><td colspan="12" class="sub">Пока ни одного ученика.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td colspan="2">Итого</td><td class="r">'+fmtNum(T.plan)+
    '</td><td colspan="5"></td><td class="r">'+esc(fmtMoney(T.charge))+'</td><td class="r">'+
    esc(fmtMoney(T.paid))+'</td><td class="r">'+esc(fmtMoney(T.charge-T.paid))+"</td><td></td></tr>"));
  scroll.appendChild(tbl);c.appendChild(scroll);
  return c;
}

/* ---------- движение денег ---------- */
function payForm(){
  var box=el('<div class="refrow"></div>');
  var f=el('<div class="fields"></div>');
  var dir=sel("pay-dir",[["out","Выплата педагогу"]],"out");
  var stu=sel("pay-student",studentOptions(),"");
  var tch=sel("pay-teacher",[["","— выбрать педагога —"]].concat(teacherList().map(function(t){
    return[t.id,t.name];})),"");
  var date=inp("pay-date","date",today());
  var amount=inp("pay-amount","number","",120,"50");
  f.appendChild(labeled("Педагог",tch));
  f.appendChild(labeled("Дата",date));
  f.appendChild(labeled("Сумма",amount));
  box.appendChild(f);

  var row=el('<div class="btnrow" style="margin-top:4px"></div>');
  var btn=el('<button class="btn pri" type="button">Внести</button>');
  btn.onclick=function(){
    var amt=+amount.value||0;
    if(!amt){toast("Укажите сумму");return;}
    if(!tch.value){toast("Выберите педагога");return;}
    savePayment({id:newId("p"),paidOn:date.value||today(),direction:"out",
      studentId:"",teacherId:tch.value,amount:amt,note:""});
    amount.value="";
    toast("Внесено");
  };
  row.appendChild(btn);box.appendChild(row);
  return box;
}
function paymentsCard(){
  var c=el('<div class="card"><div class="chead"><h2>Выплаты педагогам</h2>'+
    '<span class="hint">Оплаты родителей вносятся в таблице начислений, в колонке «Оплачено»</span></div></div>');
  var h=el('<div class="ref"></div>');
  h.appendChild(acc("pay:new",'<b>Внести выплату педагогу</b>',"",payForm));
  c.appendChild(h);
  var scroll=el('<div class="tscroll"></div>');
  var tbl=el('<table><thead><tr><th>Дата</th><th>Педагог</th>'+
    '<th class="r">Выплачено</th><th></th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody"),sOut=0;
  var list=paymentsList().filter(function(p){return p.direction==="out";});
  list.forEach(function(p){
    var who=(state.teachers[p.teacherId]||{}).name;
    sOut+=+p.amount||0;
    var tr=el("<tr><td>"+esc(fmtDate(p.paidOn))+"</td><td>"+esc(who||"запись удалена")+
      '</td><td class="r">'+esc(fmtMoney(p.amount))+"</td></tr>");
    var td=document.createElement("td");
    var rm=el('<button class="btn sm" type="button">Удалить</button>');
    rm.onclick=function(){deletePayment(p.id);toast("Запись удалена");};
    td.appendChild(rm);tr.appendChild(td);tb.appendChild(tr);
  });
  if(!list.length)tb.appendChild(el('<tr><td colspan="4" class="sub">Выплат пока нет.</td></tr>'));
  else tb.appendChild(el('<tr class="tot"><td colspan="2">Итого</td><td class="r">'+
    esc(fmtMoney(sOut))+"</td><td></td></tr>"));
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
    '<span class="hint">Начислено больше, чем поступило</span></div><div class="tscroll"></div></div>');
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
    rateName:r.rate_name||"",tariffName:r.tariff_name||"",channel:r.channel||"",active:r.active!==false,order:r.order_no};
}
function unitToRow(u){
  return{id:u.id,kind:u.kind||"solo",name:u.name||"",parent:u.parent||"",teacher_id:u.teacherId||"",
    weekdays:(u.weekdays||[]).map(Number),member_ids:u.memberIds||[],group_id:u.groupId||"",
    rate_name:u.rateName||"",tariff_name:u.tariffName||"",channel:u.channel||"",active:u.active!==false,
    order_no:u.order==null?900:u.order,format:u.kind==="group"?"group":"individual"};
}
function monthFromRow(r){return{unitId:r.unit_id,month:r.month,days:r.days||{},note:r.note||""};}
function subFromRow(r){
  return{id:r.id,studentId:r.student_id,soldOn:r.sold_on,ym:r.ym||ymOfDate(r.sold_on),
    pkg:r.package_name||"",lessons:+r.lessons||0,price:num(r.price),discount:num(r.discount),
    gift:num(r.gift),total:num(r.total),note:r.note||""};
}
function subToRow(s){
  return{id:s.id,student_id:s.studentId,sold_on:s.soldOn,ym:s.ym||ymOfDate(s.soldOn),
    package_name:s.pkg||"",lessons:+s.lessons||0,price:num(s.price),discount:num(s.discount),
    gift:num(s.gift),total:num(s.total),note:s.note||""};
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
