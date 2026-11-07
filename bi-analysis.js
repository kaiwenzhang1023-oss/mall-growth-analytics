'use strict';

// 支付明细按日筛选。未支付访问只有月汇总，按日等比例拆分并用累计取整守恒。
function selectedPeriod() {
  return state.campaign || [$('start').value+'-01', new Date(monthEnd($('end').value)*86400000).toISOString().slice(0,10)];
}
function selectScope(months=currentMonths(),dims=dimensions()) {
  if(!state.campaign) return select(months,dims);
  const [start,end]=state.campaign;
  const orders=[],unpaid=[];
  for(const key of months) {
    const source=data.get(key);
    const first=day(key+'-01'),last=monthEnd(key),days=last-first+1;
    const lo=Math.max(0,day(start)-first),hi=Math.min(days,day(end)-first+1);
    if(lo>=hi) continue;
    orders.push(...source.orders.filter(o=>o[1]>=start&&o[1]<=end&&matches(o,2,dims)));
    for(const bucket of source.unpaid) {
      if(!matches(bucket,0,dims))continue;
      const part=n=>Math.floor(n*hi/days)-Math.floor(n*lo/days);
      const direct=bucket[6]||0;
      unpaid.push([...bucket.slice(0,4),part(bucket[4]-direct)+part(direct),part(bucket[5]),part(direct)]);
    }
  }
  return {orders,unpaid,...stats(orders,unpaid)};
}

// 模拟财务字段随订单确定。全额退款；退回商品恢复成本，其余发货退款保留成本。
function orderEconomics(o) {
  const units=1+(o[5]%5===0?1:0);
  const cost=Math.round(o[6]*[.64,.71,.57,.69,.76,.82,.62][o[4]]);
  const net=o[7]?0:o[6];
  return {units,net,profit:net-(o[7]===1||o[7]===3?0:cost)};
}
function finance(orders) {
  return orders.reduce((a,o)=>{
    const x=orderEconomics(o);
    return {units:a.units+x.units,net:a.net+x.net,profit:a.profit+x.profit};
  },{units:0,net:0,profit:0});
}
function lifecycle(orders,scopeOrders) {
  const end=day(selectedPeriod()[1]), buyers=new Map();
  for(const o of orders) buyers.set(o[0],(buyers.get(o[0])||0)+o[6]);
  const segments=[
    ['核心客（SVIP）','新品优先购与专享券'],
    ['高潜新客','首购后 14 日发配件搭配券'],
    ['流失预警客','低频短信召回并保留对照组'],
    ['其他活跃客','按购买品类推送相关商品']
  ].map(([name,action])=>({name,action,n:0,gmv:0}));
  const historical=new Map();
  for(const o of scopeOrders) {
    const u=historical.get(o[0])||{n:0,gmv:0,last:0};
    u.n++;u.gmv+=o[6];u.last=Math.max(u.last,day(o[1]));historical.set(o[0],u);
  }
  for(const [id,gmv] of buyers) {
    const u=historical.get(id);
    const idx=end-u.last>=60?2:u.n>=3&&u.gmv>=100000?0:end-day(firstOrder.get(id)[1])<=30?1:3;
    segments[idx].n++;segments[idx].gmv+=gmv;
  }
  const total=sum(segments,x=>x.gmv);
  return table(['人群','买家 UV','人数占比','成交额贡献','建议动作'],segments.map(x=>[x.name,fmt(x.n),pct(ratio(x.n,buyers.size)),pct(ratio(x.gmv,total)),x.action]))+
    '<p class="growth-note">按筛选期末评估。优先识别距上次支付 ≥60 天的买家，其次识别期内 ≥3 单且支付 ≥¥1,000 的核心客，再识别样本首购距今 ≤30 天的新客。金额为支付 GMV。</p>';
}
function productQuadrants(orders) {
  const bySku=new Map();
  for(const o of orders) {
    const item=bySku.get(o[5])||{gmv:0,profit:0,net:0};
    const x=orderEconomics(o);
    item.gmv+=o[6];item.profit+=x.profit;item.net+=x.net;bySku.set(o[5],item);
  }
  const items=[...bySku].filter(([,v])=>v.net>0).map(([id,v])=>({id,...v,margin:v.profit/v.net}));
  if(!items.length)return '<p>当前筛选没有可比较的净销售商品。</p>';
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const midSales=median(items.map(x=>x.gmv)),midMargin=median(items.map(x=>x.margin));
  const groups=['明星爆品','金牛引流品','高利潜力品','滞销清仓品'].map(name=>({name,items:[]}));
  for(const item of items)groups[(item.gmv<midSales?2:0)+(item.margin<midMargin?1:0)].items.push(item);
  const xMin=Math.min(...items.map(x=>x.gmv)),xMax=Math.max(...items.map(x=>x.gmv));
  const yMin=Math.min(...items.map(x=>x.margin)),yMax=Math.max(...items.map(x=>x.margin));
  const x=value=>24+352*(value-xMin)/Math.max(1,xMax-xMin);
  const y=value=>152-130*(value-yMin)/Math.max(.0001,yMax-yMin);
  const scatter=`<svg class="sku-scatter" viewBox="0 0 400 170" role="img" aria-label="横轴 GMV，纵轴模拟净毛利率，分界为各自中位数">
    <path d="M24 22V152H376" fill="none" stroke="#8196af"/>
    <path d="M${x(midSales)} 22V152 M24 ${y(midMargin)}H376" fill="none" stroke="#8196af" stroke-dasharray="4 4"/>
    ${items.map(item=>`<circle cx="${x(item.gmv)}" cy="${y(item.margin)}" r="3" fill="${item.gmv>=midSales?'#315d8a':'#087767'}"><title>SKU ${item.id} · ${money(item.gmv)} · 毛利率 ${pct(item.margin)}</title></circle>`).join('')}
  </svg>`;
  return '<p class="growth-note">横轴按 GMV 中位数 '+money(midSales)+' 分高低，纵轴按模拟净毛利率中位数 '+pct(midMargin)+' 分高低。仅纳入净销售额为正的商品；低销低毛利组仍需结合库存周转确认清仓。</p>'+
    scatter+'<div class="quadrant-grid">'+[2,0,3,1].map(i=>{const g=groups[i];return '<section><strong>'+g.name+' · '+fmt(g.items.length)+' 款</strong><p>'+g.items.sort((a,b)=>b.gmv-a.gmv).slice(0,3).map(x=>'SKU '+x.id+' '+money(x.gmv)).join(' · ')+'</p></section>';}).join('')+'</div>';
}
function salesBridge(a,b) {
  if(!a.paid||!b.paid||!a.visits||!b.visits)return [];
  return [
    ['流量',(b.visits-a.visits)*a.conversion*a.aov],
    ['转化',b.visits*(b.conversion-a.conversion)*a.aov],
    ['客单价',b.visits*b.conversion*(b.aov-a.aov)]
  ];
}
function waterfall(a,b) {
  const factors=salesBridge(a,b);
  if(!factors.length)return '<p>两期均需要有访问和支付订单。</p>';
  let running=a.gmv;
  const rows=[['上月',0,a.gmv],...factors.map(([name,change])=>{
    const from=running;running+=change;return [name,from,running];
  }),['本月',0,b.gmv]];
  const max=Math.max(1,...rows.flatMap(x=>x.slice(1)));
  return '<div class="waterfall">'+rows.map(([name,from,to])=>'<div class="bar-row"><strong>'+name+'</strong><div class="metric-track" aria-hidden="true"><i style="margin-left:'+100*Math.min(from,to)/max+'%;width:'+100*Math.abs(to-from)/max+'%;background:'+(to<from?'#a94646':'#315d8a')+'"></i></div><span>'+money(to-from)+'</span></div>').join('')+'</div>'+
    table(['驱动因素','GMV 影响','占净变化'],factors.map(([name,value])=>[name,money(value),pct(ratio(value,b.gmv-a.gmv))]))+
    '<p class="growth-note">占净变化可为负，表示抵消了部分跌幅。按流量 → 转化率 → 客单价依次替换。中间三项合计 '+money(b.gmv-a.gmv)+'，分解结果用于定位，因果判断需另行验证。</p>';
}
function escapeHtml(value) {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// 个人浏览器台账。存储不可用时仍可在当前页面使用。
const actionStates=['推进中','已达标','未达标归档'];
function readActions() {
  try {
    const rows=JSON.parse(localStorage.getItem('mall-action-ledger-v1')||'[]');
    return Array.isArray(rows)?rows.filter(x=>x&&typeof x.action==='string'):[];
  } catch {return [];}
}
let actions=readActions();
function saveActions() {
  try {localStorage.setItem('mall-action-ledger-v1',JSON.stringify(actions));}
  catch {$('record-error').textContent='浏览器存储不可用，本次打开期间仍可查看。';}
}

// 两比例 z 检验（合并方差）和对数风险比区间。仅用于当前独立模拟实验。
function experimentReadout(control,test,n) {
  const p=(control+test)/(2*n);
  const z=Math.abs(test-control)/n/Math.sqrt(p*(1-p)*2/n);
  const t=1/(1+.2316419*z);
  const pValue=2*Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  const logRR=Math.log(test/control);
  const span=1.96*Math.sqrt(1/test+1/control-2/n);
  return {pValue,lift:test/control-1,lo:Math.exp(logRR-span)-1,hi:Math.exp(logRR+span)-1};
}
function experimentPanel() {
  const r=experimentReadout(55,148,8000);
  const max=Math.max(1,r.hi*1.08);
  return panel('实验方案与统计结果',table(['设计项','当前方案'],[
    ['实验假设','按车型适配重排推荐商品，提高用户支付率'],
    ['分流机制','按用户分流，原排序与新排序各 8,000 人'],
    ['实验周期','独立离线模拟样本，无实际投放日期'],
    ['核心指标','至少支付一次的用户 UV ÷ 分组用户 UV'],
    ['负向护栏','支付用户退款率 · 净毛利须补齐成本数据后核验']
  ])+`<p><strong>相对提升 +${pct(r.lift)}</strong> · p-value ≈ ${r.pValue.toExponential(2)} · ${r.pValue<.05?'差异达到统计显著':'差异无统计学意义'}</p>
    <p>95% 相对提升区间 ${pct(r.lo)} 至 ${pct(r.hi)}</p>
    <div class="metric-track" aria-hidden="true"><i style="margin-left:${100*Math.max(0,r.lo)/max}%;width:${100*(r.hi-Math.max(0,r.lo))/max}%"></i></div>
    <p class="notice">退款率点估计上升 0.88 个百分点。仅 5 个退款事件，净毛利护栏尚无实测值，暂不据此放量。</p>
    <p class="growth-note">双侧两比例 z 检验；相对提升区间使用对数风险比近似。统计显著只描述该模拟样本。</p>`);
}
function caseReview() {
  return panel('从策略选择到经营复盘',table(['复盘步骤','正向案例 · 车型适配推荐','止损案例 · 退款风险情景'],[
    ['业务痛点','推荐曝光后支付转化弱','转化上升，但售后可能抵消收益'],
    ['策略设计','按车型适配召回并重排商品','保留原排序对照，检查高退款品类'],
    ['上线验证','对照组与实验组按用户分流','若退款率超护栏或净毛利下降，暂停放量'],
    ['ROI 与收益','增量净毛利扣除新增投入后 ÷ 新增投入','对比退款损失、履约成本与转化增量'],
    ['反思','识别收益集中在哪些车型与入口','优先核验退款原因和观察窗，再决定是否重试']
  ])+'<p class="growth-note">右列为假设止损情景。ROI 需要实测增量净毛利和新增投入，当前案例不具备实测 ROI。演算示例：若新增净毛利 ¥12,000、投入 ¥8,000，则 ROI 为 50%；若净毛利仅 ¥6,000，同样投入下 ROI 为 −25%。</p>'+
  '<button class="btn" id="open-method-drawer">查看底层 Pandas / 算法逻辑</button><dialog class="method-drawer" id="method-drawer" aria-labelledby="method-drawer-title"><form method="dialog"><button class="btn">关闭</button></form><h3 id="method-drawer-title">成交归因 · Pandas 参考实现</h3><pre></pre></dialog>');
}
function actionLedger() {
  return panel('经营行动台账',actions.length?table(['行动动作','问题来源','责任类目／角色','验收指标','复查日','推进状态'],actions.map((r,i)=>[
    escapeHtml(r.action),escapeHtml(r.source),escapeHtml(r.owner),escapeHtml(r.kpi),escapeHtml(r.due),
    `<select data-action-status="${i}" aria-label="行动 ${i+1} 推进状态">${actionStates.map(label=>`<option${label===r.status?' selected':''}>${label}</option>`).join('')}</select>`
  ]))+'<p class="growth-note">台账保存在当前浏览器。勾选趋势标记的行动按关联月份定位，便于复查同期经营变化。</p>':'<p>暂无记录。可从 04 实验或 05 诊断带入证据。</p>');
}
