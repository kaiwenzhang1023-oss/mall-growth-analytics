# ======================================================================
# 摩托范 APP 装备商城：APP 内多触点归因（末次触点 + 线性 双口径）
# ----------------------------------------------------------------------
# 项目整体周期：2022.03 - 2024.12（基建 → 旺季增长 → 淡季抗周期 → 常态化迭代）
# 本脚本阶段：2023.04 - 2023.09【骑行旺季 · APP内流量场景贡献评估】
# 数据窗口：2023-04-01 ~ 2023-09-30；只分析 APP 内部场景，不涉及外部投放渠道
# 方法：末次触点归因(看收口) + 线性归因(看全链路种草) 双口径对比 + 月度归因趋势
# 依赖：pip install pandas numpy matplotlib
# ======================================================================

# ===================== Cell 1：导入工具包 + 全局配置 =====================
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

import warnings
warnings.filterwarnings('ignore')

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Zen Hei']
plt.rcParams['axes.unicode_minus'] = False


# ===================== Cell 2：模拟 APP 内会话触点路径 =====================
# 每个会话(session) = 用户在APP内一段有序的访问路径，由多个触点(scene)组成；
# 路径早期偏“种草触点”，晚期偏“收口触点”，最终判断是否成交。
np.random.seed(42)
n_session = 2000

# 旺季窗口 2023-04-01 ~ 2023-09-30，给每个会话随机分配一个访问日期
win_start = pd.Timestamp("2023-04-01")
day_span = (pd.Timestamp("2023-09-30") - win_start).days

# APP 内部场景（触点）
# 种草型（路径早期出现，先激发兴趣，但不直接收口）
seed_scenes = ['社区帖子挂载', '车型专区', '活动Banner']
# 收口型（路径晚期出现，直接促成下单）
close_scenes = ['首页推荐流', '商城搜索', '购物车推荐', '消息召回']

# 各收口场景的成交基础概率（搜索/购物车意图最强，转化最高）
close_pay_prob = {
    '首页推荐流': 0.35,
    '商城搜索':   0.55,
    '购物车推荐': 0.45,
    '消息召回':   0.25,
}

records = []
for s in range(n_session):
    # 会话级访问日期（同一路径上的触点同一天），并抽取月份
    visit_date = win_start + pd.to_timedelta(np.random.randint(0, day_span), unit='D')
    month = visit_date.month
    n_touch = np.random.randint(2, 5)  # 一条路径 2~4 个触点
    touches = []
    for t in range(n_touch):
        if t == 0:
            # 第一个触点：优先种草场景
            scene = np.random.choice(seed_scenes + close_scenes, p=[0.3, 0.25, 0.15, 0.15, 0.1, 0.05, 0.0])
        else:
            # 后续触点：优先收口场景
            scene = np.random.choice(close_scenes + seed_scenes, p=[0.25, 0.2, 0.15, 0.1, 0.1, 0.12, 0.08])
        touches.append(scene)

    # 成交概率由“最后一个触点”决定（收口场景负责临门一脚）
    last_scene = touches[-1]
    base_p = close_pay_prob.get(last_scene, 0.15)
    pay = 1 if np.random.rand() < base_p else 0
    amount = np.random.randint(100, 3000) if pay == 1 else 0

    # 拆成一行一个触点，touch_idx 表示路径顺序（0=最早）
    for idx, scene in enumerate(touches):
        records.append({
            'session_id': f'S{s:05d}',
            'touch_idx': idx,
            'scene': scene,
            'pay': pay,
            'amount': amount,
            'n_touch': n_touch,
            'is_last': 1 if idx == n_touch - 1 else 0,
            'visit_date': visit_date,
            'month': month,
        })

events = pd.DataFrame(records)
print("触点记录规模：", events.shape)
print("成交会话数：", events[events['pay'] == 1]['session_id'].nunique())
events.head()


# ===================== Cell 3：末次触点归因（Last Touch） =====================
# 规则：一笔成交的全部金额，记给“下单前最后一个触点”（路径最后一步）
# 用途：看哪个场景负责“收口转化”，适合跟踪推荐流/搜索的直接成单贡献
last_attr = events[(events['pay'] == 1) & (events['is_last'] == 1)].groupby('scene').agg(
    末次归因GMV=('amount', 'sum'),
    末次归因订单=('session_id', 'nunique')
)
print("==== 末次触点归因 ====")
print(last_attr)


# ===================== Cell 4：线性归因（Linear） =====================
# 规则：一笔成交的金额，平均分给路径上的每一个触点（每个触点占 1/n_touch）
# 用途：把功劳也分给前置种草触点（社区帖子、车型专区），避免它们被末次归因低估
def linear_amount(row):
    return row['amount'] / row['n_touch']  # 每个触点分得 金额/触点数

events['linear_amt'] = events.apply(linear_amount, axis=1)
linear_attr = events[events['pay'] == 1].groupby('scene').agg(
    线性归因GMV=('linear_amt', 'sum'),
    触点出现次数=('session_id', 'count')
)
print("\n==== 线性归因 ====")
print(linear_attr)


# ===================== Cell 5：两套口径对比（核心！看种草渠道被低估多少） =====================
compare = last_attr.join(linear_attr, how='outer').fillna(0)
compare['末次GMV占比%'] = (compare['末次归因GMV'] / compare['末次归因GMV'].sum() * 100).round(1)
compare['线性GMV占比%'] = (compare['线性归因GMV'] / compare['线性归因GMV'].sum() * 100).round(1)
compare['口径差值(线性-末次)%'] = (compare['线性GMV占比%'] - compare['末次GMV占比%']).round(1)
compare = compare.sort_values('线性归因GMV', ascending=False)
print("==== 末次 vs 线性 归因对比 ====")
print(compare[['末次归因GMV', '线性归因GMV', '末次GMV占比%', '线性GMV占比%', '口径差值(线性-末次)%']])

# 分组柱状图：两套口径下各场景 GMV 占比
plt.figure(figsize=(11, 5.5))
x = np.arange(len(compare))
w = 0.38
plt.bar(x - w/2, compare['末次GMV占比%'], w, label='末次触点归因', color='#4C78A8')
plt.bar(x + w/2, compare['线性GMV占比%'], w, label='线性归因', color='#F58518')
plt.xticks(x, compare.index, rotation=20)
plt.ylabel('GMV 占比 %')
plt.title("APP内场景：末次归因 vs 线性归因 GMV 贡献对比")
plt.legend()
for i, v in enumerate(compare['口径差值(线性-末次)%']):
    plt.text(i, max(compare['末次GMV占比%'].iloc[i], compare['线性GMV占比%'].iloc[i]) + 0.5,
             f"{v:+.1f}", ha='center', fontsize=9, color='#E45756')
plt.tight_layout()
plt.show()


# ===================== Cell 5.5（难度提升）：月度归因贡献趋势 =====================
# 按月看两套口径归因GMV走势，观察种草 vs 收口贡献在旺月度的变化
last_m = events[(events['pay'] == 1) & (events['is_last'] == 1)].groupby('month')['amount'].sum()
lin_m = events[events['pay'] == 1].groupby('month')['linear_amt'].sum()
m_trend = pd.DataFrame({'末次归因GMV': last_m, '线性归因GMV': lin_m}).fillna(0)
print("==== 月度归因贡献趋势 ====")
print(m_trend.round(0))

plt.figure(figsize=(9, 4.5))
plt.plot(m_trend.index, m_trend['末次归因GMV'], 'o-', label='末次归因GMV', color='#4C78A8')
plt.plot(m_trend.index, m_trend['线性归因GMV'], 's--', label='线性归因GMV', color='#F58518')
plt.xlabel('月份（2023年4-9月）'); plt.ylabel('归因GMV（元）')
plt.title('旺月度：末次 vs 线性 归因GMV趋势')
plt.legend(); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()


# ===================== Cell 6：触点质量参考（出现次数 + 收口转化） =====================
# 各场景作为“最后收口触点”时的成交率，衡量其直接转化能力
close_rate = events[events['is_last'] == 1].groupby('scene').agg(
    作为收口次数=('session_id', 'nunique'),
    成交次数=('pay', 'sum')
)
close_rate['收口成交率%'] = (close_rate['成交次数'] / close_rate['作为收口次数'] * 100).round(1)
print("==== 各场景作为收口触点的成交率 ====")
print(close_rate.sort_values('收口成交率%', ascending=False))


# ===================== Cell 7：结论与策略 =====================
print("""
==== APP内触点归因结论（可落地动作） ====
1. 末次归因看收口：搜索、购物车、推荐流是直接成单场景，重点优化承接效率与库存。
2. 线性归因看种草：社区帖子挂载、车型专区在末次口径下贡献被低估，
   但在线性口径下分得价值，说明它们负责前置种草，不能只看直接成交就砍掉。
3. 口径差值为正的场景 = 被末次低估的种草触点，应保留内容供给；
   口径差值为负的场景 = 主要靠直接收口，资源投入看其收口成交率。
4. 流量坑位分配：高收口成交率场景给直接转化资源；种草场景保留曝光做长期转化铺垫。
""")
