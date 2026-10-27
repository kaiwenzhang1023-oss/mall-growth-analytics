# ======================================================================
# 摩托范 APP 装备商城：商品 ABC 分层 + 品类/车型供给匹配分析
# ----------------------------------------------------------------------
# 项目整体周期：2022.03 - 2024.12（基建 → 旺季增长 → 淡季抗周期 → 常态化迭代）
# 本脚本阶段：2023.04 - 2023.09【骑行旺季 · 商品供给侧分析】
# 数据窗口：2023-04-01 ~ 2023-09-30
# 方法：ABC帕累托分层(70/20/10) + 品类动销 + 车型-品类匹配度 + 价格带 + 月度动销趋势
# 淡季 2023.10-2024.03 侧重：C类滞销清仓、库存结构优化（不在本 Demo）
# 依赖：pip install pandas numpy matplotlib
# ======================================================================

# ===================== Cell 1：导入工具包 + 全局配置 =====================
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

import warnings
warnings.filterwarnings('ignore')

# 中文字体，防止图里中文方框；列多系统备选
plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Zen Hei']
plt.rcParams['axes.unicode_minus'] = False


# ===================== Cell 2：模拟商品（SKU）数据 =====================
np.random.seed(42)
n_sku = 300  # 模拟300个在售商品

categories = ['头盔', '骑行服', '护具', '三箱改装', '机油耗材', '装饰配件']
car_types = ['仿赛', '踏板', '拉力', '巡航']
price_bands = ['入门', '中端', '高端']

# 每个品类的单价区间（元），用于生成价格带
price_range = {
    '头盔':   (200, 3500),
    '骑行服': (300, 2500),
    '护具':   (80, 1200),
    '三箱改装': (500, 6000),
    '机油耗材': (30, 400),
    '装饰配件': (10, 500),
}

rows = []
for sku in range(n_sku):
    cat = np.random.choice(categories)
    car = np.random.choice(car_types)
    band = np.random.choice(price_bands, p=[0.4, 0.4, 0.2])

    # 单价：按价格带在品类区间内取值
    lo, hi = price_range[cat]
    if band == '入门':
        price = np.random.uniform(lo, lo + (hi - lo) * 0.33)
    elif band == '中端':
        price = np.random.uniform(lo + (hi - lo) * 0.33, lo + (hi - lo) * 0.66)
    else:
        price = np.random.uniform(lo + (hi - lo) * 0.66, hi)

    # 制造帕累托：少数商品权重高，贡献大部分销量/销售额
    weight = np.random.pareto(a=1.5) + 0.1
    exposure = np.random.randint(50, 5000)                       # 曝光量
    orders = max(0, int(weight * np.random.uniform(1, 8)))        # 成交订单数
    returns = int(orders * np.random.uniform(0, 0.12))          # 退货数（0~12%）
    gmv = price * orders                                        # 该商品销售额
    month = np.random.randint(4, 10)                             # 主销月份（旺季4-9月）

    rows.append({
        'sku_id': f'SKU{sku:04d}',
        'category': cat,
        'car_type': car,
        'price_band': band,
        'price': round(price, 1),
        'exposure': exposure,
        'orders': orders,
        'returns': returns,
        'gmv': round(gmv, 1),
        'month': month,
    })

df = pd.DataFrame(rows)
# 衍生指标：点击率CTR用曝光占位（本脚本聚焦商品供给，CTR可后续接点击数据）；退货率
df['return_rate'] = (df['returns'] / df['orders'].replace(0, np.nan)).fillna(0)
print("商品数据规模：", df.shape)
df.head()


# ===================== Cell 3：ABC 分层（帕累托 70/20/10） =====================
# 步骤：按销售额降序 → 算累计销售额占比 → 按阈值划分 A/B/C
# A类：累计占比 ≤70%（爆款，重点保供保流量）
# B类：70%~90%（潜力款，重点培育）
# C类：>90%（长尾滞销，控制流量、考虑清仓）

abc = df.sort_values('gmv', ascending=False).reset_index(drop=True)
abc['gmv_cum'] = abc['gmv'].cumsum()                 # 累计销售额
abc['gmv_cum_pct'] = abc['gmv_cum'] / abc['gmv'].sum() * 100  # 累计占比%

def abc_class(pct):
    if pct <= 70:
        return 'A类(爆款)'
    elif pct <= 90:
        return 'B类(潜力款)'
    else:
        return 'C类(长尾)'

abc['abc'] = abc['gmv_cum_pct'].apply(abc_class)

# 各类汇总：SKU数占比、GMV占比
abc_summary = abc.groupby('abc').agg(
    SKU数=('sku_id', 'count'),
    GMV=('gmv', 'sum'),
    销量=('orders', 'sum')
)
abc_summary['SKU占比%'] = (abc_summary['SKU数'] / len(abc) * 100).round(1)
abc_summary['GMV占比%'] = (abc_summary['GMV'] / abc['gmv'].sum() * 100).round(1)
print("==== ABC 分层汇总 ====")
print(abc_summary[['SKU数', 'SKU占比%', 'GMV', 'GMV占比%', '销量']])

# 帕累托图：柱状=各SKU销售额（按排名），折线=累计占比
plt.figure(figsize=(11, 5))
plt.bar(range(len(abc)), abc['gmv'], color='#4C78A8')
plt.plot(range(len(abc)), abc['gmv_cum_pct'], color='#E45756', lw=2)
# 标出70%、90%分界线
plt.axhline(70, color='gray', ls='--', lw=0.8)
plt.axhline(90, color='gray', ls='--', lw=0.8)
plt.title("商品销售额帕累托图（ABC分层）")
plt.xlabel("商品（按销售额降序排名）")
plt.ylabel("销售额 / 累计占比%")
plt.tight_layout()
plt.show()


# ===================== Cell 3.5（难度提升）：月度动销趋势 =====================
# 按主销月份看 GMV 与动销 SKU 数，观察旺季各月商品供给消化情况
monthly = df.groupby('month').agg(
    GMV=('gmv', 'sum'),
    在售SKU=('sku_id', 'count'),
    动销SKU=('orders', lambda s: (s > 0).sum())
)
monthly['动销率%'] = (monthly['动销SKU'] / monthly['在售SKU'] * 100).round(1)
print("==== 月度动销趋势（4-9月） ====")
print(monthly)

fig, ax1 = plt.subplots(figsize=(9, 4.5))
ax1.bar(monthly.index, monthly['GMV'], color='#4C78A8', alpha=0.7, label='GMV')
ax1.set_xlabel('月份'); ax1.set_ylabel('GMV（元）', color='#4C78A8')
ax2 = ax1.twinx()
ax2.plot(monthly.index, monthly['动销率%'], 'o-', color='#E45756', label='动销率%')
ax2.set_ylabel('动销率 %', color='#E45756')
ax1.set_title('旺月度 GMV 与动销率趋势')
plt.tight_layout(); plt.show()


# ===================== Cell 4：品类动销分析（GMV / 动销 / 退货） =====================
# 动销率 = 有成交的SKU数 / 该品类SKU总数；退货率 = 退货/成交
cat_stat = df.groupby('category').agg(
    SKU数=('sku_id', 'count'),
    有成交SKU=('orders', lambda s: (s > 0).sum()),
    GMV=('gmv', 'sum'),
    销量=('orders', 'sum'),
    退货=('returns', 'sum')
)
cat_stat['动销率%'] = (cat_stat['有成交SKU'] / cat_stat['SKU数'] * 100).round(1)
cat_stat['退货率%'] = (cat_stat['退货'] / cat_stat['销量'].replace(0, np.nan) * 100).round(1)
cat_stat['GMV占比%'] = (cat_stat['GMV'] / cat_stat['GMV'].sum() * 100).round(1)
cat_stat = cat_stat.sort_values('GMV', ascending=False)
print("==== 品类动销分析 ====")
print(cat_stat[['SKU数', 'GMV', 'GMV占比%', '动销率%', '退货率%']])

# 双轴图：柱状=品类GMV，折线=退货率
fig, ax1 = plt.subplots(figsize=(10, 5))
ax1.bar(cat_stat.index, cat_stat['GMV'], color='#72B7B2', label='GMV')
ax1.set_ylabel('GMV（元）')
ax2 = ax1.twinx()
ax2.plot(cat_stat.index, cat_stat['退货率%'], 'o-', color='#E45756', label='退货率%')
ax2.set_ylabel('退货率 %')
ax1.set_title("各品类 GMV 与退货率对比")
plt.tight_layout()
plt.show()


# ===================== Cell 5：车型 × 品类 供给匹配度 =====================
# 思路：先有“平台用户车型分布”（需求侧），再看“各品类成交在车型上的分布”（供给侧），
# 两者差异大 = 供给与需求错配，识别“用户多但对应品类供给/成交少”的缺口。

# 需求侧：平台各车型用户占比（模拟，可换成真实用户画像）
user_car_share = pd.Series({'仿赛': 0.30, '踏板': 0.30, '拉力': 0.20, '巡航': 0.20})

# 供给侧：每个品类内，各车型适配商品的成交占比
cross = pd.pivot_table(df, values='orders', index='category', columns='car_type',
                       aggfunc='sum', fill_value=0)
cross_pct = cross.div(cross.sum(axis=1), axis=0) * 100  # 行内归一化为%

print("==== 各品类成交的车型分布（%） ====")
print(cross_pct.round(1))

# 匹配度：以“需求侧用户车型分布”为基准，对比每个品类的成交车型分布，找偏差
# 正=该品类里这个车型供给/成交偏多，负=相对用户需求供给不足（缺口）
need_car = user_car_share * 100
gap = (cross_pct - need_car).round(1)
print("\n==== 车型-品类匹配偏差（%，负=相对用户需求供给不足/缺口） ====")
print(gap)

# 热力图展示偏差：红色=供给偏多，蓝色=供给不足
plt.figure(figsize=(8, 4.5))
plt.imshow(gap.values, cmap='RdBu_r', aspect='auto', vmin=-15, vmax=15)
plt.colorbar(label='匹配偏差%（负=供给缺口）')
plt.xticks(range(len(gap.columns)), gap.columns)
plt.yticks(range(len(gap.index)), gap.index)
for i in range(gap.shape[0]):
    for j in range(gap.shape[1]):
        plt.text(j, i, f"{gap.values[i, j]:.0f}", ha='center', va='center', color='black')
plt.title("车型 × 品类 供给匹配偏差热力图")
plt.tight_layout()
plt.show()


# ===================== Cell 6：价格带分析 =====================
band_stat = df.groupby('price_band').agg(
    SKU数=('sku_id', 'count'),
    GMV=('gmv', 'sum'),
    销量=('orders', 'sum')
)
band_stat['GMV占比%'] = (band_stat['GMV'] / band_stat['GMV'].sum() * 100).round(1)
band_stat['SKU占比%'] = (band_stat['SKU数'] / len(df) * 100).round(1)
print("==== 价格带分析 ====")
print(band_stat[['SKU数', 'SKU占比%', 'GMV', 'GMV占比%']])

band_stat[['SKU占比%', 'GMV占比%']].plot(kind='bar', figsize=(8, 4.5), color=['#4C78A8', '#F58518'])
plt.title("价格带：SKU占比 vs GMV占比")
plt.ylabel('%')
plt.xticks(rotation=0)
plt.tight_layout()
plt.show()


# ===================== Cell 7：结论与策略 =====================
print("""
==== 商品侧分析结论（可落地动作） ====
1. ABC分层：A类爆款贡献约70%GMV，优先保障库存、流量与供货稳定性；
   B类潜力款做重点培育（优化详情页、测试推广）；C类长尾控制流量、定期清仓。
2. 品类动销：关注“低动销率+高退货率”品类，排查是选品、描述不符还是品控问题。
3. 车型-品类匹配：偏差为负的格子=用户需求大但供给不足的缺口，优先补对应车型适配商品。
4. 价格带：若某价格带SKU占比高但GMV占比低，说明该带商品低效，需优化结构。
""")
