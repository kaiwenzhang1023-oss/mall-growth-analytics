# ======================================================================
# 摩托范 APP 装备商城：交易转化漏斗 + 用户分层 + 转化预测
# ----------------------------------------------------------------------
# 项目整体周期：2022.03 - 2024.12（基建 → 旺季增长 → 淡季抗周期 → 常态化迭代）
# 本脚本阶段：2023.04 - 2023.09【骑行旺季 · 交易转化诊断】
# 数据窗口：2023-04-01 ~ 2023-09-30
# 对应成果（旺季）：月GMV 94.7万→232.4万(+145%)；推荐GMV占比18%→35%；推荐成单率0.8%→1.9%
# 淡季 2023.10-2024.03 侧重：沉睡召回/滞销清仓/会员运营（不在本 Demo）
# 依赖：pip install pandas numpy scikit-learn matplotlib
# ======================================================================

# ===================== Cell 1：导入工具包 + 全局配置 =====================
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score, classification_report
import warnings
warnings.filterwarnings('ignore')

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Zen Hei']
plt.rcParams['axes.unicode_minus'] = False


# ===================== Cell 2：模拟旺季会话行为数据（曝光→点击→加购→下单→支付） =====================
np.random.seed(42)
n = 10000
# 旺季窗口内随机访问日期（2023-04-01 ~ 2023-09-30，共183天）
win_start = pd.Timestamp("2023-04-01")
day_span = (pd.Timestamp("2023-09-30") - win_start).days
visit_date = win_start + pd.to_timedelta(np.random.randint(0, day_span, n), unit='D')

# APP 内场景：推荐流 / 搜索 / 活动位
scene_list = ['推荐流', '搜索', '活动位']
scene = np.random.choice(scene_list, size=n, p=[0.45, 0.35, 0.20])

# 各场景逐级转化率参数（模拟“推荐流优化后转化更高”）
scene_param = {
    '推荐流': dict(ctr=0.18, cart=0.35, order=0.55, pay=0.72),
    '搜索':   dict(ctr=0.30, cart=0.42, order=0.60, pay=0.78),
    '活动位': dict(ctr=0.12, cart=0.22, order=0.45, pay=0.65),
}

# 用户侧特征（先于漏斗生成，支付概率要用）：历史下单次数、窗口内最近消费天数R、浏览时长、车型
hist_orders = np.random.poisson(lam=1.5, size=n)
recency_days = np.random.randint(1, 183, size=n)   # 半年窗口内
browse_dur = np.random.randint(5, 300, size=n)
car_type = np.random.choice(['仿赛', '踏板', '拉力', '巡航'], size=n, p=[0.3, 0.3, 0.2, 0.2])

exposure = np.ones(n, dtype=int)
click = np.zeros(n, dtype=int)
add_cart = np.zeros(n, dtype=int)
order = np.zeros(n, dtype=int)
pay = np.zeros(n, dtype=int)

for i in range(n):
    p = scene_param[scene[i]]
    if np.random.rand() < p['ctr']:                      # 曝光→点击
        click[i] = 1
        adj_cart = (p['cart'] + 0.12 * min(hist_orders[i] / 3, 1)
                    - 0.0008 * recency_days[i] + 0.0003 * browse_dur[i])
        adj_cart = min(max(adj_cart, 0.05), 0.95)
        if np.random.rand() < adj_cart:                  # 点击→加购
            add_cart[i] = 1
            if np.random.rand() < p['order']:            # 加购→下单
                order[i] = 1
                adj_pay = (p['pay'] + 0.20 * min(hist_orders[i] / 3, 1)
                           - 0.0012 * recency_days[i] + 0.0005 * browse_dur[i])
                adj_pay = min(max(adj_pay, 0.05), 0.95)
                if np.random.rand() < adj_pay:          # 下单→支付
                    pay[i] = 1

browse_dur = np.where(click == 1, browse_dur, 0)

df = pd.DataFrame({
    'visit_date': visit_date, 'scene': scene,
    'exposure': exposure, 'click': click, 'add_cart': add_cart,
    'order': order, 'pay': pay,
    'hist_orders': hist_orders, 'recency_days': recency_days,
    'browse_dur': browse_dur, 'car_type': car_type
})
df['month'] = df['visit_date'].dt.month  # 抽取月份，供月度趋势
print("模拟数据规模：", df.shape)
df.head()


# ===================== Cell 3：整体交易漏斗（曝光→点击→加购→下单→支付） =====================
steps = ['exposure', 'click', 'add_cart', 'order', 'pay']
step_name = ['曝光', '点击', '加购', '下单', '支付']
funnel = pd.DataFrame({'环节': step_name, '人数': [df[s].sum() for s in steps]})
funnel['层间转化率'] = (funnel['人数'] / funnel['人数'].shift(1) * 100).round(1)
funnel['整体转化率(vs曝光)'] = (funnel['人数'] / funnel['人数'].iloc[0] * 100).round(2)
print("==== 整体交易漏斗 ====")
print(funnel)

fig, ax = plt.subplots(figsize=(9, 4.5))
y = range(len(step_name))
ax.barh(y, funnel['人数'], color=['#4C78A8', '#72B7B2', '#F58518', '#E45756', '#54A24B'])
ax.set_yticks(list(y)); ax.set_yticklabels(step_name); ax.invert_yaxis()
for i, v in enumerate(funnel['人数']):
    ax.text(v + 80, i, f"{int(v)}人 / 层间{funnel.loc[i,'层间转化率']}%", va='center')
ax.set_title("旺季整体交易转化漏斗"); ax.set_xlabel("会话人数")
plt.tight_layout(); plt.show()


# ===================== Cell 3.5（难度提升）：月度转化趋势 =====================
# 按月看曝光量与支付转化率，观察旺季内的转化走势（区分季节大盘 vs 策略效果）
monthly = df.groupby('month').agg(曝光=('exposure', 'sum'), 支付=('pay', 'sum'))
monthly['支付转化率%'] = (monthly['支付'] / monthly['曝光'] * 100).round(2)
print("==== 月度转化趋势 ====")
print(monthly)

fig, ax1 = plt.subplots(figsize=(9, 4.5))
ax1.bar(monthly.index, monthly['曝光'], color='#4C78A8', alpha=0.6, label='曝光量')
ax1.set_xlabel("月份（2023年4-9月）"); ax1.set_ylabel('曝光量', color='#4C78A8')
ax2 = ax1.twinx()
ax2.plot(monthly.index, monthly['支付转化率%'], 'o-', color='#E45756', label='支付转化率%')
ax2.set_ylabel('支付转化率 %', color='#E45756')
ax1.set_title("旺月度曝光量与支付转化率趋势")
plt.tight_layout(); plt.show()


# ===================== Cell 4：分场景 CTR / 加购率 / CVR 对比 =====================
g = df.groupby('scene').agg(
    曝光=('exposure', 'sum'), 点击=('click', 'sum'),
    加购=('add_cart', 'sum'), 下单=('order', 'sum'), 支付=('pay', 'sum')
)
g['CTR'] = (g['点击'] / g['曝光'] * 100).round(2)
g['加购率'] = (g['加购'] / g['点击'].replace(0, np.nan) * 100).round(2)
g['成单率CVR'] = (g['支付'] / g['点击'].replace(0, np.nan) * 100).round(2)
g['支付转化vs曝光'] = (g['支付'] / g['曝光'] * 100).round(2)
print("==== 分场景转化对比 ====")
print(g[['曝光', 'CTR', '加购率', '成单率CVR', '支付转化vs曝光']])

fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
g[['CTR']].plot(kind='bar', ax=axes[0], legend=False, color='#4C78A8')
axes[0].set_title("分场景 CTR（点击/曝光）"); axes[0].set_ylabel("%")
g[['成单率CVR']].plot(kind='bar', ax=axes[1], legend=False, color='#F58518')
axes[1].set_title("分场景 成单率 CVR（支付/点击）"); axes[1].set_ylabel("%")
plt.tight_layout(); plt.show()


# ===================== Cell 5：RFM 简化分层 + 各层转化差异 =====================
def rfm_simple(row):
    r_hi = row['recency_days'] > 90       # 半年窗口内，超90天没来=沉睡
    f_hi = row['hist_orders'] >= 3
    if not r_hi and f_hi:
        return '高价值活跃用户'
    elif r_hi and f_hi:
        return '高价值沉睡用户'
    elif not r_hi and not f_hi:
        return '新客/低频用户'
    else:
        return '一般流失用户'

df['rfm_group'] = df.apply(rfm_simple, axis=1)
seg = df.groupby('rfm_group').agg(人数=('pay', 'count'), 支付人数=('pay', 'sum'))
seg['支付转化率'] = (seg['支付人数'] / seg['人数'] * 100).round(2)
seg = seg.sort_values('支付转化率', ascending=False)
print("==== 各RFM人群支付转化率 ====")
print(seg)

plt.figure(figsize=(8, 4.5))
plt.bar(seg.index, seg['支付转化率'], color='#54A24B')
plt.title("不同用户分层的支付转化率差异"); plt.ylabel("支付转化率 %")
plt.xticks(rotation=15)
for i, v in enumerate(seg['支付转化率']):
    plt.text(i, v + 0.1, f"{v}%", ha='center')
plt.tight_layout(); plt.show()


# ===================== Cell 6：逻辑回归 转化预测（驱动支付的关键因素） =====================
model_df = pd.get_dummies(df[['scene', 'browse_dur', 'add_cart', 'hist_orders',
                              'recency_days', 'pay']], columns=['scene'], drop_first=True)
X = model_df.drop(columns=['pay']); y = model_df['pay']

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
X_train, X_test, y_train, y_test = train_test_split(
    X_scaled, y, test_size=0.2, random_state=42, stratify=y)

lr = LogisticRegression(max_iter=1000, random_state=42)
lr.fit(X_train, y_train)
y_pred = lr.predict(X_test)
y_prob = lr.predict_proba(X_test)[:, 1]

print("==== 模型效果 ====")
print("Accuracy：", round(accuracy_score(y_test, y_pred), 3))
print("AUC：", round(roc_auc_score(y_test, y_prob), 3))
print(classification_report(y_test, y_pred))

coef = pd.DataFrame({'特征': X.columns, '影响系数': lr.coef_[0]}).set_index('特征')
coef['绝对值'] = coef['影响系数'].abs()
coef = coef.sort_values('绝对值', ascending=True)
plt.figure(figsize=(8, 5))
plt.barh(coef.index, coef['影响系数'],
         color=np.where(coef['影响系数'] >= 0, '#54A24B', '#E45756'))
plt.title("逻辑回归：各特征对“是否支付”的影响（正=促进，负=抑制）")
plt.xlabel("回归系数"); plt.axvline(0, color='gray', lw=0.8)
plt.tight_layout(); plt.show()
print("\n==== 特征影响排序 ====")
print(coef[['影响系数']].sort_values('影响系数', key=abs, ascending=False))


# ===================== Cell 7：结论与策略 =====================
print("""
==== 结论与可落地动作（旺季） ====
1. 漏斗定位瓶颈：对比层间转化率，找到流失最严重环节（本演示为“点击→加购”），优化详情页/价格/评价。
2. 月度趋势：结合大盘曝光看支付转化率走势，剔除季节自然波动，识别策略带来的真实提升。
3. 分场景经营：搜索CVR最高（意图明确）保库存承接；推荐流靠优化分发提升CTR/CVR，是GMV占比提升主力。
4. 用户分层：高价值活跃做会员/复购提醒；高价值沉睡定向召回；新客重点做首单承接。
5. 转化预测：逻辑回归识别驱动支付的关键特征（加购/浏览/历史频次为正，沉睡天数为负），辅助推荐排序打分。
""")
