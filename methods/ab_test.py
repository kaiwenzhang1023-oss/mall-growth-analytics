# ======================================================================
# 摩托范 APP 装备商城：A/B 实验验证（推荐策略上线的科学检验）
# ----------------------------------------------------------------------
# 项目整体周期：2022.03 - 2024.12（基建 → 旺季增长 → 淡季抗周期 → 常态化迭代）
# 本脚本阶段：2023.04 - 2023.09【骑行旺季 · 推荐策略 A/B 实验】
# 实验对象：新版推荐流策略(实验组) vs 老推荐策略(对照组)，用户层随机分流
# 核心指标：成交转化率CVR、人均GMV；护栏指标：退款率（防止牺牲体验换转化）
# 检验方法：卡方检验(转化率/比例) + 独立样本t检验(人均GMV/连续值)
# 说明：内置模拟数据，无需外部文件；依赖 pip install pandas numpy scipy matplotlib
# ======================================================================

# ===================== Cell 1：导入依赖 + 全局配置 =====================
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy.stats import chi2_contingency, ttest_ind
import warnings
warnings.filterwarnings('ignore')

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'PingFang SC', 'WenQuanYi Zen Hei']
plt.rcParams['axes.unicode_minus'] = False
ALPHA = 0.05  # 显著性水平 p<0.05 视为统计显著


# ===================== Cell 2：模拟 A/B 实验数据（用户层随机分流） =====================
np.random.seed(42)
n_ctrl, n_test = 8000, 8000  # 对照组、实验组用户量（用户层分流，一人只进一组）

# 对照组：老推荐策略，成交概率 0.8%（对应简历优化前推荐成单率）
ctrl_pay = np.random.choice([0, 1], size=n_ctrl, p=[0.992, 0.008])
# 实验组：新推荐策略，成交概率 1.9%（对应简历优化后推荐成单率）
test_pay = np.random.choice([0, 1], size=n_test, p=[0.981, 0.019])

# 成交用户生成订单金额，未成交金额为0
ctrl_amt = np.where(ctrl_pay == 1, np.random.normal(280, 120, n_ctrl), 0)
test_amt = np.where(test_pay == 1, np.random.normal(310, 130, n_test), 0)

df_ctrl = pd.DataFrame({'user_id': [f'c{i}' for i in range(n_ctrl)],
                        'group': 'control', 'is_pay': ctrl_pay, 'pay_amount': ctrl_amt.round(2)})
df_test = pd.DataFrame({'user_id': [f't{i}' for i in range(n_test)],
                        'group': 'test', 'is_pay': test_pay, 'pay_amount': test_amt.round(2)})
df_ab = pd.concat([df_ctrl, df_test], ignore_index=True)

print("==== A/B 实验数据预览 ====")
print(df_ab.head())
print(f"\n对照组人数：{n_ctrl}，实验组人数：{n_test}")


# ===================== Cell 3：基础指标汇总（CVR、人均GMV、提升幅度） =====================
ab = df_ab.groupby('group').agg(
    user_count=('user_id', 'count'),
    pay_user=('is_pay', 'sum'),
    total_gmv=('pay_amount', 'sum')
)
ab['cvr'] = ab['pay_user'] / ab['user_count']                 # 成交转化率
ab['avg_gmv'] = ab['total_gmv'] / ab['user_count']            # 人均GMV
print("==== 实验指标汇总 ====")
print(ab.round(4))

cvr_c = ab.loc['control', 'cvr']; cvr_t = ab.loc['test', 'cvr']
gmv_c = ab.loc['control', 'total_gmv']; gmv_t = ab.loc['test', 'total_gmv']
print(f"\nCVR 提升：{(cvr_t-cvr_c)/cvr_c:.2%}")
print(f"GMV 提升：{(gmv_t-gmv_c)/gmv_c:.2%}")


# ===================== Cell 4：卡方检验（转化率是否显著，比例指标） =====================
# 列联表 [未成交, 成交]；H0：两组转化率无差异（策略无效）
ctrl_nopay = int(ab.loc['control', 'user_count'] - ab.loc['control', 'pay_user'])
test_nopay = int(ab.loc['test', 'user_count'] - ab.loc['test', 'pay_user'])
table = [[ctrl_nopay, int(ab.loc['control', 'pay_user'])],
         [test_nopay, int(ab.loc['test', 'pay_user'])]]

chi2, p_chi, dof, expected = chi2_contingency(table)
print("\n==== 卡方检验（CVR 显著性） ====")
print(f"卡方统计量={chi2:.4f}，p值={p_chi:.4f}")
if p_chi < ALPHA:
    print(f"结论：p<{ALPHA}，CVR 差异【统计显著】，新策略正向有效")
else:
    print(f"结论：p>={ALPHA}，CVR 差异不显著，上涨可能是随机波动，不建议全量")


# ===================== Cell 5：独立样本 t 检验（人均GMV，连续值指标） =====================
c_amt = df_ab[df_ab['group'] == 'control']['pay_amount'].values
t_amt = df_ab[df_ab['group'] == 'test']['pay_amount'].values
t_stat, p_t = ttest_ind(t_amt, c_amt)
print("\n==== t 检验（人均GMV 显著性） ====")
print(f"T统计量={t_stat:.4f}，p值={p_t:.4f}")
print("结论：" + ("人均GMV 差异【统计显著】" if p_t < ALPHA else "人均GMV 差异不显著"))


# ===================== Cell 6：可视化对比 CVR 与人均GMV =====================
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
ax1.bar(['control', 'test'], [cvr_c, cvr_t], color=['#6688bb', '#ee7744'])
ax1.set_title("对照组 vs 实验组：成交转化率CVR"); ax1.set_ylabel("CVR")
for i, v in enumerate([cvr_c, cvr_t]):
    ax1.text(i, v + 0.0002, f"{v:.2%}", ha='center')

ax2.bar(['control', 'test'], [ab.loc['control', 'avg_gmv'], ab.loc['test', 'avg_gmv']],
        color=['#6688bb', '#ee7744'])
ax2.set_title("对照组 vs 实验组：人均GMV"); ax2.set_ylabel("人均GMV（元）")
for i, v in enumerate([ab.loc['control', 'avg_gmv'], ab.loc['test', 'avg_gmv']]):
    ax2.text(i, v + 2, f"{v:.1f}", ha='center')
plt.tight_layout(); plt.show()


# ===================== Cell 7：护栏指标（退款率）+ 最终决策 =====================
np.random.seed(7)
# 模拟成交用户退款：对照组4%，实验组5%（轻微上涨，需判断是否在容忍线内）
ctrl_ref = np.random.choice([0, 1], size=int(ab.loc['control', 'pay_user']), p=[0.96, 0.04])
test_ref = np.random.choice([0, 1], size=int(ab.loc['test', 'pay_user']), p=[0.95, 0.05])
ref_c, ref_t = ctrl_ref.mean(), test_ref.mean()
print("==== 护栏指标：退款率 ====")
print(f"对照组 {ref_c:.2%}，实验组 {ref_t:.2%}")

print("\n==== 实验最终决策 ====")
if p_chi < ALPHA and p_t < ALPHA and ref_t <= ref_c + 0.015:
    print("✅ 核心指标显著正向、护栏风险可控 → 全量上线，纳入常态化推荐")
elif p_chi >= ALPHA:
    print("⚠️ CVR 提升不显著 → 不全量，迭代召回规则后重新开实验")
else:
    print("❌ 转化显著但退款涨幅超标 → 有副作用，回滚并优化商品承接")


# ===================== Cell 8：样本量简易估算（上线前预估，手写两比例公式） =====================
def sample_size_p2(p0, p1, alpha=0.05, power=0.8):
    # 两比例检验每组所需样本量；z_alpha/2=1.96，z_beta=0.84
    za, zb = 1.96, 0.84
    n = ((za + zb) ** 2 * (p0 * (1 - p0) + p1 * (1 - p1))) / (p1 - p0) ** 2
    return int(np.ceil(n))

# 基准CVR 0.8%，目标1.9%
need = sample_size_p2(0.008, 0.019)
print("\n==== 样本量预估 ====")
print(f"基准CVR 0.8% → 目标1.9%，每组至少需 {need} 样本（不足则检验不出显著性）")
