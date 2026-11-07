'use strict';
const $ = id => document.getElementById(id);
const pages = ['经营总览','交易漏斗','用户经营与商品分析','策略实验与效果验证','经营异常诊断','推荐增长案例复盘','经营行动记录'];
const options = ['gmv','conversion','refundRate'];
const metricNames = {gmv:'GMV', conversion:'商城整体成单率', refundRate:'支付订单退款率'};
const abcNames = {A:'A · 核心贡献',B:'B · 次级贡献',C:'C · 长尾贡献'};
const spans = [7,30,60,90];
const blue = '#315d8a', teal = '#087767';
const state = {tab:-1,season:'warm',metric:'gmv',point:0,signal:null};
let meta, data, userOrders, firstOrder;
const number = new Intl.NumberFormat('zh-CN');
const currency = new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'});
const fmt = n => number.format(n);
const money = cents => currency.format(cents/100);
const ratio = (a,b) => b ? a/b : null;
const pct = n => n == null ? '—' : (100*n).toFixed(2)+'%';
const pp = n => n == null ? '—' : (n>0?'+':'')+(100*n).toFixed(2)+' 个百分点';
const sum = (rows, fn) => rows.reduce((total,row)=>total+fn(row),0);
const day = value => Date.parse(value)/86400000;
const card = (label,value,detail='') => {
  const help=metricDefinitions.has(label)?`<button type="button" class="bi-help" data-bi-metric="${label}" aria-label="查看${label}口径" aria-expanded="false">ⓘ</button>`:'';
  const unit=['支付订单','退款成功订单'].includes(label)?'单':['支付买家','支付买家数','窗口内多次支付买家'].includes(label)?'人':'';
  return `<div class="card"><div class="k">${label}${help}</div><div class="v">${biKpi(value,unit)}</div>${detail?`<p class="growth-note">${detail}</p>`:''}</div>`;
};
let closeMetricHelp=()=>{};
const panel = (title,content) => `<section class="panel"><h2>${title}</h2>${content}</section>`;
function table(columns,rows) {
  return `<div class="growth-tables"><table class="tbl"><thead><tr>${columns.map(x=>`<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function stats(orders, unpaid) {
  const visits = orders.length + sum(unpaid,b=>b[4]);
  const paid = orders.length;
  const refunds = sum(orders,o=>Number(o[7]>0));
  const shipped = sum(orders,o=>Number(Boolean(o[8])));
  const returns = sum(orders,o=>Number(o[7]===3));
  const gmv = sum(orders,o=>o[6]);
  return {visits,paid,refunds,shipped,returns,gmv,
    buyers:new Set(orders.map(o=>o[0])).size,
    exposures:paid*4+sum(unpaid,b=>b[5]),
    clicks:paid+sum(unpaid,b=>b[3]>=1?b[4]:0),
    carts:paid+sum(unpaid,b=>b[3]>=2?b[4]:0),
    placed:paid+sum(unpaid,b=>b[3]>=3?b[4]:0),
    conversion:ratio(paid,visits), refundRate:ratio(refunds,paid),
    returnRate:ratio(returns,shipped),aov:ratio(gmv,paid)};
}
function dimensions() {
  return [$('scene').value,$('car').value,$('cat').value].map(x=>x===''?null:Number(x));
}
function matches(row,offset, dims) {
  return dims.every((value,i)=>value===null || row[offset+i]===value);
}
function select(months,dims=dimensions()) {
  const rows=months.map(m=>data.get(m));
  const orders=rows.flatMap(m=>m.orders.filter(o=>matches(o,2,dims)));
  const unpaid=rows.flatMap(m=>m.unpaid.filter(b=>matches(b,0,dims)));
  return {orders,unpaid,...stats(orders,unpaid)};
}
function currentMonths() {
  return [...data.keys()].filter(m=>m >= $('start').value && m <= $('end').value);
}
function seasonPair(includeFull=false) {
  const [coldEarly,warmEarly,coldLate,warmLate]=meta.seasons;
  if(includeFull && state.season==='full') {
    return [[coldEarly,warmEarly],[coldLate,warmLate]].map(([cold,warm])=>({
      months:[...cold.months,...warm.months]
    }));
  }
  return state.season==='cold'?[coldEarly,coldLate]:[warmEarly,warmLate];
}
function cohort(season,dims=[null,null,null]) {
  const anchors=Object.entries(meta.cohorts[season.start]).filter(([u])=>matches(firstOrder.get(u),2,dims));
  return {n:anchors.length,counts:spans.map(n=>anchors.filter(([u,d])=>userOrders.get(u).some(o=>{
    const gap=day(o[1])-day(d);
    return gap>=1 && gap<=n;
  })).length)};
}
function plot(labels,series,format,interactive=false,shading=false) {
  const narrow=matchMedia('(max-width:640px)').matches;
  const width=narrow?390:760, height=narrow?225:270, left=narrow?69:78, right=narrow?20:25, top=22, bottom=42;
  const max=Math.max(1e-8,...series.flatMap(s=>s.values).filter(Number.isFinite))*1.12;
  const step=(width-left-right)/Math.max(1,labels.length-1);
  const x=i=>left+step*i;
  const y=v=>height-bottom-(height-bottom-top)*v/max;
  const grids=Array.from({length:5},(_,i)=>{
    const v=max*i/4;
    return `<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#dce5ee"/><text x="${left-7}" y="${y(v)+4}" text-anchor="end">${format(v)}</text>`;
  }).join('');
  const events=shading?labels.map((label,i)=>{
    const name={'06':'618','10':'预热','11':'双11','12':'双12'}[label.slice(-2)];
    if(!name || (narrow && name!=='618' && name!=='双11')) return '';
    return `<line x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${height-bottom}" stroke="#8196af" stroke-dasharray="3 4"/><text x="${x(i)}" y="${top-6}" text-anchor="middle">${name}</text>`;
  }).join(''):'';
  const backgrounds=shading?[[0,5],[12,17]].map(([a,b])=>`<rect x="${a===0?left:x(a)-step/2}" y="${top}" width="${x(b)+step/2-(a===0?left:x(a)-step/2)}" height="${height-top-bottom}" fill="#e8eff8"/>`).join(''):'';
  const lines=series.map(s=>{
    const path=s.values.map((v,i)=>v==null?'':`${i===0||s.values[i-1]==null?'M':'L'}${x(i)},${y(v)}`).join(' ');
    const points=s.values.map((v,i)=>v==null?'':`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}"><title>${s.name} ${labels[i]} ${format(v)}</title></circle>`).join('');
    return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="3"/>${points}`;
  }).join('');
  const ticks=labels.map((label,i)=>(labels.length>12&&i%3!==0&&i!==labels.length-1||narrow&&labels.length===12&&i%2===0&&i!==0)?'':`<text x="${x(i)}" y="${height-17}" text-anchor="middle">${label}</text>`).join('');
  const buttons=interactive?`<div class="growth-switch" aria-label="选择图表观察点">${labels.map((label,i)=>`<button class="btn" data-point="${i}" aria-pressed="${state.point===i}">${label}</button>`).join('')}</div>`:'';
  const hits=interactive?labels.map((label,i)=>`<rect class="growth-point" data-point="${i}" x="${Math.max(left-step/2,x(i)-step/2)}" y="${top}" width="${step}" height="${height-top-bottom}" fill="transparent"><title>${label}</title></rect>`).join(''):'';
  return `<div class="growth-legend">${series.map(s=>`<span style="color:${s.color}">● ${s.name}</span>`).join('')}</div><svg class="growth-plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="月度或队列趋势图">${backgrounds}${grids}${events}${lines}${ticks}${hits}</svg>${buttons}`;
}
function switches(includeFull=false) {
  const periods=[['warm','旺季'],['cold','淡季']];
  if(includeFull) periods.push(['full','完整经营年']);
  const selected=!includeFull&&state.season==='full'?'warm':state.season;
  return `<div class="growth-switch" aria-label="同比周期">${periods.map(([key,label])=>`<button class="btn" data-season="${key}" aria-pressed="${selected===key}">${label}</button>`).join('')}</div>`;
}
const campaignNotes={
  6:'618 活动月',
  7:'618 后回落',
  10:'双 11 预热与部分活动成交',
  11:'双 11 活动月',
  12:'双 12 活动月'
};
function seasonChart() {
  const full=state.season==='full';
  const pair=seasonPair(true);
  const series=pair.map((s,i)=>({name:s.months[0]+' 至 '+s.months.at(-1),color:i?teal:blue,values:s.months.map(m=>select([m])[state.metric])}));
  const labels=pair[0].months.map(m=>Number(m.slice(5))+' 月');
  const formatter=state.metric==='gmv'?v=>(v/1e6).toFixed(1)+' 万':pct;
  const i=Math.min(state.point,labels.length-1);
  const [a,b]=pair.map(s=>select([s.months[i]]));
  const delta=state.metric==='gmv'?ratio(b.gmv-a.gmv,a.gmv):a[state.metric]==null||b[state.metric]==null?null:b[state.metric]-a[state.metric];
  const diff=state.metric==='gmv'?`差额 ${money(b.gmv-a.gmv)} · 同比 ${biDelta(delta,pct(delta))}`:`同比 ${biDelta(delta,pp(delta))}`;
  const detail=state.metric==='gmv'?x=>`支付订单 ${fmt(x.paid)} · 客单价 ${x.aov==null?'—':money(x.aov)}`:state.metric==='conversion'?x=>`${fmt(x.paid)} / ${fmt(x.visits)} 次访问`:x=>`${fmt(x.refunds)} / ${fmt(x.paid)} 笔支付订单`;
  const event=campaignNotes[Number(pair[0].months[i].slice(5))];
  const scope=full?'完整经营年按 10 月至次年 9 月对齐，包含淡季和旺季。':'比较两个完整同季周期。';
  return panel((full?'经营年同比 · ':'同一季节，前后两年对比 · ')+metricNames[state.metric],switches(true)+`<div class="growth-switch">${options.map(key=>`<button class="btn" data-metric="${key}" aria-pressed="${state.metric===key}">${metricNames[key]}</button>`).join('')}</div>`+
    plot(labels,series,formatter,true)+`<div class="growth-caption" role="status">${pair[0].months[i]} ${formatter(a[state.metric])}（${detail(a)}）<br>${pair[1].months[i]} ${formatter(b[state.metric])}（${detail(b)}）<br>${diff}${event?`<br>模拟活动节点 · ${event}`:''}</div><p class="growth-note">${scope}响应入口、车型和品类筛选。</p>`);
}
function home() {
  const pair=[meta.seasons[1],meta.seasons[3]];
  const [c,d]=pair.map(s=>cohort(s));
  const [coldA,warmA,coldB,warmB]=meta.seasons.map(season=>season.months);
  const periods=[
    ['完整经营年',[...coldA,...warmA],[...coldB,...warmB]],
    ['旺季',warmA,warmB],['淡季',coldA,coldB]
  ];
  const summary=periods.map(([name,...months])=>{
    const [a,b]=months.map(m=>select(m,[null,null,null]));
    const avg=(x,m)=>(x.gmv/m.length/1e6).toFixed(2)+' 万';
    return [name,avg(a,months[0])+' → '+avg(b,months[1]),pct(a.conversion)+' → '+pct(b.conversion),
      pct(a.refundRate)+' → '+pct(b.refundRate),name==='旺季'?pct(ratio(c.counts[3],c.n))+' → '+pct(ratio(d.counts[3],d.n)):'—'];
  });
  const questions=[
    'GMV、订单和售后怎么变？先看规模、趋势及增长来源。',
    '流量在哪里流失？比较曝光到支付的各环节和入口表现。',
    '谁在复购，什么在卖？对比复购队列、车型和品类。',
    '新推荐排序值得验证吗？检查转化结果和退款护栏。',
    '退款变多是订单放量还是售后变差？按品类和退款类型核查。',
    '一次推荐增长分析如何展开？从漏斗定位走到实验与复查。',
    '下一步做什么、如何验收？将诊断证据整理为行动记录。'
  ];
  return `<section class="portfolio-hero"><div class="portfolio-eyebrow">MALL / INSIGHTS · 数据分析作品集</div>
    <h2>商城经营分析与增长决策工作台</h2>
    <p class="portfolio-capabilities">面向摩托装备商城运营与数据分析，回答增长来自哪里、交易在哪一步流失、策略效果如何验证。</p>
    <p class="portfolio-role">项目经历 2022.03–2024.12 · 交互演示使用 2022.10–2024.09 模拟数据</p>
    <div class="hero-actions"><button class="btn hero-primary" data-tab="0">进入经营总览</button><button class="btn" data-tab="5" data-case-year>查看推荐增长案例</button></div>
  </section>
  ${panel('历史项目成果',`<div class="result-lead"><span>旺季月均成交额</span><strong>94.7 万元 → 232.4 万元</strong><span>约 +145%</span></div>
    <p class="growth-note">前期经营年 2022.10–2023.09 · 后期经营年 2023.10–2024.09。每年 4–9 月为旺季，其余为淡季。</p>`+
    table(['周期','月均成交额','成单率','支付订单退款率','首购后 90 日复购率'],summary)+
    '<p class="growth-note">表内为模拟复盘口径。复购率仅展示已满 90 日观察窗的旺季首购买家。 <button class="linkbtn" data-tab="2">查看复购分段 →</button></p>'+
    '<p class="result-secondary"><strong>完整经营年 · 推荐贡献</strong><br>推荐场景 GMV 占比均值 18% → 35% · 推荐流成单率 0.8% → 1.9% <button class="linkbtn" data-tab="5" data-case-year>查看触点对比 →</button></p>')}
  ${panel('从看经营到做决策',`<div class="portfolio-stages">${[['看经营',0,3],['验证与诊断',3,5],['复盘与行动',5,7]].map(([label,start,end])=>`<section><h3>${label}</h3><ul>${pages.slice(start,end).map((name,index)=>{
    const i=start+index;
    return `<li><button class="module-card" data-tab="${i}"><strong>${String(i+1).padStart(2,'0')} · ${name} <span aria-hidden="true">→</span></strong><span>${questions[i]}</span></button></li>`;
  }).join('')}</ul></section>`).join('')}</div>`)}
  ${methodHub(['rfm','kmeans','abc','attr','ab'],'以下为独立方法样本。')}`;
}
function overview(s) {
  const months=[...data.keys()];
  const monthly=months.map(m=>select([m]));
  const inRange=currentMonths();
  const last=inRange.at(-1);
  const endIndex=months.indexOf(last);
  const previous=months[endIndex-1];
  const current=monthly[endIndex];
  const prior=monthly[endIndex-1];
  const trend=plot(months.map(m=>m.slice(2)),[{name:'模拟月度 GMV',color:blue,values:monthly.map(m=>m.gmv)}],v=>(v/1e6).toFixed(1)+' 万',false,true);
  const delta=prior&&ratio(current.gmv-prior.gmv,prior.gmv);
  const refundChange=prior?.refundRate!=null&&current.refundRate!=null?current.refundRate-prior.refundRate:null;
  const entrySales=Array(meta.scenes.length).fill(0);
  for(const order of s.orders) entrySales[order[2]]+=order[6];
  const entry=entrySales.indexOf(Math.max(...entrySales));
  const lead=panel('这个月发生了什么？',`<p><strong>${last}</strong> GMV ${money(current.gmv)}${prior?`，较 ${previous} ${biDelta(delta,pct(delta))}`:'，暂无上月样本'}。
    支付订单退款率 ${pct(current.refundRate)}${refundChange==null?'':`，较上月 ${biDelta(refundChange,pp(refundChange))}`}。</p>
    <p>${s.gmv?`当前筛选内 GMV 最高入口为 <strong>${meta.scenes[entry]}</strong>，占 ${pct(ratio(entrySales[entry],s.gmv))}。`:'当前筛选无成交。'}</p>
    <div class="growth-switch"><button class="btn" data-tab="1">查入口与漏斗</button><button class="btn" data-tab="2">查复购、车型与品类</button><button class="btn" data-tab="4">查退款变化</button></div>`);
  return panel('这段时间经营得怎么样',`<p class="growth-note">${inRange[0]} 至 ${last}。下方趋势图使用完整同比周期和 24 个月窗口，并响应入口、车型和品类筛选。</p>
    <div class="cards snapshot-grid">${card('模拟 GMV',money(s.gmv))}${card('商城访问',fmt(s.visits))}${card('支付订单',fmt(s.paid))}${card('支付买家',fmt(s.buyers))}${card('商城整体成单率',pct(s.conversion))}${card('客单价',s.aov==null?'—':money(s.aov))}${card('支付订单退款率',pct(s.refundRate))}${card('退款成功订单',fmt(s.refunds))}</div>`)+
    lead+seasonChart()+panel('24 个月经营全景',trend+'<p class="growth-note">淡蓝底为淡季。此图固定展示完整区间。</p>')+
    panel((state.season==='full'?'经营年':'同季')+' 成交额变化来自哪里？',attribution(seasonPair(true)));
}
function funnel(s) {
  const directPaid=sum(s.orders,o=>o[12]||0);
  const directPlaced=directPaid+sum(s.unpaid,b=>b[6]||0);
  const stages=[
    ['商品曝光',s.visits,null],['进入商品详情页',s.clicks,s.visits],
    ['选择购买方式',null,null],['提交订单',s.placed,s.carts],['完成支付',s.paid,s.placed]
  ];
  const graphic=`<ol class="funnel-steps pyramid">${stages.map(([label,n,base])=>n==null?
    `<li class="purchase-branches"><div><strong>加入购物车</strong><span>${fmt(s.carts-directPlaced)} 次访问</span></div><div><strong>立即购买</strong><span>${fmt(directPlaced)} 次提交订单</span></div></li>`:
    `<li><div class="funnel-shape" aria-hidden="true" style="--stage-width:${100*(ratio(n,s.visits)||0)}%"></div><div class="funnel-label"><strong>${label}</strong><span>${fmt(n)} 次访问${base?` · ${pct(ratio(n,base))} 进入这一步`:''}</span></div></li>`).join('')}</ol>`;
  return `<div class="cards">${card('商品曝光点击率',pct(ratio(s.clicks,s.exposures)))}${card('访问点击率',pct(ratio(s.clicks,s.visits)))}${card('下单支付率',pct(ratio(s.paid,s.placed)))}</div>`+
    panel('从商品曝光到完成支付',graphic+
    table(['路径','提交订单','完成支付','下单后支付率'],[['加入购物车',s.placed-directPlaced,s.paid-directPaid],['立即购买',directPlaced,directPaid]].map(([label,p,q])=>[label,fmt(p),fmt(q),pct(ratio(q,p))]))+
    '<p class="growth-note">按同一次访问统计，倒三角宽度以商品曝光访问为基准。模拟样本在订单环节记录「立即购买」，因此该分支从提交订单开始可计数。两条路径互斥，合计回到总订单与总支付数。</p>')+
    panel('入口表现',table(['访问入口','访问','支付','成单率','GMV'],meta.scenes.map((name,i)=>{
      const dims=dimensions();
      if(dims[0]!=null&&dims[0]!==i)return null;
      const m=select(currentMonths(),[i,dims[1],dims[2]]);
      return [name,fmt(m.visits),fmt(m.paid),pct(m.conversion),money(m.gmv)];
    }).filter(Boolean)));
}
function repurchase() {
  const pair=seasonPair();
  const cohorts=pair.map(s=>cohort(s,dimensions()));
  const series=cohorts.map((c,i)=>({name:pair[i].months[0]+' 至 '+pair[i].months[2]+' 首购买家',color:i?teal:blue,values:c.counts.map(n=>ratio(n,c.n))}));
  const i=Math.min(state.point,3);
  const [a,b]=series.map(s=>s.values[i]);
  const rows=spans.map((n,j)=>[n+' 日',...cohorts.map(c=>`${pct(ratio(c.counts[j],c.n))}（${fmt(c.counts[j])} / ${fmt(c.n)}）`)]);
  const windows=['1–7 日','8–30 日','31–60 日','61–90 日'];
  const additions=windows.map((_,j)=>cohorts.map(c=>ratio(c.counts[j]-(c.counts[j-1]||0),c.n)));
  const max=Math.max(0.01,...additions.flat().filter(Number.isFinite));
  const bars=`<h3>买家在什么时候回来？</h3><p class="growth-note">各区间首次复购人数占首购买家比例 · 上方蓝条为前期，下方绿条为后期。</p>
    <div class="repurchase-bars">${windows.map((label,j)=>`<div><strong>${label}</strong>${additions[j].map((v,k)=>`<div class="bar-row"><span>${k?'后期':'前期'} ${pct(v)}</span><div class="metric-track" aria-hidden="true"><i style="width:${100*(v||0)/max}%;background:${series[k].color}"></i></div></div>`).join('')}</div>`).join('')}</div>`;
  return panel('首购之后，有多少买家再次下单？',switches()+plot(spans.map(n=>n+' 日'),series,pct,true)+
    `<div class="growth-caption" role="status">${spans[i]} 日 · ${rows[i][1]} → ${rows[i][2]} · ${biDelta(a==null||b==null?null:b-a,pp(a==null||b==null?null:b-a))}</div>`+
    bars+table(['首购后','前期累计','后期累计','前期区间首次复购','后期区间首次复购'],rows.map((row,j)=>[
      ...row,...cohorts.map(c=>pct(ratio(c.counts[j]-(c.counts[j-1]||0),c.n)))
    ]))+
    '<p class="growth-note">淡季取 10–12 月，旺季取 4–6 月。四档均使用满 90 天的同一批用户。区间新增分别为 1–7、8–30、31–60、61–90 日内首次复购人数除以首购人数。入口、车型和品类只用于筛选首次购买，复购在全商城跟踪。</p>');
}
const repurchaseWatch = { minBuyers: 100, absoluteDropPercent: 2, relativeDropPercent: 20 };

function monthEnd(month) {
  const [year, number] = month.split('-').map(Number);
  return Date.UTC(year,number,0)/86400000;
}
function repurchaseAlert(current, baseline, matured) {
  if (!matured) return '整月未满 30 日';
  if (!baseline) return '暂无上年同月';
  if (Math.min(current.n,baseline.n)<repurchaseWatch.minBuyers) return '样本不足';
  const dropNumerator=baseline.rep*current.n-current.rep*baseline.n;
  return 100*dropNumerator>=repurchaseWatch.absoluteDropPercent*baseline.n*current.n
    && 100*dropNumerator>=repurchaseWatch.relativeDropPercent*baseline.rep*current.n
    ? '预警 · 建议下钻' : '未触发预警';
}
function rolling() {
  const dims=dimensions();
  const months=currentMonths();
  const asOf=monthEnd($('end').value);
  const byMonth=new Map([...data.keys()].map(m=>[m,{n:0,rep:0}]));
  for (const [u,o] of firstOrder) {
    const x=byMonth.get(o[1].slice(0,7));
    if (!x || asOf-day(o[1])<30 || !matches(o,2,dims)) continue;
    x.n++;
    if(userOrders.get(u).some(r=>{
      const gap=day(r[1])-day(o[1]);
      return gap>=1 && gap<=30;
    })) x.rep++;
  }
  const entries=months.map(month=>{
    const current=byMonth.get(month);
    const priorMonth=(Number(month.slice(0,4))-1)+month.slice(4);
    const baseline=byMonth.get(priorMonth);
    const mature=asOf-monthEnd(month)>=30;
    const status=repurchaseAlert(current,baseline,mature);
    const rate=ratio(current.rep,current.n);
    const priorRate=baseline?ratio(baseline.rep,baseline.n):null;
    return [month,fmt(current.n),fmt(current.rep),pct(rate),
      baseline?`${pct(priorRate)}（${fmt(baseline.rep)} / ${fmt(baseline.n)}）`:'—',
      mature&&rate!=null&&priorRate!=null?biDelta(rate-priorRate,pp(rate-priorRate)):'—',
      status.startsWith('预警')?`<strong class="warn">${status}</strong>`:status];
  });
  return panel('每月首购买家的 30 日复购',
    table(['首购月','已满 30 日','复购买家','30 日复购率','上年同月（复购 / 队列）','同比差','复购提示'],entries)+
    `<p class="growth-note">观察截止 ${new Date(asOf*86400000).toISOString().slice(0,10)}。以同一筛选口径对比上年同月，基线可取自当前日期筛选范围之外。整月成熟且两期各至少 ${repurchaseWatch.minBuyers} 位首购买家时，若同比下降至少 2 个百分点、相对降幅同时达到 20%，则提示下钻。未成熟月份只展示已满 30 日的部分队列。这是模拟经营预警规则，阈值可随实际业务调整。</p>`);
}
function dormant() {
  const dims=dimensions();
  const rows=[meta.seasons[0],meta.seasons[2]].map(s=>{
    const start=day(s.start+'-01');
    const prior=new Map(meta.history.filter(([,d])=>day(d)<start));
    for(const [month,x] of data) {
      if (month>=s.start) break;
      for(const o of x.orders) if(!prior.has(o[0])||prior.get(o[0])<o[1]) prior.set(o[0],o[1]);
    }
    const eligible=new Set([...prior].filter(([,d])=>start-day(d)>=90).map(([u])=>u));
    const buyerSet=new Set(select(s.months,dims).orders.map(o=>o[0]));
    const returned=[...buyerSet].filter(u=>eligible.has(u)).length;
    return [s.months[0]+' 至 '+s.months.at(-1),fmt(eligible.size),fmt(returned),pct(ratio(returned,eligible.size))];
  });
  return panel('长时间未买的买家，淡季有多少人回来？',table(['淡季','季初较久未买的买家','淡季再次支付','再购买率'],rows)+
    '<p class="growth-note">季初已有支付历史且连续 90 日未支付。分母锁定为全商城季初人群，入口、车型和品类筛选作用于回流订单。</p>');
}
function merchandise(s) {
  const [scene,car,cat]=dimensions();
  const months=currentMonths();
  const categories=meta.categories.map((name,i)=>[name,i]).filter(([,i])=>cat==null||cat===i);
  const cars=meta.cars.map((name,i)=>[name,i]).filter(([,i])=>car==null||car===i);
  const categoryRows=categories.map(([name,i])=>[name,select(months,[scene,car,i])]).sort((a,b)=>b[1].gmv-a[1].gmv);
  const chart=`<div class="category-bars">${categoryRows.map(([name,m])=>`<div class="bar-row"><strong>${name}</strong><div class="metric-track" aria-hidden="true"><i style="width:${100*(ratio(m.gmv,s.gmv)||0)}%"></i></div><span>${pct(ratio(m.gmv,s.gmv))}</span></div>`).join('')}</div>`;
  const matrix=cars.map(([name,i])=>[name,categories.map(([,j])=>meta.assortment[i][j]?select(months,[scene,i,j]):null)]);
  const max=Math.max(1,...matrix.flatMap(([,values])=>values.map(m=>m?.gmv||0)));
  const heat=matrix.map(([name,values])=>[name,...values.map(m=>m==null?'未覆盖':!m.visits?'无访问':!m.paid?'有访问，未成交':
    `<span class="matrix-value" style="--heat:${.08+.24*m.gmv/max}">${(m.gmv/1e6).toFixed(2)} 万</span>`)]);
  const detail=matrix.flatMap(([name,values])=>values.flatMap((m,j)=>m?.visits?[[name,categories[j][0],fmt(m.visits),pct(m.conversion),money(m.gmv)]]:[]));
  return panel('哪些商品品类贡献了成交额？','<p class="growth-note">电子设备包含行车记录仪、蓝牙耳机等。</p>'+chart+
    table(['品类','成交额','成交额占比','支付订单','退款率'],categoryRows.map(([name,m])=>[name,money(m.gmv),pct(ratio(m.gmv,s.gmv)),fmt(m.paid),pct(m.refundRate)])))+
    panel('不同车型都买哪些商品？','<p class="growth-note">色块越深，成交额越高。未覆盖表示模拟经营范围中没有这组记录。无访问表示有经营覆盖，但当前筛选没有访问记录。</p>'+
    table(['车型',...categories.map(([name])=>name)],heat)+
    `<details class="matrix-detail"><summary>查看有访问记录的组合明细</summary>${detail.length?table(['车型','品类','访问','成单率','成交额'],detail):'<p>当前筛选没有组合访问记录。</p>'}</details>`);

}
function buyerGoods(s) {
  const buyerIds=new Set(s.orders.map(o=>o[0]));
  const months=new Set(currentMonths());
  const first=[...buyerIds].filter(u=>months.has(firstOrder.get(u)[1].slice(0,7))&&matches(firstOrder.get(u),2,dimensions())).length;
  const bySku=new Map();
  const byBuyer=new Map();
  for(const o of s.orders) {
    bySku.set(o[5],(bySku.get(o[5])||0)+o[6]);
    const b=byBuyer.get(o[0])||{count:0,amount:0,last:''};
    b.count++;
    b.amount+=o[6];
    if(o[1]>b.last) b.last=o[1];
    byBuyer.set(o[0],b);
  }
  const groups={A:[0,0],B:[0,0],C:[0,0]};
  let total=0;
  for(const v of [...bySku.values()].sort((a,b)=>b-a)) {
    total+=v;
    const k=total<=s.gmv*.7?'A':total<=s.gmv*.9?'B':'C';
    groups[k][0]++;
    groups[k][1]+=v;
  }
  const repeatBuyers=[...byBuyer.values()].filter(b=>b.count>=2);
  return `<div class="cards">${card('支付买家数',fmt(s.buyers))}${card('首购买家占比',pct(ratio(first,s.buyers)),fmt(first)+' 名样本内首购买家')}${card('窗口内多次支付买家',fmt(repeatBuyers.length))}</div>`+
    merchandise(s)+repurchase()+rolling()+dormant()+panel('商品 ABC · 哪些商品贡献了成交额？',table(['贡献分组','成交商品规格数','成交额','成交额占比'],Object.entries(groups).map(([k,[n,v]])=>[abcNames[k],fmt(n),money(v),pct(ratio(v,s.gmv))])))+
    methodHub(['rfm','kmeans','abc'],'以下分层和聚类是独立方法样本。');
}
function attribution(pair,dims=dimensions()) {
  const [a,b]=pair.map(x=>select(x.months,dims));
  if(!a.visits||!b.visits||!a.paid||!b.paid)return '<p class="growth-note">选定维度的样本不足以完成增长拆解。</p>';
  const visits=(b.visits-a.visits)*a.conversion*a.aov;
  const conversion=b.visits*(b.conversion-a.conversion)*a.aov;
  const aov=b.visits*b.conversion*(b.aov-a.aov);
  return table(['依次比较的因素','模拟 GMV 变动'],[['访问量',money(visits)],['成单率',money(conversion)],['客单价',money(aov)],['总变动',money(b.gmv-a.gmv)]])+
    '<p class="growth-note">按访问量、成单率、客单价依次替换。结果用于经营分解，因果判断需独立验证。</p>';
}
function comparisons() {
  return panel('按车型适配优化推荐排序',`<p>策略假设：优先展示与用户车型匹配的商品，减少浏览后的流失。对照组沿用原排序，实验组代表拟验证的新排序。按用户 1:1 分流。</p>
    <div class="method-evidence">${VERIFIED_OFFLINE_RESULTS.ab}</div>`+
    table(['退款护栏','对照组','实验组','判断'],[['支付用户退款','1 / 55（1.82%）','4 / 148（2.70%）','+0.88 个百分点，低于演示容忍线 +1.50 个百分点']])+
    '<p class="growth-note">独立 Python 样本使用预设概率模拟结果。退款事件仅 5 个，真实试验需复核随机分流、样本量与售后观察窗。</p>')+
    panel('从实验读数到发布判断',table(['核查项','当前发现','下一步'],[
      ['样本分流','每组 8,000 名用户','核对分流稳定性与重复入组'],
      ['转化收益','支付率提高约 1.16 个百分点','按车型和流量入口检查收益是否集中'],
      ['退款风险','仅 5 笔退款，证据有限','等待相同售后观察窗，按预设容忍线复查'],
      ['发布建议','先扩大验证样本','通过门槛后逐步放量，保留回退方案']
    ]))+
    methodHub(['ab'],'可核验分流、检验与护栏的脚本实现。');
}
function afterSales(s) {
  const rows=meta.categories.map((name,i)=>{
    const orders=s.orders.filter(o=>o[4]===i);
    const m=stats(orders,[]);
    const split=[1,2,3].map(t=>sum(orders,o=>Number(o[7]===t)));
    return [name,fmt(m.paid),...split.map(fmt),pct(m.refundRate),fmt(m.shipped),pct(m.returnRate)];
  });
  return panel('售后分析 · 按品类',`<div class="cards">${card('退款成功订单',fmt(s.refunds))}${card('支付订单退款率',pct(s.refundRate))}${card('所选订单退货率',pct(s.returnRate))}</div>`+
    table(['品类','支付订单','未发货仅退款','发货后仅退款','退货退款','退款率','已发货订单','退货率'],rows)+
    '<p class="growth-note">退款率从已付款订单计算，退货率从已发货订单计算。上表为按付款月份统计这批订单的售后，另有按发货月份统计的退货表。模拟售后跟踪每笔订单支付后 30 天。</p>');
}
function shippingCohort() {
  const dims=dimensions(), months=new Set(currentMonths());
  const orders=[...data.values()].flatMap(m=>m.orders).filter(o=>o[8]&&months.has(o[8].slice(0,7))&&matches(o,2,dims));
  const groups=[...months].map(m=>{
    const rows=orders.filter(o=>o[8].startsWith(m));
    const r=sum(rows,o=>Number(o[7]===3));
    return [m,fmt(rows.length),fmt(r),pct(ratio(r,rows.length))];
  });
  return panel('按发货月看退货率',table(['发货月','已发货订单','完成退货退款','退货率'],groups)+
    '<p class="growth-note">订单来源为 24 个月案例，发货月按实际发货日期归集。首月没有纳入区间前支付订单。</p>');
}
function refundCalendar() {
  const counts=new Map(currentMonths().map(m=>[m,0]));
  const dims=dimensions();
  for(const month of data.values()) for(const order of month.orders) {
    if(!order[9] || !matches(order,2,dims)) continue;
    const key=order[9].slice(0,7);
    if(counts.has(key)) counts.set(key,counts.get(key)+1);
  }
  return panel('按退款完成月 · 笔数',table(['退款完成月','完成退款笔数'],[...counts].map(([m,n])=>[m,fmt(n)]))+
    '<p class="growth-note">含前月支付、本月完成退款的订单。按完成日归集，样本区间前的订单未纳入。</p>');
}
function anomalies(s) {
  const months=currentMonths();
  const monthly=months.map(m=>select([m]));
  const changes=months.slice(1).map((m,i)=>{
    const [a,b]=[monthly[i],monthly[i+1]];
    const delta=a.refundRate==null||b.refundRate==null?null:b.refundRate-a.refundRate;
    const volume=delta==null?null:(b.paid-a.paid)*a.refundRate;
    const risk=delta==null?null:b.paid*delta;
    return {m,b,delta,volume,risk};
  });
  const signed=n=>n==null?'—':(n>0?'+':'')+n.toFixed(1);
  const rows=changes.map(({m,b,delta,volume,risk})=>[
    m,fmt(b.paid),fmt(b.refunds),pct(b.refundRate),biDelta(delta,pp(delta)),signed(volume),signed(risk),
    `<button class="linkbtn" data-signal="${m}">带证据记录行动</button>`
  ]);
  const ranked=changes.filter(x=>x.risk>0).sort((a,b)=>b.risk-a.risk).slice(0,3);
  const highlights=ranked.length?`<ol>${ranked.map(({m,b,delta,volume,risk})=>`<li><strong>${m}</strong> · ${fmt(b.refunds)} 笔退款 / ${fmt(b.paid)} 笔支付 · 退款率较上月 ${pp(delta)}。
    退款率变化对应约 ${signed(risk)} 笔，订单量变化对应约 ${signed(volume)} 笔。 <button class="linkbtn" data-signal="${m}">记录核查动作 →</button></li>`).join('')}</ol>`:'<p>当前范围内没有可比较的退款率上升月份。</p>';
  const focus=ranked[0];
  let byCategory='';
  if(focus) {
    const rows=meta.categories.map((name,i)=>{
      const orders=focus.b.orders.filter(o=>o[4]===i);
      const r=stats(orders,[]);
      const cancel=sum(orders,o=>Number(o[7]===1));
      return {name,r,cancel};
    }).filter(x=>x.r.paid).sort((a,b)=>b.r.refunds-a.r.refunds);
    byCategory=panel(focus.m+' · 哪些品类贡献了退款？',
      table(['品类','支付订单','退款订单','退款率','发货前仅退款','退货退款'],rows.map(({name,r,cancel})=>[
        name,fmt(r.paid),fmt(r.refunds),pct(r.refundRate),fmt(cancel),fmt(r.returns)
      ]))+'<p class="growth-note">此表按退款笔数排序。判断是否需要处理某个品类时，同时核对订单量与退款率。</p>');
  }
  return panel('优先核查哪些月份？',highlights+'<p class="growth-note">按退款率变化对应的退款笔数排序。先以旧退款率计算订单量变化的影响，再以本月订单量计算退款率变化的影响。两项合计等于实际退款笔数变化。</p>')+byCategory+panel('先判断是订单放量还是售后比例变差','<p>从月表选择一个信号，结合支付订单量、入口和品类筛选核查。退款比例升高时，优先看未发货取消和退货退款各自的贡献。</p>')+
    panel('每月退款变化',table(['月份','支付订单','退款订单','退款率','较上月','订单量影响（笔）','退款率影响（笔）','下一步'],rows)+
    '<p class="growth-note">月度变化供定位问题，正式预警需结合品类基准、同季走势和订单量。</p>')+afterSales(s)+refundCalendar()+shippingCohort();
}
function touchAttribution(pair) {
  const [,car,cat]=dimensions();
  const periods=pair.map(period=>{
    const rows=meta.scenes.map((name,i)=>select(period.months,[i,car,cat]));
    const last=rows.map(r=>r.gmv);
    const shared=last.map(()=>0);
    for(const row of rows) for(const order of row.orders) {
      const path=order[11];
      const whole=Math.floor(order[6]/path.length);
      const remainder=order[6]%path.length;
      path.forEach((touch,i)=>{shared[touch]+=whole+Number(i<remainder);});
    }
    return {rows,last,shared,total:sum(last,x=>x)};
  });
  const graphic=`<div class="touch-chart">${meta.scenes.map((name,i)=>`<div><strong>${name}</strong>${periods.map((p,j)=>{
    const share=ratio(p.last[i],p.total);
    return `<div class="bar-row"><span>${j?'后期':'前期'} ${pct(share)}</span><div class="metric-track" aria-hidden="true"><i style="width:${(share||0)*100}%;background:${j?teal:blue}"></i></div></div>`;
  }).join('')}</div>`).join('')}</div>`;
  return panel('推荐、搜索和其他入口各贡献了多少？',`<p>蓝色为前期，绿色为后期。横条比较按最后访问入口归属的成交额占比。</p><p class="growth-note">${pair.map(p=>p.months[0]+' 至 '+p.months.at(-1)).join(' 对比 ')}。保留车型和品类筛选，覆盖全部入口以便横向比较。</p>`+graphic+
    table(['访问入口','曝光 前期 → 后期','点击访问 前期 → 后期','成交额 前期 → 后期','按路径平均分配 前期 → 后期'],meta.scenes.map((name,i)=>[
      name,...['exposures','clicks'].map(key=>periods.map(p=>fmt(p.rows[i][key])).join(' → ')),
      periods.map(p=>money(p.last[i])).join(' → '),periods.map(p=>money(p.shared[i])).join(' → ')
    ]))+
    '<p class="growth-note">最后入口法把成交额全部计入最终入口。路径平均法按订单路径中的触点出现次数平分，两种方法各自加总均等于当期成交额。此图为模拟归因，历史成果中的 18% → 35% 指完整经营年推荐成交额月占比均值。</p>');
}
function casePage() {
  const [,car,cat]=dimensions();
  const dims=[null,car,cat];
  const pair=seasonPair(true);
  const rows=pair.map(s=>{
    const m=select(s.months,dims);
    const r=dims[0]!=null&&dims[0]!==0?stats([],[]):select(s.months,[0,dims[1],dims[2]]);
    const monthShares=s.months.map(x=>{
      const total=select([x],dims).gmv;
      return ratio(dims[0]!=null&&dims[0]!==0?0:select([x],[0,dims[1],dims[2]]).gmv,total);
    }).filter(x=>x!=null);
    return [s.months[0]+' 至 '+s.months.at(-1),money(m.gmv),money(r.gmv),money(m.gmv-r.gmv),pct(r.conversion),pct(ratio(sum(monthShares,x=>x),monthShares.length)),pct(ratio(r.gmv,m.gmv))];
  });
  return panel('推荐增长复盘 · 从点击后流失到策略验证','<ol><li>先看推荐入口访问到支付的落差。 <button class="linkbtn" data-tab="1">查交易漏斗</button></li><li>将车型适配不足作为待验证假设，检查不同车型与品类的访问和成单。 <button class="linkbtn" data-tab="2">查车型与品类</button></li><li>用用户级对照样本演示新排序的转化和退款护栏。 <button class="linkbtn" data-tab="3">查实验结果</button></li><li>上线后同步观察售后及 30／90 日复购。 <button class="linkbtn" data-tab="4">查退款变化</button></li></ol>')+panel('推荐场景成交贡献 · 模拟案例',switches(true)+table(['周期','整体 GMV','推荐流 GMV','其他场景 GMV','推荐流成单率','推荐 GMV 月占比均值','周期 GMV 占比'],rows)+
    '<p class="growth-note">按模拟订单入口归集。比较前先查流量占比，再看推荐流成单率和商品贡献。对照实验另行验证策略效果。</p>')+
    touchAttribution(pair)+methodHub(['attr'],'以下为独立归因样本。');
}
const recordFields=['evidence','action','kpi','owner','due'];
const recordDraft={};
function decision() {
  const signal=state.signal?.evidence||'从经营异常诊断选择一个月，或记录主动分析。';
  return panel('从经营证据到复查计划',`<div class="bi-decision"><p>${signal}</p><p class="growth-note">当前筛选 ${$('start').value} 至 ${$('end').value}。先写待验证判断，再指定动作与复查标准。复查时可沿用同入口、同车型和同品类口径。</p><label>补充证据与待验证判断<textarea id="record-evidence" class="inputbox" rows="3"></textarea></label><label>后续动作<textarea id="record-action" class="inputbox" rows="3"></textarea></label><label>复查指标与标准<input id="record-kpi" class="inputbox" placeholder="例如退款率回到同品类基准以内"></label><div class="record-responsibility"><label>负责人<input id="record-owner" class="inputbox" placeholder="团队或角色"></label><label>复查日期<input id="record-due" class="inputbox" type="date"></label></div><button class="btn" id="copy-decision">生成决策记录</button> <button class="btn" id="copy-output" hidden>复制记录</button><p id="record-error" role="status"></p><pre id="record-output" style="white-space:pre-wrap" aria-live="polite"></pre></div>`);
}
function update() {
  closeMetricHelp();
  const names=['项目介绍',...pages];
  const tabs=[-1,...pages.map((_,i)=>i)];
  $('nav').innerHTML=tabs.map((i,j)=>`<button data-tab="${i}" class="${i===state.tab?'active':''}" ${i===state.tab?'aria-current="page"':''}>${i<0?'⌂':String(i+1).padStart(2,'0')} · ${names[j]}</button>`).join('');
  $('title').textContent=names[state.tab+1];
  $('subtitle').textContent='24 个月模拟经营案例 · 2022.10–2024.09';
  $('start').closest('.filters').hidden=state.tab<0;
  const s=select(currentMonths());
  $('filter-info').textContent=`${fmt(s.visits)} 次访问 · ${fmt(s.paid)} 笔支付订单`;
  $('content').innerHTML=state.tab<0?home():[overview,funnel,buyerGoods,comparisons,anomalies,casePage,decision][state.tab](s);
  if(state.tab===6) for(const key of recordFields) {
    const field=$('record-'+key);
    field.value=recordDraft[key]||'';
    field.oninput=()=>{recordDraft[key]=field.value;};
  }
  biFormatTables($('content'));
  biObservePlots($('content'));
}
function activate(target) {
  const d=target.dataset;
  if(d.tab!==undefined) {
    state.tab=Number(d.tab);state.point=0;
    if(d.caseYear!==undefined) state.season='full';
    if(state.tab<0) {
      for(const id of ['car','cat','scene']) $(id).value='';
      state.season='warm';state.metric='gmv';
    }
  }
  else if(d.season) {state.season=d.season;state.point=0;}
  else if(d.metric) state.metric=d.metric;
  else if(d.point!==undefined) state.point=Number(d.point);
  else if(d.signal) {
    const [scene,car,cat]=dimensions();
    const m=select([d.signal]);
    const months=currentMonths();
    const prior=select([months[months.indexOf(d.signal)-1]]);
    const change=m.refundRate==null||prior.refundRate==null?null:m.refundRate-prior.refundRate;
    const scope=[meta.scenes[scene],meta.cars[car],meta.categories[cat]].map(x=>x||'全部').join(' / ');
    const volume=change==null?null:(m.paid-prior.paid)*prior.refundRate;
    const risk=change==null?null:m.paid*change;
    state.signal={period:d.signal,evidence:`${d.signal} 退款率 ${pct(m.refundRate)}（${fmt(m.refunds)} / ${fmt(m.paid)}），较上月 ${pp(change)}。${risk==null?'':`订单量变化约 ${volume.toFixed(1)} 笔，退款率变化约 ${risk.toFixed(1)} 笔。`}入口 / 车型 / 品类：${scope}。`};
    state.tab=6;
  }
  else if(target.id==='copy-decision') {
    if(!recordDraft.action?.trim()||!recordDraft.kpi?.trim()) {
      $('record-error').textContent='请填写后续动作与复查标准。';
      $('record-output').textContent='';
      $('copy-output').hidden=true;
      return;
    }
    $('record-error').textContent='';
    $('record-output').textContent=['经营决策记录 · 模拟案例',
      `证据期间 ${state.signal?.period||$('start').value+' 至 '+$('end').value}`,
      `观察 ${state.signal?.evidence||'主动分析'} ${recordDraft.evidence||''}`,
      `动作 ${recordDraft.action}`,`复查标准 ${recordDraft.kpi}`,
      `负责人 ${recordDraft.owner||'待分配'} · 复查日期 ${recordDraft.due||'待定'}`].join('\n');
    $('copy-output').hidden=false;
    return;
  } else if(target.id==='copy-output') {
    if(navigator.clipboard) navigator.clipboard.writeText($('record-output').textContent)
      .then(()=>{target.textContent='已复制';})
      .catch(()=>{target.textContent='请选中文字复制';});
    else target.textContent='请选中文字复制';
    return;
  } else return;
  update();
  if(target.matches('button')&&(d.point!==undefined||d.metric||d.season)) {
    const key=d.point!==undefined?'point':d.metric?'metric':'season';
    document.querySelector(`button[data-${key}="${d[key]}"]`)?.focus({preventScroll:true});
  }
}
function fillOptions(id,values,all=false) {
  $(id).replaceChildren(...(all?[new Option('全部','')]:[]),...values.map((x,i)=>new Option(x,all?i:x)));
}
async function get(url) {
  const response=await fetch(url);
  if(!response.ok)throw Error('数据请求失败');
  return response.json();
}
async function init() {
  $('content').textContent='正在加载模拟经营明细…';
  const payload=await get('mall-data.json');
  meta=payload.metadata;
  const months=meta.seasons.flatMap(s=>s.months);
  data=new Map(months.map(month=>[month,payload.months[month]]));
  userOrders=new Map();
  firstOrder=new Map(meta.history.map(([u,d])=>[u,[u,d,-1,-1,-1]]));
  for(const x of data.values()) for(const o of x.orders) {
    const orders=userOrders.get(o[0])||[];
    orders.push(o);
    userOrders.set(o[0],orders);
    if(!firstOrder.has(o[0])||o[1]<firstOrder.get(o[0])[1])firstOrder.set(o[0],o);
  }
  fillOptions('start',months);fillOptions('end',months);
  fillOptions('car',meta.cars,true);fillOptions('cat',meta.categories,true);fillOptions('scene',meta.scenes,true);
  $('end').value=months.at(-1);
  const syncDates=biDateControls(months,update);
  closeMetricHelp=biMetricHelp();
  for(const id of ['start','end','car','cat','scene']) $(id).addEventListener('change',()=>{
    syncDates(id);
    update();
  });
  $('reset').onclick=()=>{
    $('start').value=months[0];$('end').value=months.at(-1);
    for(const id of ['car','cat','scene'])$(id).value='';
    syncDates();
    update();
  };
  document.addEventListener('pointerover',event=>{
    const target=event.target.closest('rect[data-point]');
    if(!target || event.pointerType==='touch' || Number(target.dataset.point)===state.point) return;
    state.point=Number(target.dataset.point);
    const temp=document.createElement('div');
    temp.innerHTML=state.tab===2?repurchase():seasonChart();
    const source=temp.querySelector('.growth-caption');
    const destination=$('content').querySelector('.growth-caption');
    if(source&&destination)destination.innerHTML=source.innerHTML;
    $('content').querySelectorAll('button[data-point]').forEach(button=>{
      button.setAttribute('aria-pressed',String(Number(button.dataset.point)===state.point));
    });
  });
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,[data-point]');
    if(target)activate(target);
  });
  update();
}
init().catch(()=>{$('content').textContent='模拟数据加载失败，请刷新页面后重试。';});
