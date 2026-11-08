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
  // SKU 的模拟供货条件固定，避免同一品类所有商品落在一条毛利带。
  const skuCostOffset=(((Math.imul(o[5]+1,2654435761)>>>0)%101)/100-.5)*.24;
  const cost=Math.round(o[6]*([.64,.71,.57,.69,.76,.82,.62][o[4]]+skuCostOffset));
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
  // 演示目标为月均 ¥7,500、净毛利率 35%，随所选时间长度换算销售目标。
  const [from,to]=selectedPeriod();
  const midSales=750000*(day(to)-day(from)+1)/30.4375,midMargin=.35;
  const groups=['明星爆品','金牛引流品','高利潜力品','滞销清仓品'].map(name=>({name,items:[]}));
  for(const item of items)groups[(item.gmv<midSales?2:0)+(item.margin<midMargin?1:0)].items.push(item);
  const xMin=0,xMax=Math.max(midSales*1.1,...items.map(x=>x.gmv));
  const yMin=Math.min(midMargin-.05,...items.map(x=>x.margin)),yMax=Math.max(midMargin+.05,...items.map(x=>x.margin));
  const x=value=>24+352*(value-xMin)/Math.max(1,xMax-xMin);
  const y=value=>152-130*(value-yMin)/Math.max(.0001,yMax-yMin);
  const scatter=`<svg class="sku-scatter" viewBox="0 0 400 170" role="img" aria-label="横轴 GMV，纵轴模拟净毛利率，分界为模拟经营目标">
    <path d="M24 22V152H376" fill="none" stroke="#8196af"/>
    <path d="M${x(midSales)} 22V152 M24 ${y(midMargin)}H376" fill="none" stroke="#8196af" stroke-dasharray="4 4"/>
    ${items.map(item=>`<circle cx="${x(item.gmv)}" cy="${y(item.margin)}" r="3" fill="${item.gmv>=midSales?'#315d8a':'#087767'}"><title>SKU ${item.id} · ${money(item.gmv)} · 毛利率 ${pct(item.margin)}</title></circle>`).join('')}
  </svg>`;
  return '<p class="growth-note">横轴目标为月均 GMV ¥7,500，按所选天数折算为 '+money(midSales)+'。纵轴目标为模拟净毛利率 '+pct(midMargin)+'。目标为演示假设，各组由实际模拟明细计算。仅纳入净销售额为正的商品；低销低毛利组仍需结合库存周转确认清仓。</p>'+
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
// 按同一维度计算前后期可加总的变化，避免把份额排名误当成异常贡献。
function anomalySlices(before,after,metric) {
  const facets=[
    ['渠道',meta.scenes,o=>o[2]],
    ['品类',meta.categories,o=>o[4]],
    ['买家类型',['样本内首购订单','其他订单'],o=>firstOrder.get(o[0])===o?0:1]
  ];
  return facets.map(([label,names,category])=>{
    const aggregate=orders=>{
      const result=names.map(()=>0);
      for(const o of orders) result[category(o)]+=metric==='refund'?Number(o[7]>0):o[6];
      return result;
    };
    const a=aggregate(before.orders),b=aggregate(after.orders);
    return '<h3>'+label+'</h3>'+table([label,'上月','本月','变化'],names.map((name,i)=>[name,a[i],b[i],b[i]-a[i]])
      .sort((x,y)=>Math.abs(y[3])-Math.abs(x[3])).map(([name,...values])=>[name,...values.map(metric==='refund'?fmt:money)]));
  }).join('')+'<p class="growth-note">各维度独立拆分，同一订单会同时落在一个渠道、品类和买家类型。变化用于定位排查范围，不能证明根因。</p>';
}
function escapeHtml(value) {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// 个人浏览器台账。存储不可用时仍可在当前页面使用。
const actionStates=['待上线','实验中','验证通过','验证失败','归档'];
const ledgerFilters={status:'',source:''};
const legacyStatuses={'推进中':'实验中','已达标':'验证通过','未达标归档':'归档'};
function readActions() {
  try {
    const rows=JSON.parse(localStorage.getItem('mall-action-ledger-v1')||'[]');
    return Array.isArray(rows)?rows.filter(x=>x&&typeof x.action==='string').map(x=>({...x,source:String(x.source||'主动分析'),status:legacyStatuses[x.status]||x.status||actionStates[0]})):[];
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
// 04 与 07 共用这组全样本结果，避免交接文案与实验指标脱节。
const recommendationExperiment={
  name:'首页推荐改版',usersPerGroup:8000,controlPaid:55,testPaid:148,
  controlRefunded:1,testRefunded:4,refundLimit:.015
};
function recommendationMetrics() {
  const x=recommendationExperiment;
  const control=x.controlPaid/x.usersPerGroup,test=x.testPaid/x.usersPerGroup;
  const refundControl=x.controlRefunded/x.controlPaid,refundTest=x.testRefunded/x.testPaid;
  return {control,test,change:test-control,refundControl,refundTest,refundChange:refundTest-refundControl,
    refundEvents:x.controlRefunded+x.testRefunded,...experimentReadout(x.controlPaid,x.testPaid,x.usersPerGroup)};
}
// 合成周度明细。每周每人只归入一个首次入组品类和来源渠道，两个实验臂样本数相同。
const experimentWeeks=[
  ['05.06–05.12',[[510,3,9],[290,2,5],[450,3,8],[250,1,4],[310,2,5],[190,1,2]]],
  ['05.13–05.19',[[480,3,10],[320,2,6],[420,4,8],[280,2,4],[300,2,5],[200,1,3]]],
  ['05.20–05.26',[[460,3,10],[340,2,6],[410,3,8],[290,2,5],[320,2,6],[180,1,3]]],
  ['05.27–06.02',[[470,4,11],[330,3,7],[430,4,9],[270,2,5],[290,2,6],[210,1,3]]]
];
const experimentCategories=['骑行装备','车型配件','养护用品'];
const experimentChannels=['App 直访','站内导流'];
const experimentScope={week:'',category:'',channel:''};
function experimentBreakdown() {
  const weeks=experimentWeeks.flatMap(([label,cells],index)=>{
    if(experimentScope.week!==''&&Number(experimentScope.week)!==index)return [];
    const [users,control,test]=cells.reduce((totals,cell,i)=>{
      if((experimentScope.category!==''&&Number(experimentScope.category)!==Math.floor(i/2))||
         (experimentScope.channel!==''&&Number(experimentScope.channel)!==i%2))return totals;
      return totals.map((n,j)=>n+cell[j]);
    },[0,0,0]);
    return {label,users,control,test};
  });
  const picker=(key,label,options)=>`<label><strong>${label}</strong><select class="inputbox" data-experiment-slice="${key}"><option value="">全部</option>${options.map((name,i)=>`<option value="${i}"${String(i)===experimentScope[key]?' selected':''}>${name}</option>`).join('')}</select></label>`;
  const rate=(paid,users)=>pct(ratio(paid,users));
  const row=({label,users,control,test})=>[label,fmt(users),`${fmt(control)} 人（${rate(control,users)}）`,`${fmt(test)} 人（${rate(test,users)}）`,pp(ratio(test-control,users))];
  const total=weeks.reduce((acc,w)=>({label:'所选切片合计',users:acc.users+w.users,control:acc.control+w.control,test:acc.test+w.test}),{users:0,control:0,test:0});
  return panel('入组周趋势与切片',`<p class="growth-note">选择首次入组时的品类和来源渠道，可交叉查看同一组实验。渠道指到达首页推荐前的来源，分组后产生的购买行为不参与切片定义。</p>
    <div class="experiment-slices">${picker('week','入组周',experimentWeeks.map(([label])=>label))}${picker('category','品类',experimentCategories)}${picker('channel','来源渠道',experimentChannels)}</div>
    <p class="growth-note" role="status">当前切片每组 ${fmt(total.users)} 人。切片仅用于描述性观察，正式检验与放量判断基于全样本。</p>`+
    plot(weeks.map(w=>w.label.split('–')[0]),[
      {name:'对照组',color:blue,values:weeks.map(w=>ratio(w.control,w.users))},
      {name:'实验组',color:teal,values:weeks.map(w=>ratio(w.test,w.users))}
    ],pct)+table(['模拟入组周','每组入组人数','对照组支付人数（率）','实验组支付人数（率）','绝对变化'],[...weeks.map(row),row(total)])+
    '<p class="growth-note">横轴为用户入组周。支付按入组后 7 日内至少支付一次计数，每个用户只进入一周。周度与切片明细均为合成数据，按原实验全样本总量校准。</p>');
}
function experimentPanel() {
  const x=recommendationExperiment,r=recommendationMetrics();
  const paidCell=(paid,rate)=>`${fmt(paid)} / ${fmt(x.usersPerGroup)}（${pct(rate)}）`;
  const refundCell=(count,paid,rate)=>`${fmt(count)} / ${fmt(paid)}（${pct(rate)}）`;
  const max=Math.max(1,r.hi*1.08);
  return panel('首页推荐改版 · A/B 实验评审',`<div class="experiment-summary">
    <span class="growth-note">独立离线模拟样本 · 模拟入组 2024.05.06–2024.06.02 · 全样本口径</span>
    <h3>支付用户率显著提升，建议继续小流量验证</h3>
    <p>对照组 <strong>${pct(r.control)}</strong> → 实验组 <strong>${pct(r.test)}</strong>，绝对提升 <strong>${pp(r.change)}</strong>。</p>
    <p>放量判断：退款证据不足，净毛利和客诉待核验。先完成护栏复查，再决定是否扩大上线。</p>
    <button class="btn hero-primary" data-experiment-action>记录下一轮验证计划</button>
  </div>`)+
  panel('实验设计',table(['设计项','当前方案'],[
    ['实验假设','按车型适配调整首页推荐排序，提高支付用户率'],
    ['对照组','沿用原排序'],
    ['实验组','使用按车型适配调整后的排序'],
    ['分流机制',`按用户 1:1 分流，每组 ${fmt(x.usersPerGroup)} 人`],
    ['模拟入组周期','2024.05.06–2024.06.02（4 周）'],
    ['支付观察窗','入组后 7 日，末批观察截至 2024.06.09'],
    ['核心指标','至少支付一次的用户数 ÷ 分组用户数']
  ])+'<p class="growth-note">本页按实验分组用户统计。首页历史成果中的推荐流成单率按推荐入口曝光访问 PV 统计。</p>')+
  panel('实验结果',table(['核心指标','对照组','实验组','绝对变化'],[
    ['支付用户率',paidCell(x.controlPaid,r.control),paidCell(x.testPaid,r.test),pp(r.change)]
  ])+`<details class="matrix-detail"><summary>查看统计检验与置信区间</summary>
    <p>相对提升 +${pct(r.lift)} · <abbr title="假设两组真实支付率相同，观察到当前或更极端差异的概率">p-value</abbr> ≈ ${r.pValue.toExponential(2)} · ${r.pValue<.05?'差异达到统计显著':'差异无统计学意义'}</p>
    <p><abbr title="按对数风险比计算，用于量化相对提升估计的不确定性">95% 相对提升区间</abbr> +${pct(r.lo)} 至 +${pct(r.hi)}</p>
    <div class="metric-track" aria-hidden="true"><i style="margin-left:${100*r.lo/max}%;width:${100*(r.hi-r.lo)/max}%"></i></div>
    <p class="growth-note">双侧两比例 z 检验，显著性阈值 0.05；相对提升区间使用对数风险比近似。</p>
  </details>`)+
  experimentBreakdown()+
  panel('护栏与放量判断',table(['护栏','对照组','实验组','状态','复查要求'],[
    ['支付用户退款率',refundCell(x.controlRefunded,x.controlPaid,r.refundControl),refundCell(x.testRefunded,x.testPaid,r.refundTest),
      '<strong class="experiment-caution">证据不足，继续观察</strong>',`点估计上升 ${pp(r.refundChange)}，两组合计仅 ${r.refundEvents} 个退款事件。用相同售后观察窗复查退款增幅是否在 ${pp(x.refundLimit)} 的演示容忍线内。`],
    ['净毛利','待补','待补','待核验','补齐分组订单成本、退款金额及优惠补贴，按同一口径比较。'],
    ['客诉','待补','待补','待核验','补齐同一观察窗的分组客诉事件及分母，比较客诉率。']
  ])+'<p class="growth-note">支付用户退款率 = 发生退款的支付用户数 ÷ 支付用户数。退款点估计处于演示容忍线内，仍需扩大样本验证。</p>');
}
function experimentHandoff() {
  const x=recommendationExperiment,r=recommendationMetrics();
  return {
    source:'04 · 策略实验',
    evidence:`${x.name}：支付用户率 ${pct(r.control)} → ${pct(r.test)}（${pp(r.change)}，差异显著）；退款率点估计 ${pp(r.refundChange)}，合计 ${r.refundEvents} 个退款事件。净毛利与客诉待核验。`,
    draft:{
      action:'保持小流量验证，扩大退款观察样本，补齐两组净毛利与客诉数据后复评放量。',
      kpi:`复查支付用户率与显著性；同窗核验退款率增幅 ≤${pp(x.refundLimit)}；确认净毛利与客诉达到预先约定的阈值。`
    }
  };
}
function caseReview() {
  return panel('推荐复盘 · 正向案例与止损情景',table(['复盘步骤','正向案例 · 车型适配推荐','止损案例 · 退款风险情景'],[
    ['业务痛点','推荐曝光后支付转化弱','转化上升，但售后可能抵消收益'],
    ['诊断假设','车型适配不足可能影响下单','退款集中于部分品类，需核对订单量和退款率'],
    ['实施方案','按车型适配召回并重排商品','保留原排序对照，检查高退款品类'],
    ['预期目标','提高支付用户率，退款增幅不超过 1.50 个百分点','退款或净毛利护栏未通过时暂停放量'],
    ['执行验证','对照组与实验组按用户分流，各 8,000 人','将退款和履约损失纳入复核'],
    ['数据结果','模拟支付用户率 0.69% → 1.85%，退款事件仅 5 个','假设净毛利增量低于新增投入，触发止损复查'],
    ['ROI 与收益','增量净毛利扣除新增投入后 ÷ 新增投入','对比退款损失、履约成本与转化增量'],
    ['反思','识别收益集中在哪些车型与入口','优先核验退款原因和观察窗，再决定是否重试']
  ])+'<p class="growth-note">右列为假设止损情景。ROI 需要实测增量净毛利和新增投入，当前案例不具备实测 ROI。演算示例：若新增净毛利 ¥12,000、投入 ¥8,000，则 ROI 为 50%；若净毛利仅 ¥6,000，同样投入下 ROI 为 −25%。</p>'+
  '<button class="btn" data-case-action>将复盘结论加入行动台账</button> <button class="btn" id="open-method-drawer">查看底层 Pandas / 算法逻辑</button><dialog class="method-drawer" id="method-drawer" aria-labelledby="method-drawer-title"><form method="dialog"><button class="btn">关闭</button></form><h3 id="method-drawer-title">成交归因 · Pandas 参考实现</h3><pre></pre></dialog>');
}
function actionLedger() {
  const sources=[...new Set(actions.map(r=>r.source))];
  const options=(values,current)=>values.map(x=>`<option${x===current?' selected':''}>${escapeHtml(x)}</option>`).join('');
  const rows=actions.flatMap((r,i)=>{
    if((ledgerFilters.status&&r.status!==ledgerFilters.status)||(ledgerFilters.source&&r.source!==ledgerFilters.source))return [];
    const source=/^0[456]/.test(r.source)?`<button class="linkbtn" data-action-source="${i}">${escapeHtml(r.source)} →</button>`:escapeHtml(r.source);
    return [[escapeHtml(r.action),source,escapeHtml(r.evidence||'—'),escapeHtml(r.owner),escapeHtml(r.kpi),escapeHtml(r.benefit||'待量化'),escapeHtml(r.due),
      `<select data-action-status="${i}" aria-label="行动 ${i+1} 推进状态">${options(actionStates,r.status)}</select>`]];
  });
  return panel('经营行动台账',`<div class="ledger-filters"><label>推进状态<select class="inputbox" data-ledger-filter="status"><option value="">全部</option>${options(actionStates,ledgerFilters.status)}</select></label>
    <label>来源模块<select class="inputbox" data-ledger-filter="source"><option value="">全部</option>${options(sources,ledgerFilters.source)}</select></label></div>`+
    (rows.length?table(['行动动作','问题来源','问题简述','责任类目／角色','验收指标','预期收益','复查日','推进状态'],rows):'<p>当前没有匹配的行动记录。可从 04 实验、05 诊断或 06 复盘带入证据。</p>')+
    '<p class="growth-note">台账保存在当前浏览器。点击问题来源可回看原分析；勾选趋势标记的行动按关联月份定位。</p>');
}
