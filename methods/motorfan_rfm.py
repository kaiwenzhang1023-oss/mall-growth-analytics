# ======================================================================
# 摩托范 APP 装备商城：RFM 规则分层 + K-Means 聚类 用户分群
# ----------------------------------------------------------------------
# 项目整体周期：2022.03 - 2024.12（基建 → 旺季增长 → 淡季抗周期 → 常态化迭代）
# 本脚本阶段：2023.04 - 2023.09【骑行旺季 · 用户分群】
# 数据窗口：2023-04-01 ~ 2023-09-30，基准日 2023-09-30（半年截面快照）
# 淡季 2023.10 - 2024.03 侧重：沉睡用户召回 / 滞销清仓 / 会员运营（不在本 Demo）
# 依赖：pip install pandas numpy scikit-learn matplotlib
# ======================================================================

# ============================ Cell 1：导入工具包 + 全局配置 ============================
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import warnings
warnings.filterwarnings('ignore')

# 中文字体，防止图里中文方框；列多系统备选
plt.rcParams['font.sans-serif'] = ['SimHei', 'PingFang SC', 'WenQuanYi Zen Hei', 'Microsoft YaHei']
plt.rcParams['axes.unicode_minus'] = False


# ============================ Cell 2：旺季大盘月度趋势（难度提升：先看季节大盘） ============================
# RFM 是截面快照，但先看旺季 4-9 月大盘爬坡，理解业务季节节奏（面试可讲“区分季节性自然波动”）
np.random.seed(42)
months = ['4月', '5月', '6月', '7月', '8月', '9月']
# 模拟旺季逐月订单量与GMV（爬坡后高位平稳，叠加小幅随机波动）
base_orders = [3200, 4100, 4800, 5200, 5000, 4600]
month_orders = [int(x * np.random.uniform(0.95, 1.05)) for x in base_orders]
month_gmv = [x * np.random.uniform(260, 300) for x in month_orders]

fig, ax1 = plt.subplots(figsize=(9, 4.5))
ax1.bar(months, month_orders, color='#4C78A8', alpha=0.7, label='订单量')
ax1.set_ylabel('订单量', color='#4C78A8')
ax2 = ax1.twinx()
ax2.plot(months, month_gmv, 'o-', color='#E45756', label='GMV')
ax2.set_ylabel('GMV（元）', color='#E45756')
ax1.set_title('2023 旺季（4-9月）大盘订单量与 GMV 趋势')
plt.tight_layout()
plt.show()


# ============================ Cell 3：生成窗口内骑手 RFM 数据（基准日 2023-09-30） ============================
np.random.seed(42)
n_user = 1200
base_date = pd.to_datetime("2023-09-30")   # 基准日（窗口最后一天）
win_start = pd.to_datetime("2023-04-01")   # 窗口起点，仅口径说明

user_list = []
for uid in range(n_user):
    # 5 类骑手；R 全部落在 183 天窗口内（窗口内早期来过、近期没回=沉睡，不跨窗口）
    r_type = np.random.choice([0, 1, 2, 3, 4], p=[0.15, 0.18, 0.25, 0.27, 0.15])

    if r_type == 0:
        # 0=硬核高价值玩家：近期刚买(R小)、买得多(F高)、花得多(M高)
        last_delta = np.random.randint(0, 20)
        order_cnt = np.random.randint(4, 9)
        amt = np.random.randint(2500, 12000)
    elif r_type == 1:
        # 1=窗口内早期来过的沉睡改装大佬：R大(120-180天前)、曾高频、高金额，待召回
        last_delta = np.random.randint(120, 180)
        order_cnt = np.random.randint(3, 7)
        amt = np.random.randint(2000, 9000)
    elif r_type == 2:
        # 2=潜力耗材玩家：中等活跃(R30-110)、频次中等、只买机油小配件(M偏低)
        last_delta = np.random.randint(30, 110)
        order_cnt = np.random.randint(2, 5)
        amt = np.random.randint(200, 1800)
    elif r_type == 3:
        # 3=新车入坑新手：近期刚买(R小)、只买1单(F=1)、一次性中等金额买全套
        last_delta = np.random.randint(0, 45)
        order_cnt = 1
        amt = np.random.randint(800, 4500)
    else:
        # 4=低效沉睡用户：窗口早期来过(R120-180)、只1单、金额很低
        last_delta = np.random.randint(120, 180)
        order_cnt = 1
        amt = np.random.randint(50, 600)

    last_pay = base_date - pd.Timedelta(days=last_delta)
    user_list.append({
        "user_id": uid,
        "last_pay_time": last_pay,
        "F": order_cnt,
        "M": amt,
        "R": last_delta
    })

df_rfm = pd.DataFrame(user_list)
df_rfm.to_csv("motorfan_rfm_data.csv", index=False, encoding="utf-8-sig")
print("✅ 窗口内 RFM 数据生成完成（2023-04-01 ~ 2023-09-30）")
df_rfm.head()


# ============================ Cell 4：RFM 打分 + 规则分群（阈值按半年窗口适配） ============================
# R 打分：半年窗口，R 越小（越近买过）分越高
def r_score(x):
    if x <= 15:
        return 5
    elif x <= 30:
        return 4
    elif x <= 60:
        return 3
    elif x <= 120:
        return 2
    else:
        return 1

# F 打分：装备低频，阈值刻意比快消低
def f_score(x):
    if x >= 5:
        return 5
    elif x >= 3:
        return 4
    elif x >= 2:
        return 3
    else:
        return 1

# M 按分位数动态切 5 档，不写死金额
m_bins = df_rfm["M"].quantile([0, 0.2, 0.4, 0.6, 0.8, 1]).values
def m_score(x):
    if x >= m_bins[4]:
        return 5
    elif x >= m_bins[3]:
        return 4
    elif x >= m_bins[2]:
        return 3
    elif x >= m_bins[1]:
        return 2
    else:
        return 1

df_rfm['R_score'] = df_rfm['R'].apply(r_score)
df_rfm['F_score'] = df_rfm['F'].apply(f_score)
df_rfm['M_score'] = df_rfm['M'].apply(m_score)

# 8 类经典 RFM 人群映射
def rfm_label(r, f, m):
    if r >= 4 and f >= 4 and m >= 4:
        return "重要价值骑手"
    elif r >= 4 and f <= 2 and m >= 4:
        return "重要深耕骑手"
    elif r <= 2 and f >= 4 and m >= 4:
        return "重要挽留骑手"
    elif r <= 2 and f <= 2 and m >= 4:
        return "重要唤回骑手"
    elif r >= 4 and f >= 4 and m <= 2:
        return "潜力骑手"
    elif r >= 4 and f <= 2 and m <= 2:
        return "新手骑手"
    elif r <= 2 and f >= 4 and m <= 2:
        return "一般维持骑手"
    else:
        return "沉睡低价值骑手"

df_rfm['rfm_group'] = df_rfm.apply(
    lambda row: rfm_label(row['R_score'], row['F_score'], row['M_score']), axis=1
)
print("\n✅ RFM 规则分群完成，人群分布：")
print(df_rfm['rfm_group'].value_counts())


# ============================ Cell 5：K-Means 聚类 + 选 K（肘部图/轮廓系数） ============================
features = ["R", "F", "M"]
X = df_rfm[features].copy()

# 标准化：M 几千上万、R 上百天，量纲差大，不标准化会被金额主导
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

sse, sil_scores = [], []
k_range = range(2, 8)
for k in k_range:
    km = KMeans(n_clusters=k, random_state=42, n_init='auto')
    labels = km.fit_predict(X_scaled)
    sse.append(km.inertia_)
    sil_scores.append(silhouette_score(X_scaled, labels))

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
ax1.plot(k_range, sse, marker='o')
ax1.set_title("肘部法则 SSE-K（找拐点）"); ax1.set_xlabel("K"); ax1.set_ylabel("SSE")
ax2.plot(k_range, sil_scores, marker='o', c='orange')
ax2.set_title("轮廓系数（越接近1越好）"); ax2.set_xlabel("K"); ax2.set_ylabel("轮廓系数")
plt.tight_layout(); plt.show()


# ============================ Cell 6：K=5 聚类、自动画像命名、散点图、导出 ============================
k_best = 5
km_model = KMeans(n_clusters=k_best, random_state=42, n_init='auto')
df_rfm['cluster'] = km_model.fit_predict(X_scaled)

cluster_profile = df_rfm.groupby("cluster")[features].agg(["mean", "count"])
print("\n✅ K-Means 聚类画像（先看均值再命名）：")
print(cluster_profile)

# 关键坑：cluster 编号乱序，按每簇均值+全局中位数自动命名，不写死
r_med = df_rfm["R"].median(); f_med = df_rfm["F"].median(); m_med = df_rfm["M"].median()
def auto_name(r_m, f_m, m_m):
    r_hi, f_hi, m_hi = r_m > r_med, f_m > f_med, m_m > m_med
    if not r_hi and f_hi and m_hi:
        return "硬核高价值玩家"
    elif r_hi and f_hi and m_hi:
        return "沉睡改装大佬(待召回)"
    elif not r_hi and not f_hi and m_hi:
        return "新车入坑新手"
    elif r_hi and not f_hi and not m_hi:
        return "低效沉睡用户"
    else:
        return "潜力耗材玩家"

name_map = {}
for c, g in df_rfm.groupby("cluster"):
    name_map[c] = auto_name(g["R"].mean(), g["F"].mean(), g["M"].mean())
df_rfm['cluster_name'] = df_rfm['cluster'].map(name_map)
print("\n✅ K-Means 人群分布：")
print(df_rfm['cluster_name'].value_counts())

# R-M 散点图
plt.figure(figsize=(10, 6))
colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"]
for idx, (c, name) in enumerate(name_map.items()):
    sub = df_rfm[df_rfm['cluster'] == c]
    plt.scatter(sub['R'], sub['M'], label=name, alpha=0.6, s=30, c=colors[idx])
plt.xlabel("R 最近消费天数（窗口内，越大越久没来）")
plt.ylabel("M 窗口累计消费金额（元）")
plt.title("旺季骑手 K-Means 聚类 R-M 散点图")
plt.legend(); plt.grid(alpha=0.3)
plt.tight_layout(); plt.show()

df_rfm.to_csv("motorfan_rfm_result.csv", index=False, encoding="utf-8-sig")
print("\n✅ 完成！结果 motorfan_rfm_result.csv")
