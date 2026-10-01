"""Common-date DiD/event studies and baseline-only matching/ATT weighting."""
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from research_data import DEFAULT_X, ResearchError, require_coverage
from research_models import coefficient_rows, inference


def design(panel, cfg):
    require_coverage(cfg)
    if not cfg.get('intervention_date') or not cfg.get('treated_units'):
        raise ResearchError('Specify an intervention month and treated countries/unit IDs. Dates are research decisions, not inferred from an actor name.')
    month = pd.Period(cfg['intervention_date'], 'M')
    d = panel[panel.complete_month].copy()
    treated = set(cfg['treated_units'])
    d['treated'] = (d.unit_id.isin(treated) | d.country.isin(treated)).astype(int)
    d['relative_month'] = d.month.map(lambda x: pd.Period(x, 'M').ordinal - month.ordinal)
    d['post'] = d.relative_month.ge(0).astype(int)
    d['did'] = d.treated * d.post
    y = cfg.get('outcome', 'civilian_events')
    if y not in d:
        raise ResearchError('The selected causal outcome is unavailable.')
    d = d.dropna(subset=[y])
    if d.treated.nunique() < 2 or d.post.nunique() < 2:
        raise ResearchError('DiD needs treated and untreated units observed before and after the intervention.')
    units = d.groupby('unit_id').post.nunique()
    d = d[d.unit_id.isin(units[units.eq(2)].index)]
    if len(d) < 30 or d.treated.nunique() < 2:
        raise ResearchError('At least 30 complete observations with pre/post support in both groups are required.')
    return d, y


def difference_in_differences(panel, cfg, weighted=None):
    d, y = design(panel, cfg)
    if weighted is not None:
        d = d[d.unit_id.isin(weighted)].copy()
        d['att_weight'] = d.unit_id.map(weighted)
        if d.treated.nunique() < 2:
            raise ResearchError('Both treatment groups must survive weighting/matching.')
    formula = 'Q("' + y + '") ~ did + C(unit_id) + C(month)'
    cov, se = inference(d)
    mod = smf.wls(formula, d, weights=d.att_weight) if weighted is not None else smf.ols(formula, d)
    fit = mod.fit(**cov)
    if np.linalg.matrix_rank(fit.model.exog) < fit.model.exog.shape[1] or not np.isfinite(fit.bse).all():
        raise ResearchError('DiD specification is unidentified or has non-finite standard errors.')
    effect = next(r for r in coefficient_rows(fit) if r['term'] == 'did')
    means = d.groupby(['treated', 'post'])[y].mean().reset_index().to_dict('records')
    return {'status': 'ok', 'model': 'common_date_difference_in_differences', 'n': len(d), 'units': int(d.unit_id.nunique()), 'treated_units': int(d.loc[d.treated.eq(1), 'unit_id'].nunique()), 'control_units': int(d.loc[d.treated.eq(0), 'unit_id'].nunique()), 'formula': formula, 'intervention_date': cfg['intervention_date'], 'coefficients': [effect], 'standard_errors': se, 'group_means': means, 'interpretation': ['Estimated treated-versus-control change: ' + str(round(effect['coefficient'], 3)) + ' outcome units.', 'Causal interpretation additionally requires parallel untreated trends, no anticipation, and no differential shocks or spillovers.'], 'limitations': ['This estimator is for one common intervention date, not staggered adoption.', 'Treating a whole country can leave very few independent treatment clusters.', 'ACLED records Russian activity, not the full footprint of deployment.']}


def event_study(panel, cfg):
    d, y = design(panel, cfg)
    window = int(cfg.get('event_window', 12))
    if not 3 <= window <= 36:
        raise ResearchError('Event-study window must be between 3 and 36 months.')
    available = sorted(d.relative_month.unique())
    if -1 not in available or len([k for k in available if k < -1]) < 2 or len([k for k in available if k >= 0]) < 2:
        raise ResearchError('Event study requires the reference month -1, two earlier leads, and two post-intervention months.')
    d['event_bin'] = d.relative_month.clip(-window, window)
    terms, mapping = [], {}
    for k in sorted(d.event_bin.unique()):
        if k == -1:
            continue
        name = 'lead_' + str(abs(k)) if k < 0 else 'lag_' + str(k)
        d[name] = d.treated * d.event_bin.eq(k)
        if d[name].sum() > 0:
            terms.append(name); mapping[name] = int(k)
    formula = 'Q("' + y + '") ~ ' + ' + '.join(terms) + ' + C(unit_id) + C(month)'
    cov, se = inference(d)
    fit = smf.ols(formula, d).fit(**cov)
    if np.linalg.matrix_rank(fit.model.exog) < fit.model.exog.shape[1] or not np.isfinite(fit.bse).all():
        raise ResearchError('Event-study design is rank deficient or has unstable uncertainty estimates.')
    rows = [dict(r, relative_month=mapping[r['term']]) for r in coefficient_rows(fit) if r['term'] in mapping]
    lead_terms = [t for t in terms if mapping[t] < -1]
    joint_p = float(fit.wald_test(', '.join(t + ' = 0' for t in lead_terms), scalar=True).pvalue) if lead_terms else None
    rows.append({'term': 'reference', 'relative_month': -1, 'coefficient': 0, 'ci_low': 0, 'ci_high': 0, 'p_value': None})
    return {'status': 'ok', 'model': 'common_date_event_study', 'n': len(d), 'formula': formula, 'coefficients': sorted(rows, key=lambda r: r['relative_month']), 'standard_errors': se, 'diagnostics': {'pretrend_joint_p': joint_p, 'reference_month': -1, 'endpoint_bins': [-window, window]}, 'interpretation': ['Coefficients compare treated/control outcome differences against the month before intervention.', 'Endpoint bins pool all earlier/later observations beyond the selected window.', 'A non-significant lead test does not prove parallel trends.'], 'limitations': ['Common adoption date only; no staggered-treatment TWFE claim.', 'Country-level treatment and cross-border spillovers can invalidate unit-level cluster inference.']}


def matched_analysis(panel, cfg, kind='weighting'):
    d, y = design(panel, cfg)
    xs = cfg.get('matching_covariates') or ['civilian_events', 'violent_events', 'russian_events', 'jihadist_events', 'armed_actor_count']
    if any(x not in d for x in xs):
        raise ResearchError('A requested matching covariate is missing.')
    baseline = d[d.post.eq(0)].groupby('unit_id')[xs + ['treated']].mean().dropna()
    xs = [x for x in xs if baseline[x].nunique() > 1]
    if len(baseline) < 8 or baseline.treated.nunique() < 2 or not xs:
        raise ResearchError('Matching/weighting needs eight baseline-complete units, both treatment groups, and varying pre-treatment covariates.')
    X = StandardScaler().fit_transform(baseline[xs])
    propensity_model = LogisticRegression(C=1, max_iter=1000, random_state=33).fit(X, baseline.treated)
    p = propensity_model.predict_proba(X)[:, 1]
    baseline['propensity'] = p
    support = (p >= 0.05) & (p <= 0.95)
    b = baseline.loc[support].copy()
    if b.treated.nunique() < 2:
        raise ResearchError('There is no common propensity-score support after trimming to [0.05, 0.95].')
    if kind == 'weighting':
        b['weight'] = np.where(b.treated.eq(1), 1, b.propensity / (1 - b.propensity))
        pairs = []
    else:
        score = np.log(b.propensity / (1 - b.propensity))
        caliper = 0.2 * score.std(ddof=1)
        controls = list(b.index[b.treated.eq(0)])
        matched, pairs = [], []
        for uid in b.index[b.treated.eq(1)]:
            if not controls:
                break
            other = min(controls, key=lambda cid: abs(score[uid] - score[cid]))
            if abs(score[uid] - score[other]) <= caliper:
                matched.extend([uid, other]); pairs.append({'treated': uid, 'control': other, 'logit_distance': float(abs(score[uid] - score[other]))}); controls.remove(other)
        if len(pairs) < 2:
            raise ResearchError('Fewer than two pairs meet the 0.2-SD logit propensity caliper; matching is unsupported.')
        b = b.loc[matched].copy(); b['weight'] = 1.0
    balance = []
    for x in xs:
        a0, a1 = baseline.loc[baseline.treated.eq(0), x], baseline.loc[baseline.treated.eq(1), x]
        denom = np.sqrt((a0.var(ddof=0) + a1.var(ddof=0)) / 2)
        before = (a1.mean() - a0.mean()) / denom if denom > 0 else None
        c, t = b[b.treated.eq(0)], b[b.treated.eq(1)]
        after = (np.average(t[x], weights=t.weight) - np.average(c[x], weights=c.weight)) / denom if denom > 0 else None
        balance.append({'covariate': x, 'smd_before': before, 'smd_after': after})
    result = difference_in_differences(panel, cfg, b.weight.to_dict())
    result.update(model=kind + '_difference_in_differences', balance=balance, propensity=baseline[['treated', 'propensity']].to_dict('records'), matched_pairs=len(pairs), retained_units=len(b), trimmed_units=len(baseline) - len(b), effective_sample_size=float(b.weight.sum() ** 2 / (b.weight ** 2).sum()))
    result['limitations'].append('Propensity scores use L2-regularized logistic regression and pre-treatment means only. Unmeasured confounding remains; uncertainty is conditional on estimated weights/matches.')
    return result
