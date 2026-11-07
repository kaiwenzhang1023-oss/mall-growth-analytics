'use strict';

// 口径跟随现有统计对象，不在展示层重算经营指标。
const metricDefinitions = new Map(Object.entries({
  '旺季月均 GMV':'2023 和 2024 年各自 4–9 月。旺季支付订单金额合计 ÷ 6；按支付金额统计，退款单列。',
  '模拟 GMV':'当前时间、入口、车型和品类筛选内的支付金额合计，退款单列。',
  '商城整体成单率':'支付访问数 ÷ 商城访问数。模拟数据中一笔支付订单对应一次支付访问；首页为两个完整旺季。',
  '90 日累计复购率':'满 90 日观察期的首购买家中，第 1–90 天内至少再次支付一次的人数 ÷ 队列人数。首页使用两个旺季的 4–6 月首购队列。',
  '支付订单退款率':'至少一笔退款成功的支付订单数 ÷ 支付订单数，按原支付队列归集，每笔订单仅计一次。',
  '支付订单':'当前筛选内的已支付订单数，含后来发生退款的订单。',
  '支付买家':'当前筛选内至少支付一次的买家数，按用户去重。',
  '支付买家数':'当前筛选内至少支付一次的买家数，按用户去重。',
  '客单价':'当前筛选内支付金额合计 ÷ 支付订单数。',
  '商品曝光点击率':'点击访问数 ÷ 模拟曝光次数。案例按每次有点击的访问记录一次点击。',
  '访问点击率':'发生点击的访问数 ÷ 全部访问数。',
  '下单支付率':'完成支付的访问数 ÷ 发生下单的访问数，按同一次访问的漏斗统计。',
  '首购买家占比':'当前筛选内首次支付也符合筛选条件的买家数 ÷ 支付买家数。首购按样本内可观测历史识别。',
  '窗口内多次支付买家':'当前筛选窗口内至少支付两笔订单的去重买家数。',
  '退款成功订单':'当前支付队列中至少一笔退款成功的订单数，包含发货前仅退款、发货后仅退款和退货退款。',
  '所选订单退货率':'当前支付队列内退货退款订单数 ÷ 同一支付队列内已发货订单数。按发货月统计的口径另表展示。'
}));

// 单个金额与单位一起换行，让两期对比可在窄卡片自然折行。
function biKpi(value, unit='') {
  return String(value).split(' → ').map(part=>{
    const m=/^(¥\s*)?([\d,.]+)\s*(万|元|单|人|笔|%)?$/.exec(part);
    if(!m) return part;
    const [ , prefix, number, suffix ]=m;
    return `<span class="bi-value">${prefix?`<span class="bi-unit">${prefix}</span>`:''}${number}${suffix||unit?`<span class="bi-unit">${suffix==='%'?'':' '}${suffix||unit}</span>`:''}</span>`;
  }).join(' <span class="bi-arrow">→</span> ');
}

function biDelta(value, formatted) {
  if(value==null||!Number.isFinite(value))return '—';
  const direction=value>0?'up':value<0?'down':'flat';
  return `<span class="bi-delta" data-direction="${direction}">${value>0&&!formatted.startsWith('+')?'+':''}${formatted}</span>`;
}

// 月份由数据快照决定；排序和边界保护也适用于后续换数据。
function biDateControls(months, onChange) {
  const start=document.getElementById('start'), end=document.getElementById('end');
  const host=document.getElementById('bi-presets');
  const latest=months.at(-1);
  const year=[...new Set(months.map(m=>m.slice(0,4)))].reverse().find(y=>months.filter(m=>m.startsWith(y+'-')).length===12);
  const campaignYear=[...new Set(months.map(m=>m.slice(0,4)))].reverse().find(y=>months.includes(y+'-11')&&months.includes(y+'-12'));
  const ranges=[
    ['近 1 季度',months.at(-Math.min(3,months.length)),latest,'数据末尾连续三个月'],
    ...(campaignYear?[['大促复盘',campaignYear+'-11',campaignYear+'-12','模拟双11、双12自然月复盘']]:[]),
    ...(year?[[year+' 全年大盘',year+'-01',year+'-12','最新完整自然年']]:[])
  ];
  host.replaceChildren(...ranges.map(([label,from,to,note])=>{
    const button=document.createElement('button');
    button.type='button';button.className='btn';button.textContent=label;
    button.title=`${note} · ${from} 至 ${to}`;
    button.onclick=()=>{start.value=from;end.value=to;sync();onChange();};
    return button;
  }));
  function sync(changed) {
    if(!months.includes(start.value))start.value=months[0];
    if(!months.includes(end.value))end.value=latest;
    if(start.value>end.value) {
      if(changed==='start')end.value=start.value;
      else start.value=end.value;
    }
    for(const option of start.options)option.disabled=option.value>end.value;
    for(const option of end.options)option.disabled=option.value<start.value;
    [...host.children].forEach((button,i)=>{
      button.setAttribute('aria-pressed',String(start.value===ranges[i][1]&&end.value===ranges[i][2]));
    });
  }
  sync();
  return sync;
}

// 单一浮层和事件委托适配动态卡片，滚动时重定位，键盘与触屏可关闭。
function biMetricHelp() {
  const popup=document.getElementById('bi-metric-help');
  let active=null, pinned=false;
  const trigger=target=>target.closest?.('[data-bi-metric]');
  function position() {
    if(!active?.isConnected){close();return;}
    const rect=active.getBoundingClientRect(), edge=8, gap=6;
    const height=popup.offsetHeight, width=popup.offsetWidth;
    if(rect.bottom<0||rect.top>innerHeight){close();return;}
    const above=rect.top-gap-height;
    const below=rect.bottom+gap;
    const top=below+height<=innerHeight-edge||above<edge?below:above;
    popup.style.top=Math.max(edge,Math.min(top,innerHeight-height-edge))+'px';
    popup.style.left=Math.max(edge,Math.min(rect.left,innerWidth-width-edge))+'px';
  }
  function close() {
    active?.removeAttribute('aria-describedby');
    active?.setAttribute('aria-expanded','false');
    popup.hidden=true;active=null;pinned=false;
  }
  function open(button) {
    if(active!==button)close();
    active=button;
    popup.textContent=metricDefinitions.get(button.dataset.biMetric);
    popup.hidden=false;
    button.setAttribute('aria-describedby',popup.id);
    button.setAttribute('aria-expanded','true');
    position();
  }
  document.addEventListener('pointerover',event=>{
    const button=trigger(event.target);
    if(button&&!pinned&&event.pointerType!=='touch')open(button);
  });
  document.addEventListener('pointerout',event=>{
    if(active&&trigger(event.target)===active&&!active.contains(event.relatedTarget)&&!pinned&&document.activeElement!==active)close();
  });
  document.addEventListener('focusin',event=>{
    const button=trigger(event.target);
    if(button)open(button);
  });
  document.addEventListener('focusout',event=>{if(event.target===active&&!pinned)close();});
  document.addEventListener('click',event=>{
    const button=trigger(event.target);
    if(!button){close();return;}
    if(pinned&&button===active){close();return;}
    open(button);pinned=true;
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  addEventListener('scroll',()=>{if(active)position();},true);
  addEventListener('resize',()=>{if(active)position();});
  return close;
}

const biNumericText=/^[+−-]?\s*¥?\s*[\d,.]+\s*(?:%|万|元|人|单|笔|次|个百分点)?(?:\s*[（(][\d,.]+\s*\/\s*[\d,.]+[）)])?$/u;
function biAlignTable(table) {
  const rows=[...table.tBodies].flatMap(body=>[...body.rows]);
  const heads=[...(table.tHead?.rows[0]?.cells||[])];
  heads.forEach((head,i)=>{
    if(i===0||rows.some(row=>row.cells.length!==heads.length))return;
    const cells=rows.map(row=>row.cells[i]);
    const values=cells.map(cell=>cell.textContent.trim()).filter(v=>v!=='—'&&v!=='');
    if(values.length&&values.every(v=>biNumericText.test(v))) {
      head.classList.add('bi-num');
      cells.forEach(cell=>cell.classList.add('bi-num'));
    }
  });
}
function biFormatTables(root) {
  root.querySelectorAll('.tbl,.evidence-table').forEach(table=>{
    if(table.classList.contains('evidence-table')&&!table.parentElement.classList.contains('bi-evidence-scroll')) {
      const wrapper=document.createElement('div');
      wrapper.className='bi-evidence-scroll';
      table.before(wrapper);wrapper.append(table);
    }
    const wrapper=table.parentElement;
    wrapper.tabIndex=0;
    wrapper.setAttribute('role','region');
    wrapper.setAttribute('aria-label',table.closest('.panel')?.querySelector('h2')?.textContent||'方法数据表');
    biAlignTable(table);
  });
}

// SVG 按容器伸缩。用 viewBox 比例反算刻度字号，避免宽屏把轴文字放大。
const biPlotObserver = new ResizeObserver(entries=>{
  for(const {target:plot,contentRect} of entries) {
    const scale=contentRect.width/plot.viewBox.baseVal.width;
    if(scale>0)for(const tick of plot.querySelectorAll('text'))tick.style.fontSize=(12/scale)+'px';
  }
});
function biObservePlots(root) {
  biPlotObserver.disconnect();
  root.querySelectorAll('.growth-plot').forEach(plot=>biPlotObserver.observe(plot));
}
