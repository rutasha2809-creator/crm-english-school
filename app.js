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

var state={tab:"month",ym:null,teachers:{},units:{},months:{},payouts:{},settings:{},ready:false,err:null};


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
function paySlots(u){
  if(u.kind==="group")return members(u).map(function(m){return{key:m.id,name:m.name,parent:m.parent,price:+m.price||0,note:m.note};});
  return[{key:"solo",name:u.name,parent:u.parent,price:+u.price||0,note:u.note}];
}
function receivedOf(u){
  var md=mdoc(u),p=md.pay||{},s=0;
  paySlots(u).forEach(function(sl){s+=+((p[sl.key]||{}).amount)||0;});
  return s;
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

/* ---------- tabs ---------- */
var TABS=[
  {id:"month",label:"Месяц"},
  {id:"journal",label:"Журнал занятий"},
  {id:"schedule",label:"Расписание по дням"},
  {id:"money",label:"Оплаты"},
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

/* ---------- tab: month ---------- */
function viewMonth(){
  var wrap=el('<div class="stack"></div>');
  var tot={plan:0,paidLessons:0,payout:0,revenue:0,margin:0,received:0,planRevenue:0,requested:0,paidOut:0};
  var rows=[];
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    var sub={plan:0,paidLessons:0,payout:0,revenue:0,margin:0,received:0,planRevenue:0};
    var inner=[];
    us.forEach(function(u){
      var s=unitStats(u),rec=receivedOf(u);
      ["plan","paidLessons","payout","revenue","margin","planRevenue"].forEach(function(k){sub[k]+=s[k];});
      sub.received+=rec;
      inner.push({u:u,s:s,rec:rec});
    });
    var pd=payoutDoc(t.id);
    tot.requested+=+pd.requested||0;tot.paidOut+=+pd.paid||0;
    ["plan","paidLessons","payout","revenue","margin","received","planRevenue"].forEach(function(k){tot[k]+=sub[k];});
    rows.push({t:t,sub:sub,inner:inner,pd:pd});
  });

  var kpis=el('<div class="kpis"></div>');
  function kpi(k,v,s,cls){return el('<div class="kpi'+(cls?" "+cls:"")+'"><div class="k">'+esc(k)+'</div><div class="v num">'+esc(v)+'</div><div class="s">'+esc(s||"")+"</div></div>");}
  kpis.appendChild(kpi("Выручка школы",fmtMoney(tot.revenue),"по плану "+fmtMoney(tot.planRevenue)));
  kpis.appendChild(kpi("К выплате педагогам",fmtMoney(tot.payout),"выплачено "+fmtMoney(tot.paidOut)));
  kpis.appendChild(kpi("Заработок школы",fmtMoney(tot.margin),tot.revenue?Math.round(tot.margin/tot.revenue*100)+"% от выручки":"","accent"));
  kpis.appendChild(kpi("Получено от родителей",fmtMoney(tot.received),"не поступило "+fmtMoney(Math.max(0,tot.revenue-tot.received))));
  kpis.appendChild(kpi("Занятий проведено",fmtNum(tot.paidLessons),"по плану "+fmtNum(tot.plan)));
  wrap.appendChild(kpis);

  var card=el('<div class="card"><div class="chead"><h2>По педагогам и ученикам</h2><span class="hint">Проведённые занятия включают поздние отмены с оплатой</span></div><div class="tscroll"></div></div>');
  var tbl=el('<table><thead><tr>'+
    '<th>Ученик или группа</th><th class="r">План</th><th class="r">Провед.</th>'+
    '<th class="r">Ставка</th><th class="r">К выплате</th><th class="r">Цена урока</th>'+
    '<th class="r">Выручка</th><th class="r">Заработок</th><th class="r">Получено</th><th>Статус выплаты</th>'+
    "</tr></thead><tbody></tbody></table>");
  var tb=tbl.querySelector("tbody");
  rows.forEach(function(r){
    var pd=r.pd,diff=(+pd.requested||0)-r.sub.payout;
    var statusPill;
    if(+pd.paid>=r.sub.payout&&r.sub.payout>0)statusPill='<span class="pill ok">выплачено '+esc(fmtDate(pd.paidDate))+"</span>";
    else if(+pd.paid>0)statusPill='<span class="pill warn">частично '+esc(fmtMoney(pd.paid))+"</span>";
    else statusPill='<span class="pill '+(r.sub.payout?"bad":"mute")+'">'+(r.sub.payout?"не выплачено":"нет начислений")+"</span>";
    var extra="";
    if(pd.requested&&Math.abs(diff)>=1)extra=' <span class="pill warn" title="Разница с расчётом по ставкам">запрос '+esc(fmtMoney(pd.requested))+" ("+(diff>0?"+":"")+esc(fmtMoney(diff))+")</span>";
    tb.appendChild(el('<tr class="grp"><td>'+esc(r.t.name)+'</td><td class="r">'+fmtNum(r.sub.plan)+'</td><td class="r">'+fmtNum(r.sub.paidLessons)+
      '</td><td></td><td class="r">'+esc(fmtMoney(r.sub.payout))+'</td><td></td><td class="r">'+esc(fmtMoney(r.sub.revenue))+
      '</td><td class="r">'+esc(fmtMoney(r.sub.margin))+'</td><td class="r">'+esc(fmtMoney(r.sub.received))+'</td><td class="nowrap">'+statusPill+extra+"</td></tr>"));
    r.inner.forEach(function(x){
      var u=x.u,s=x.s;
      var nm=esc(u.name)+(u.kind==="group"?' <span class="sub">'+members(u).length+" чел.</span>":(u.parent?' <span class="sub">'+esc(u.parent)+"</span>":""));
      var warn=(!(u.weekdays||[]).length)?' <span class="pill mute" title="Дни недели не заданы — план не рассчитывается">нет расписания</span>':"";
      var owe=s.revenue-x.rec;
      tb.appendChild(el('<tr><td style="padding-left:22px">'+nm+warn+'</td><td class="r">'+fmtNum(s.plan)+'</td><td class="r">'+fmtNum(s.paidLessons)+
        '</td><td class="r sub">'+esc(fmtMoney(s.rate))+'</td><td class="r">'+esc(fmtMoney(s.payout))+'</td><td class="r sub">'+esc(fmtMoney(s.perLesson))+
        '</td><td class="r">'+esc(fmtMoney(s.revenue))+'</td><td class="r">'+esc(fmtMoney(s.margin))+'</td><td class="r">'+esc(fmtMoney(x.rec))+
        '</td><td class="nowrap">'+(owe>0?'<span class="pill warn">ждём '+esc(fmtMoney(owe))+"</span>":(s.revenue?'<span class="pill ok">оплачено</span>':""))+"</td></tr>"));
    });
  });
  tb.appendChild(el('<tr class="tot"><td>Итого по школе</td><td class="r">'+fmtNum(tot.plan)+'</td><td class="r">'+fmtNum(tot.paidLessons)+
    '</td><td></td><td class="r">'+esc(fmtMoney(tot.payout))+'</td><td></td><td class="r">'+esc(fmtMoney(tot.revenue))+
    '</td><td class="r">'+esc(fmtMoney(tot.margin))+'</td><td class="r">'+esc(fmtMoney(tot.received))+"</td><td></td></tr>"));
  card.querySelector(".tscroll").appendChild(tbl);
  wrap.appendChild(card);
  return wrap;
}

/* ---------- tab: journal ---------- */
function viewJournal(){
  var ym=state.ym,n=daysIn(ym);
  var wrap=el('<div class="stack"></div>');
  var card=el('<div class="card"><div class="chead"><h2>Журнал занятий за '+esc(ymLabel(ym))+'</h2>'+
    '<span class="hint">Клик по клетке меняет её состояние</span></div></div>');
  var bar=el('<div style="padding:12px 14px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)"></div>');
  var legend=el('<div class="legend">'+
    '<span><i class="c-plan"></i>план</span>'+
    '<span><i class="c-done">✓</i>проведено</span>'+
    '<span><i class="c-pc">₽</i>отмена с оплатой</span>'+
    '<span><i class="c-c">×</i>отмена без оплаты</span>'+
    '<span><i class="c-off">–</i>снято с плана</span>'+
    "</div>");
  bar.appendChild(legend);
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
  for(var k in state.units){var u=state.units[k];if(u.active!==false&&!(u.weekdays||[]).length)noWd.push(u.name);}
  if(noWd.length){
    wrap.appendChild(el('<div class="card"><p class="warnbox" style="border-bottom:0;border-radius:var(--r)">Без дней недели, поэтому план не строится: '+esc(noWd.join(", "))+'. Задайте дни в справочнике «Ученики и группы».</p></div>'));
  }
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
  var count=0,jobs=[];
  for(var k in state.units){
    var u=state.units[k];if(u.active===false)continue;
    var md=mdoc(u),patch={},any=false;
    planDays(u,ym).forEach(function(d){
      if(d>lim)return;
      if(!(md.days||{})[String(d)]){patch[String(d)]="done";any=true;count++;}
    });
    if(any)jobs.push(saveMonth(u,{days:patch}));
  }
  if(!count){toast("Нечего подтверждать");return;}
  toast("Отмечено занятий: "+count);
}

/* ---------- tab: schedule ---------- */
function viewSchedule(){
  var ym=state.ym,n=daysIn(ym),today=new Date();
  var todayDay=(ymOf(today)===ym)?today.getDate():0;
  var wrap=el('<div class="card"><div class="chead"><h2>Расписание на '+esc(ymLabel(ym))+'</h2><span class="hint">Только дни, в которые есть занятия</span></div></div>');
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
    var card=el('<div class="day'+(d===todayDay?" today":"")+'"><div class="dh"><span>'+d+" "+MONTHS_IN[ymParts(ym).m-1]+
      "</span><em>"+DOW[w-1]+(d===todayDay?" · сегодня":"")+"</em></div></div>");
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

/* ---------- tab: money ---------- */
function viewMoney(){
  var wrap=el('<div class="stack"></div>');

  /* incoming */
  var cardIn=el('<div class="card"><div class="chead"><h2>Поступления от родителей</h2><span class="hint">Сумма за '+esc(ymLabel(state.ym))+'</span></div><div class="tscroll"></div></div>');
  var t1=el('<table><thead><tr><th>Ученик</th><th>Родитель</th><th>Педагог</th><th class="r">Начислено</th><th class="r">Оплачено</th><th>Дата</th><th></th><th class="r">Остаток</th></tr></thead><tbody></tbody></table>');
  var b1=t1.querySelector("tbody");
  var totDue=0,totGot=0;
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    us.forEach(function(u){
      var s=unitStats(u),md=mdoc(u),slots=paySlots(u);
      var lessons=s.paidLessons;
      slots.forEach(function(sl){
        var due=lessons*sl.price;
        var rec=md.pay&&md.pay[sl.key]?md.pay[sl.key]:{};
        var got=+rec.amount||0;
        totDue+=due;totGot+=got;
        var tr=el('<tr><td>'+esc(sl.name)+(u.kind==="group"?' <span class="sub">'+esc(u.name)+"</span>":"")+
          "</td><td>"+esc(sl.parent||"—")+'</td><td class="sub">'+esc(t.name)+'</td><td class="r">'+esc(fmtMoney(due))+"</td></tr>");
        var tdAmt=document.createElement("td");tdAmt.className="r";
        var inp=document.createElement("input");inp.className="amt";inp.type="number";inp.min="0";inp.step="100";
        inp.id="pay-"+u.id+"-"+sl.key;inp.value=got||"";
        inp.onchange=function(){
          var p={};p[sl.key]=Object.assign({},rec,{amount:+inp.value||0,date:rec.date||new Date().toISOString().slice(0,10)});
          saveMonth(u,{pay:p});
        };
        tdAmt.appendChild(inp);tr.appendChild(tdAmt);
        var tdDt=document.createElement("td");
        var dt=document.createElement("input");dt.type="date";dt.className="dt";dt.id="dt-"+u.id+"-"+sl.key;dt.value=rec.date||"";
        dt.onchange=function(){var p={};p[sl.key]=Object.assign({},rec,{date:dt.value});saveMonth(u,{pay:p});};
        tdDt.appendChild(dt);tr.appendChild(tdDt);
        var tdB=document.createElement("td");
        var bt=el('<button class="btn sm" type="button">Оплачено полностью</button>');
        bt.onclick=function(){
          var p={};p[sl.key]={amount:due,date:new Date().toISOString().slice(0,10),note:rec.note||""};
          saveMonth(u,{pay:p});
        };
        if(!due||got>=due)bt.disabled=true;
        tdB.appendChild(bt);tr.appendChild(tdB);
        var left=due-got;
        tr.appendChild(el('<td class="r">'+(left>0?'<span class="pill warn">'+esc(fmtMoney(left))+"</span>":
          (left<0?'<span class="pill ok">+'+esc(fmtMoney(-left))+"</span>":'<span class="pill ok">0 ₽</span>'))+"</td>"));
        b1.appendChild(tr);
      });
    });
  });
  b1.appendChild(el('<tr class="tot"><td colspan="3">Итого</td><td class="r">'+esc(fmtMoney(totDue))+'</td><td class="r">'+esc(fmtMoney(totGot))+
    '</td><td colspan="2"></td><td class="r">'+esc(fmtMoney(totDue-totGot))+"</td></tr>"));
  cardIn.querySelector(".tscroll").appendChild(t1);
  wrap.appendChild(cardIn);

  /* outgoing */
  var cardOut=el('<div class="card"><div class="chead"><h2>Выплаты педагогам</h2><span class="hint">Расчёт по ставкам сверяется с суммой, которую назвал педагог</span></div><div class="tscroll"></div></div>');
  var t2=el('<table><thead><tr><th>Педагог</th><th class="r">Занятий</th><th class="r">По ставкам</th><th class="r">Запросил</th><th class="r">Разница</th><th class="r">Выплачено</th><th>Дата</th><th></th><th>Реквизиты</th></tr></thead><tbody></tbody></table>');
  var b2=t2.querySelector("tbody");
  var sumRate=0,sumPaid=0;
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    var lessons=0,payout=0;
    us.forEach(function(u){var s=unitStats(u);lessons+=s.paidLessons;payout+=s.payout;});
    var pd=payoutDoc(t.id);
    var req=+pd.requested||0,paid=+pd.paid||0;
    sumRate+=payout;sumPaid+=paid;
    var tr=el('<tr><td>'+esc(t.name)+'</td><td class="r">'+fmtNum(lessons)+'</td><td class="r">'+esc(fmtMoney(payout))+"</td></tr>");
    var tdReq=document.createElement("td");tdReq.className="r";
    var ri=document.createElement("input");ri.className="amt";ri.type="number";ri.min="0";ri.step="100";ri.id="req-"+t.id;ri.value=req||"";
    ri.onchange=function(){savePayout(t.id,{requested:+ri.value||0});};
    tdReq.appendChild(ri);tr.appendChild(tdReq);
    var diff=req?req-payout:0;
    tr.appendChild(el('<td class="r">'+(req?(Math.abs(diff)<1?'<span class="pill ok">совпало</span>':'<span class="pill bad">'+(diff>0?"+":"")+esc(fmtMoney(diff))+"</span>"):'<span class="sub">—</span>')+"</td>"));
    var tdPaid=document.createElement("td");tdPaid.className="r";
    var pi=document.createElement("input");pi.className="amt";pi.type="number";pi.min="0";pi.step="100";pi.id="paid-"+t.id;pi.value=paid||"";
    pi.onchange=function(){savePayout(t.id,{paid:+pi.value||0,paidDate:pd.paidDate||new Date().toISOString().slice(0,10)});};
    tdPaid.appendChild(pi);tr.appendChild(tdPaid);
    var tdDt=document.createElement("td");
    var dt=document.createElement("input");dt.type="date";dt.className="dt";dt.id="pdt-"+t.id;dt.value=pd.paidDate||"";
    dt.onchange=function(){savePayout(t.id,{paidDate:dt.value});};
    tdDt.appendChild(dt);tr.appendChild(tdDt);
    var tdB=document.createElement("td");
    var bt=el('<button class="btn sm" type="button">Выплатила</button>');
    bt.onclick=function(){savePayout(t.id,{paid:req||payout,paidDate:new Date().toISOString().slice(0,10)});};
    if(!payout&&!req)bt.disabled=true;
    tdB.appendChild(bt);tr.appendChild(tdB);
    var req_bits=[t.bank,t.recipient,t.phone,t.card,t.account].filter(Boolean).join(" · ");
    tr.appendChild(el('<td class="sub" style="max-width:260px">'+esc(req_bits||"не заданы")+
      (t.purpose?'<br><span class="pill warn">'+esc(t.purpose)+"</span>":"")+"</td>"));
    b2.appendChild(tr);
    if(pd.note||t.note){
      b2.appendChild(el('<tr><td colspan="9" class="sub" style="padding-left:22px">'+esc([t.note,pd.note].filter(Boolean).join(" · "))+"</td></tr>"));
    }
  });
  b2.appendChild(el('<tr class="tot"><td colspan="2">Итого</td><td class="r">'+esc(fmtMoney(sumRate))+'</td><td colspan="2"></td><td class="r">'+
    esc(fmtMoney(sumPaid))+'</td><td colspan="3"></td></tr>'));
  cardOut.querySelector(".tscroll").appendChild(t2);
  wrap.appendChild(cardOut);
  return wrap;
}

/* ---------- tab: reference ---------- */
function viewRef(){
  var wrap=el('<div class="stack"></div>');

  /* units */
  var cu=el('<div class="card"><div class="chead"><h2>Ученики и группы</h2><span class="hint">Дни недели задают план на любой месяц</span></div></div>');
  var holder=el('<div class="ref"></div>');
  teacherList().forEach(function(t){
    var us=unitsOf(t.id);if(!us.length)return;
    holder.appendChild(el('<h3 style="margin:6px 0 0;font-size:13px;color:var(--ink-2)">'+esc(t.name)+"</h3>"));
    us.forEach(function(u){holder.appendChild(unitRow(u,t));});
  });
  var addRow=el('<div class="btnrow" style="padding-top:4px"></div>');
  var aSolo=el('<button class="btn" type="button">Добавить ученика</button>');
  aSolo.onclick=function(){addUnit("solo");};
  var aGrp=el('<button class="btn" type="button">Добавить группу</button>');
  aGrp.onclick=function(){addUnit("group");};
  addRow.appendChild(aSolo);addRow.appendChild(aGrp);
  holder.appendChild(addRow);
  cu.appendChild(holder);
  wrap.appendChild(cu);

  /* teachers */
  var ct=el('<div class="card"><div class="chead"><h2>Педагоги, ставки и реквизиты</h2></div></div>');
  var th=el('<div class="ref"></div>');
  teacherList().forEach(function(t){th.appendChild(teacherRow(t));});
  ct.appendChild(th);
  wrap.appendChild(ct);

  /* base rates */
  var b=baseRates();
  var cb=el('<div class="card"><div class="chead"><h2>Базовые ставки педагогов</h2><span class="hint">Применяются, если у ученика не задана своя ставка</span></div></div>');
  var fr=el('<div class="ref"><div class="fields"></div></div>');
  var fields=fr.querySelector(".fields");
  [["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]].forEach(function(p){
    var lab=el('<label class="f">'+esc(p[1])+", ₽</label>");
    var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="50";inp.id="br-"+p[0];inp.value=b[p[0]]||0;
    inp.onchange=function(){
      if(!needWrite())return;
      var nb=Object.assign({},baseRates());nb[p[0]]=+inp.value||0;
      var next=Object.assign({},state.settings,{baseRates:nb});
      state.settings=next;render();
      API.saveSettings(next).catch(function(e){toast("Не удалось сохранить: "+(e&&e.code||"ошибка"));});
    };
    lab.appendChild(inp);fields.appendChild(lab);
  });
  cb.appendChild(fr);
  wrap.appendChild(cb);
  return wrap;
}
function wdPicker(u){
  var box=el('<div class="wd"></div>');
  DOW.forEach(function(name,i){
    var d=i+1;
    var b=el('<button type="button">'+name+"</button>");
    var on=(u.weekdays||[]).indexOf(d)>=0;
    b.setAttribute("aria-pressed",on?"true":"false");
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
function unitRow(u,t){
  var row=el('<div class="refrow"></div>');
  var top=el('<div class="top"><b>'+esc(u.name||"Без имени")+'</b><span class="pill mute">'+(u.kind==="group"?"группа":"индивидуально")+"</span></div>");
  var del=el('<button class="btn sm" type="button" style="margin-left:auto">В архив</button>');
  del.onclick=function(){saveUnit(u.id,{active:false});toast("Перенесено в архив");};
  top.appendChild(del);
  row.appendChild(top);
  var f=el('<div class="fields"></div>');
  f.appendChild(field("Имя","u-name-"+u.id,u.name,"text",function(v){saveUnit(u.id,{name:v});}));
  if(u.kind==="solo"){
    f.appendChild(field("Родитель","u-par-"+u.id,u.parent,"text",function(v){saveUnit(u.id,{parent:v});}));
    f.appendChild(field("Цена урока, ₽","u-price-"+u.id,u.price,"number",function(v){saveUnit(u.id,{price:v});}));
  }
  f.appendChild(field("Педагог","u-t-"+u.id,u.teacherId,null,function(v){saveUnit(u.id,{teacherId:v});},
    teacherList().map(function(x){return[x.id,x.name];})));
  f.appendChild(field("Формат","u-f-"+u.id,u.format,null,function(v){saveUnit(u.id,{format:v});},
    [["individual","Индивидуально"],["mini","Мини-группа"],["group","Группа"]]));
  f.appendChild(field("Ставка педагога за занятие, ₽","u-rate-"+u.id,u.rate,"number",function(v){saveUnit(u.id,{rate:v});}));
  f.appendChild(field("Заметка","u-note-"+u.id,u.note,"text",function(v){saveUnit(u.id,{note:v});}));
  row.appendChild(f);
  var wdlab=el('<label class="f">Дни недели</label>');
  wdlab.appendChild(wdPicker(u));
  row.appendChild(wdlab);
  if(u.kind==="group"){
    var ml=el('<label class="f">Состав группы и цена за урок с каждого</label>');
    var mems=el('<div class="mems"></div>');
    (u.members||[]).forEach(function(m,idx){
      var mr=el('<div class="mem"></div>');
      var n1=document.createElement("input");n1.id="m-n-"+u.id+"-"+m.id;n1.value=m.name||"";n1.placeholder="Ученик";
      n1.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{name:n1.value});saveUnit(u.id,{members:ms});};
      var n2=document.createElement("input");n2.id="m-p-"+u.id+"-"+m.id;n2.value=m.parent||"";n2.placeholder="Родитель";
      n2.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{parent:n2.value});saveUnit(u.id,{members:ms});};
      var n3=document.createElement("input");n3.id="m-pr-"+u.id+"-"+m.id;n3.type="number";n3.min="0";n3.step="50";n3.className="amt";n3.value=m.price||0;
      n3.onchange=function(){var ms=(u.members||[]).slice();ms[idx]=Object.assign({},m,{price:+n3.value||0});saveUnit(u.id,{members:ms});};
      var rm=el('<button class="btn sm" type="button">Убрать</button>');
      rm.onclick=function(){var ms=(u.members||[]).slice();ms.splice(idx,1);saveUnit(u.id,{members:ms});};
      mr.appendChild(n1);mr.appendChild(n2);mr.appendChild(n3);mr.appendChild(rm);
      mems.appendChild(mr);
      if(m.note)mems.appendChild(el('<div class="sub" style="margin-top:-2px">'+esc(m.note)+"</div>"));
    });
    var am=el('<button class="btn sm" type="button" style="justify-self:start">Добавить ученика в группу</button>');
    am.onclick=function(){
      var ms=(u.members||[]).slice();
      ms.push({id:newId("m"),name:"Новый ученик",parent:"",price:2000,channel:"",note:""});
      saveUnit(u.id,{members:ms});
    };
    mems.appendChild(am);
    ml.appendChild(mems);
    row.appendChild(ml);
  }
  return row;
}
function teacherRow(t){
  var row=el('<div class="refrow"></div>');
  row.appendChild(el('<div class="top"><b>'+esc(t.name)+"</b></div>"));
  var f=el('<div class="fields"></div>');
  f.appendChild(field("ФИО","t-name-"+t.id,t.name,"text",function(v){saveTeacher(t.id,{name:v});}));
  f.appendChild(field("Банк","t-bank-"+t.id,t.bank,"text",function(v){saveTeacher(t.id,{bank:v});}));
  f.appendChild(field("Получатель","t-rec-"+t.id,t.recipient,"text",function(v){saveTeacher(t.id,{recipient:v});}));
  f.appendChild(field("Телефон","t-ph-"+t.id,t.phone,"text",function(v){saveTeacher(t.id,{phone:v});}));
  f.appendChild(field("Карта","t-card-"+t.id,t.card,"text",function(v){saveTeacher(t.id,{card:v});}));
  f.appendChild(field("Счёт","t-acc-"+t.id,t.account,"text",function(v){saveTeacher(t.id,{account:v});}));
  f.appendChild(field("БИК","t-bik-"+t.id,t.bik,"text",function(v){saveTeacher(t.id,{bik:v});}));
  f.appendChild(field("Назначение платежа","t-pur-"+t.id,t.purpose,"text",function(v){saveTeacher(t.id,{purpose:v});}));
  f.appendChild(field("Ставка индивидуально, ₽","t-ri-"+t.id,(t.rates||{}).individual,"number",function(v){
    var r=Object.assign({},t.rates||{});if(v)r.individual=v;else delete r.individual;saveTeacher(t.id,{rates:r});}));
  f.appendChild(field("Заметка","t-note-"+t.id,t.note,"text",function(v){saveTeacher(t.id,{note:v});}));
  row.appendChild(f);
  return row;
}
function addUnit(kind){
  if(!needWrite())return;
  var id=newId(kind==="group"?"g":"u");
  var tl=teacherList();
  var body={kind:kind,name:kind==="group"?"Новая группа":"Новый ученик",parent:"",
    teacherId:tl.length?tl[0].id:"",format:kind==="group"?"group":"individual",
    price:kind==="group"?0:2500,rate:kind==="group"?1000:1000,weekdays:[],note:"",active:true,
    order:900+Object.keys(state.units).length,channel:"",members:[]};
  state.units[id]=Object.assign({id:id},body);render();
  API.saveUnit(id,body).catch(function(e){toast("Не удалось сохранить: "+(e&&e.code||"ошибка"));});
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
  if(state.err){
    main.appendChild(el('<div class="boot"><b>Данные недоступны</b>'+esc(state.err)+"</div>"));
    return;
  }
  if(!state.ready){
    main.appendChild(el('<div class="boot"><b>Загружаю данные</b>Если это первый запуск, подождите пару секунд.</div>'));
    return;
  }
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
    weekdays:(r.weekdays||[]).map(Number),members:r.members||[],channel:r.channel||"",
    note:r.note||"",active:r.active!==false,order:r.order_no};
}
function unitToRow(u){
  return{id:u.id,kind:u.kind||"solo",name:u.name||"",parent:u.parent||"",teacher_id:u.teacherId||"",
    format:u.format||"individual",price:num(u.price),rate:u.rate==null?null:num(u.rate),
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
        settings:s?{baseRates:s.base_rates||{},tariffs:s.tariffs||[]}:{}};
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
      tariffs:s.tariffs||[]},{onConflict:"owner"}).then(oops);
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
