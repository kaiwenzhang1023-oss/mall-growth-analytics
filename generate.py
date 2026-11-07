"""Generate the reproducible, synthetic 24-month mall case."""
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
import json
import random

ROOT = Path(__file__).parent
R = random.Random(20261107)
CATS = ['头盔','骑行服','骑行靴','手套','护具','电子设备','配件耗材']
CARS = ['踏板','复古','巡航','仿赛','拉力','电动摩托']
# Relative demand by category. Zero means the demo assortment has no such pairing.
FIT = [
    [29, 9, 0, 18, 8, 12, 24],
    [23, 21, 12, 15, 8, 0, 21],
    [24, 19, 16, 12, 0, 13, 16],
    [23, 24, 16, 10, 18, 9, 0],
    [18, 20, 17, 10, 19, 7, 9],
    [32, 0, 0, 18, 8, 14, 28],
]
APPAREL = {1, 2}
SCENES = ['首页推荐流','商城搜索','活动入口','车型专区','购物车推荐','社区挂载']
# October pre-sale and November promotions lift the off-season.
# June promotions and the summer rebound have different strengths by year.
SEASONS = [
    ('2022-10',[581,677,514,372,313,459],365000,5847,601,930,[24,87,139,174],112000,990,140),
    ('2023-04',[752,901,1158,986,1065,820],600000,12174,1198,1200,[35,142,219,267],240000,1920,180),
    ('2023-10',[1116,1285,1018,703,602,741],532000,10083,985,1510,[37,123,236,332],160000,2304,230),
    ('2024-04',[1936,2229,2867,2143,2471,2298],960000,24631,2321,2400,[103,381,561,679],360000,6840,350),
]

# Relative weights within each season. Each row is visits, paid orders, refund risk,
# and apparel mix. Seasonal budgets still control totals; event months may differ.
CAMPAIGNS = {
    '2022-10': (115, 96, 105, 110),
    '2022-11': (120, 112, 118, 135),
    '2022-12': (108, 105, 108, 113),
    '2023-06': (122, 111, 117, 134),
    '2023-07': (94, 99, 98, 100),
    '2023-10': (115, 97, 104, 107),
    '2023-11': (111, 119, 103, 83),
    '2023-12': (108, 103, 113, 121),
    '2024-06': (120, 125, 110, 114),
    '2024-07': (96, 98, 97, 100),
}

def month_at(start, offset):
    year, month = map(int, start.split('-'))
    month += offset - 1
    return date(year+month//12, month%12+1, 1)

def allocate(total, weights):
    weight_sum = sum(weights)
    result = [total*w//weight_sum for w in weights]
    order = sorted(range(len(weights)),key=lambda i: total*weights[i]%weight_sum,reverse=True)
    for i in order[:total-sum(result)]:
        result[i] += 1
    return result

def day_in(month):
    end = month_at(month.strftime('%Y-%m'),1)
    return month + timedelta(days=R.randrange((end-month).days))

def main():
    months_data = {}
    history = [[f'H{i:05}',str(date(2022,3,1)+timedelta(days=R.randrange(214)))]
               for i in range(18000)]
    by_month = defaultdict(list)
    past_buyers = [(user,date.fromisoformat(d)) for user,d in history]
    eligible = {}
    checks = []
    for start, gmvs, visits, paid, refunds, size, repeat, rec_visits, rec_paid, rec_share in SEASONS:
        months = [month_at(start,i) for i in range(6)]
        month_keys = [str(m)[:7] for m in months]
        profiles = [CAMPAIGNS.get(key,(100,100,100,100)) for key in month_keys]
        v = allocate(visits,[x*profile[0]*R.randint(97,103) for x,profile in zip(gmvs,profiles)])
        p = allocate(paid,[x*profile[1]*R.randint(97,103) for x,profile in zip(gmvs,profiles)])
        f = allocate(refunds,[x*profile[2]*R.randint(98,102) for x,profile in zip(p,profiles)])
        rv = allocate(rec_visits,[x*R.randint(94,106) for x in v])
        rp = allocate(rec_paid,[x*R.randint(92,108) for x in rv])
        share = [rec_share + delta for delta in [-23,-8,4,14,21,-8]]
        assert sum(share)==6*rec_share
        anchors = {}
        follow = [0, *repeat]
        for i in range(size):
            user=f'N{start}{i:05}'
            first = day_in(months[i%3])
            anchors[user] = str(first)
            by_month[str(first)[:7]].append((user,first))
            for j, (lo, hi) in enumerate([(1,7),(8,30),(31,60),(61,90)]):
                if follow[j] <= i < follow[j+1]:
                    later = first + timedelta(days=R.randint(lo,hi))
                    by_month[str(later)[:7]].append((user,later))
                    break
        eligible[start] = anchors
        past_buyers.extend((user,date.fromisoformat(d)) for user,d in anchors.items())
        checks.append({'start':start,'months':month_keys,'visits':visits,'paid':paid,
                       'refunds':refunds,'cohort':size,'repeat':repeat,
                       'recommendation_visits':rec_visits,'recommendation_paid':rec_paid,
                       'recommendation_monthly_share_mean':rec_share/1000})
        for i, m in enumerate(months):
            key = month_keys[i]
            planned = by_month[key]
            assert len(planned) <= p[i], (key,len(planned),p[i])
            if i >= 3:
                new_buyers = (p[i]-len(planned))//4
                for j in range(new_buyers):
                    user, first = f'L{key}{j:05}',day_in(m)
                    planned.append((user,first))
                    past_buyers.append((user,first))
                    if j % 7 == 0 and (later:=first+timedelta(days=30)) < date(2024,10,1):
                        by_month[str(later)[:7]].append((user,later))
            established = [u for u,d in past_buyers if (m-d).days > 90]
            while len(planned) < p[i]:
                planned.append((R.choice(established),day_in(m)))
            R.shuffle(planned)
            rec = rp[i]
            assert rec <= rv[i] < v[i] and p[i]-rec < v[i]-rv[i]
            visits_by_scene = [rv[i],*allocate(v[i]-rv[i],[31,21,19,17,12])]
            paid_by_scene = [rec,*allocate(p[i]-rec,[34,20,19,17,10])]
            gmv = gmvs[i]*100000
            rgmv = gmv*share[i]//1000
            cents_by_scene = [rgmv,*allocate(gmv-rgmv,paid_by_scene[1:])]
            pairs = [(car, cat) for car, mix in enumerate(FIT) for cat, weight in enumerate(mix) if weight]
            demand = [FIT[car][cat]*(profiles[i][3] if cat in APPAREL else 100) for car, cat in pairs]
            orders=[]
            visit_buckets=[]
            for scene, nvisits, npaid, cents in zip(range(len(SCENES)),visits_by_scene,paid_by_scene,cents_by_scene):
                assert nvisits >= npaid
                prior=sum(paid_by_scene[:scene])
                people=planned[prior:prior+npaid]
                weights=[R.randint(65,165) for _ in people]
                amounts=allocate(cents,weights)
                for (user,dt),amount in zip(people,amounts):
                    car,cat=R.choices(pairs,demand)[0]
                    sku=cat*30+R.choices(range(30),[31-j for j in range(30)])[0]
                    touches = [R.randrange(len(SCENES)) for _ in range(R.choices([0,1,2],[40,43,17])[0])]
                    orders.append([user,str(dt),scene,car,cat,sku,amount,0,0,0,0,[*touches,scene]])
                n = nvisits-npaid
                unpaid_order = min(n,round(npaid*R.uniform(.26,.48)))
                cart_only = round((n-unpaid_order)*R.uniform(.037,.051))
                click_only = round((n-unpaid_order-cart_only)*R.uniform(.12,.19))
                stages=[n-unpaid_order-cart_only-click_only,click_only,cart_only,unpaid_order]
                for stage, count in enumerate(stages):
                    dist=allocate(count,[weight*R.randint(85,115) for weight in demand])
                    for (car,cat),q in zip(pairs,dist):
                        if q: visit_buckets.append([scene,car,cat,stage,q,q*R.choice([3,4,5,6])])
            # Weighted selection assigns higher return propensity to apparel.
            by_propensity = sorted(range(len(orders)),
                key=lambda j:R.random()**(1/(3.2 if orders[j][4] in APPAREL else 1.0)),reverse=True)
            for j in by_propensity[:f[i]]:
                o=orders[j]
                o[7]=R.choices([1,2,3],[18,10,72] if o[4] in APPAREL else [38,17,45])[0]
            for o in orders:
                dt=date.fromisoformat(o[1])
                if o[7]!=1: o[8]=str(dt+timedelta(days=R.randint(0,3)))
                if o[7]: o[9]=str(dt+timedelta(days=R.randint(4,24) if o[7]>1 else R.randint(0,3)))
                if o[7]==3: o[10]=str(date.fromisoformat(o[9])-timedelta(days=1))
            assert len(orders)==p[i]
            assert sum(o[6] for o in orders)==gmv
            assert sum(o[7]>0 for o in orders)==f[i]
            assert sum(b[4] for b in visit_buckets)+len(orders)==v[i]
            assert sum(o[6] for o in orders if o[2]==0)==rgmv
            months_data[key] = {'month':key,'orders':orders,'unpaid':visit_buckets}
    metadata = {'seasons':checks,'history':history,'cohorts':eligible,'assortment':FIT,'categories':CATS,'cars':CARS,'scenes':SCENES,
                         'order_fields':['user','paid_date','scene','car','category','sku','amount_cents','refund_type','shipped_date','refund_completed_date','returned_date','touch_path'],
                         'refund_types':['none','pre_shipment_only','shipped_only','return_and_refund'],
                         'unpaid_fields':['scene','car','category','funnel_stage','visits','exposures'],
                         'source':'Synthetic case with historical headline calibration. Unpaid visits aggregated by stratum.'}
    payload = {'metadata':metadata,'months':months_data}
    (ROOT/'mall-data.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')

if __name__=='__main__':
    main()
