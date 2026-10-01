"""Real estimators, explicit inference metadata, and diagnostic gates."""
import warnings
import numpy as np
import pandas as pd
from scipy import stats, optimize
import statsmodels.api as sm
import statsmodels.formula.api as smf
from patsy import dmatrices
from statsmodels.discrete.count_model import ZeroInflatedNegativeBinomialP
from statsmodels.discrete.truncated_model import HurdleCountModel
from statsmodels.duration.hazard_regression import PHReg
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.diagnostic import het_breuschpagan
from research_data import DEFAULT_X, ResearchError, require_coverage, numeric_summary, records


def model_frame(panel, cfg):
    require_coverage(cfg)
    y = cfg.get('outcome', 'civilian_events')
    predictors = cfg.get('predictors', DEFAULT_X)
    if y not in panel or any(x not in panel for x in predictors):
        raise ResearchError('Outcome or predictor missing from the panel; import the required covariates.')
    if y in predictors:
        raise ResearchError('The outcome cannot also be a predictor.')
    frame = panel[panel.complete_month].copy()
    if not cfg.get('allow_partial_lag'):
        complete_previous = panel.groupby('unit_id').complete_month.shift(1).eq(True)
        if any(x.endswith('_lag1') for x in predictors):
            frame = frame.loc[complete_previous.loc[frame.index]]
    columns = [y] + predictors + (['population'] if cfg.get('population_offset') else [])
    if any(c not in frame for c in columns):
        raise ResearchError('Population offset requires a matched population covariate.')
    n_start = len(frame)
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=columns)
    if cfg.get('population_offset') and (frame.population <= 0).any():
        raise ResearchError('Population offset requires strictly positive population for every observation.')
    if len(frame) < 30:
        raise ResearchError('At least 30 complete, covered observations are required; available: ' + str(len(frame)))
    removed = [x for x in predictors if frame[x].nunique() < 2]
    predictors = [x for x in predictors if x not in removed]
    if frame[y].nunique() < 2:
        raise ResearchError('The outcome has no variation in the selected panel.')
    formula = 'Q("' + y + '") ~ ' + (' + '.join('Q("' + x + '")' for x in predictors) or '1')
    effects = cfg.get('fixed_effects', 'country_month')
    if effects in ['country', 'country_month']:
        formula += ' + C(country)'
    if effects in ['unit', 'unit_month']:
        formula += ' + C(unit_id)'
    if effects in ['country_month', 'unit_month', 'month']:
        formula += ' + C(month)'
    _, design = dmatrices(formula, frame, return_type='dataframe')
    if design.shape[1] > 300:
        raise ResearchError('More than 300 design columns. Narrow the period or simplify fixed effects.')
    rank = np.linalg.matrix_rank(design)
    if rank < design.shape[1]:
        raise ResearchError('The design matrix is rank deficient. Reduce fixed effects or correlated predictors.')
    if len(frame) <= design.shape[1] + 10:
        raise ResearchError('Too few observations for the selected predictors and fixed effects.')
    meta = {'formula': formula, 'outcome': y, 'predictors': predictors, 'constant_predictors_removed': removed, 'n': len(frame), 'complete_cases_removed': n_start - len(frame), 'fixed_effects': effects, 'clusters': int(frame.unit_id.nunique()), 'design_columns': design.shape[1], 'condition_number': float(np.linalg.cond(design)), 'population_offset': bool(cfg.get('population_offset'))}
    return frame, formula, meta


def inference(frame):
    count = frame.unit_id.nunique()
    if count >= 2:
        return {'cov_type': 'cluster', 'cov_kwds': {'groups': frame.unit_id}}, 'Clustered by unit_id (' + str(count) + ' clusters); normal approximation; few clusters can make inference unreliable.'
    return {'cov_type': 'HC1'}, 'HC1 heteroskedasticity-robust; one unit, so cluster inference unavailable.'


def coefficient_rows(fit, ratio=False):
    params = np.asarray(fit.params)
    names = list(getattr(fit.params, 'index', fit.model.exog_names))
    ci = np.asarray(fit.conf_int())
    rows = []
    for i, name in enumerate(names):
        row = {'term': name, 'coefficient': float(params[i]), 'standard_error': float(np.asarray(fit.bse)[i]), 'ci_low': float(ci[i, 0]), 'ci_high': float(ci[i, 1]), 'p_value': float(np.asarray(fit.pvalues)[i])}
        if ratio and name != 'alpha':
            row.update(ratio=float(np.exp(np.clip(params[i], -700, 700))), ratio_low=float(np.exp(np.clip(ci[i, 0], -700, 700))), ratio_high=float(np.exp(np.clip(ci[i, 1], -700, 700))))
        rows.append(row)
    return rows


def regression(panel, cfg, kind):
    frame, formula, meta = model_frame(panel, cfg)
    cov, se = inference(frame)
    y = frame[cfg.get('outcome', 'civilian_events')]
    if kind != 'ols' and ((y < 0).any() or (y % 1 != 0).any()):
        raise ResearchError('Count models require nonnegative integer outcomes.')
    offset = np.log(frame.population) if cfg.get('population_offset') else None
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('always')
        if kind == 'ols':
            if offset is not None:
                raise ResearchError('Population log offsets apply to count models; use a rate outcome for OLS.')
            fit = smf.ols(formula, frame).fit(**cov)
        elif kind == 'poisson':
            fit = smf.glm(formula, frame, family=sm.families.Poisson(), offset=offset).fit(**cov)
        elif kind == 'negative_binomial':
            fit = smf.negativebinomial(formula, frame, offset=offset).fit(method='bfgs', maxiter=300, disp=False, **cov)
        else:
            Y, X = dmatrices(formula, frame, return_type='dataframe')
            if kind == 'zero_inflated':
                fit = ZeroInflatedNegativeBinomialP(np.asarray(Y).ravel(), X, exog_infl=np.ones((len(frame), 1)), offset=offset, p=2).fit(method='bfgs', maxiter=300, disp=False, **cov)
            elif kind == 'hurdle':
                if offset is not None:
                    raise ResearchError('The implemented hurdle estimator has no population offset support.')
                fit = HurdleCountModel(np.asarray(Y).ravel(), X, dist='poisson', zerodist='poisson').fit(maxiter=300, disp=False, cov_type='nonrobust')
                se = 'Model-based standard errors for two Poisson hurdle components; no cluster-robust covariance supported by this estimator.'
            else:
                raise ResearchError('Unknown model: ' + kind)
    converged = getattr(fit, 'converged', getattr(fit, 'mle_retvals', {}).get('converged', True))
    if isinstance(converged, (tuple, list, np.ndarray)):
        converged = all(converged)
    if not converged or not np.isfinite(np.asarray(fit.params)).all() or not np.isfinite(np.asarray(fit.bse)).all():
        raise ResearchError('Estimator did not converge with finite uncertainty estimates. No coefficients are reported. Simplify the specification or use more data.')
    coeffs = coefficient_rows(fit, ratio=kind != 'ols')
    predictions = np.asarray(fit.predict()).ravel()
    residuals = np.asarray(y) - predictions
    alpha = float(fit.params['alpha']) if hasattr(fit.params, 'index') and 'alpha' in fit.params.index else 0
    variance = predictions + max(0, alpha) * predictions ** 2
    bic = fit.bic_llf if hasattr(fit, 'bic_llf') else fit.bic
    diagnostics = {'aic': float(fit.aic), 'bic': float(bic), 'log_likelihood': float(fit.llf), 'outcome_distribution': numeric_summary(y), 'pearson_dispersion': float(np.sum(residuals ** 2 / np.maximum(variance, 1e-9)) / max(1, len(y) - meta['design_columns'])) if kind in ['poisson', 'negative_binomial'] else None, 'rmse_in_sample': float(np.sqrt(np.mean(residuals ** 2))), 'converged': bool(converged), 'warnings': list(dict.fromkeys(str(w.message) for w in captured))[:8]}
    if kind == 'ols':
        diagnostics['r_squared'] = float(fit.rsquared)
        diagnostics['breusch_pagan_p'] = float(het_breuschpagan(fit.resid, fit.model.exog)[1])
    if len(meta['predictors']) > 1:
        base_design = sm.add_constant(frame[meta['predictors']], has_constant='add').to_numpy(float)
        diagnostics['predictor_vif_without_fixed_effects'] = {x: float(variance_inflation_factor(base_design, i + 1)) for i, x in enumerate(meta['predictors'])}
    base = [r for r in coeffs if any('Q("' + x + '")' == r['term'] for x in meta['predictors'])]
    interpret = []
    for row in base:
        if kind == 'ols':
            interpret.append(row['term'] + ': one additional unit is associated with a ' + str(round(row['coefficient'], 3)) + '-unit change in the outcome, conditional on the included predictors and fixed effects.')
        else:
            interpret.append(row['term'] + ': one additional unit is associated with ' + str(round((row['ratio'] - 1) * 100, 1)) + '% change in expected event count/rate, conditional on the included predictors and fixed effects.')
    if kind == 'zero_inflated':
        interpret.append('inflate_const describes the odds of structural-zero membership. Its exponentiated coefficient is not an event-count incidence-rate ratio.')
    if kind == 'hurdle':
        interpret.append('Zero and positive-count processes are estimated separately; component coefficients need component-specific interpretation.')
    return {'status': 'ok', 'model': kind, **meta, 'standard_errors': se, 'coefficients': coeffs, 'diagnostics': diagnostics, 'interpretation': interpret, 'limitations': ['Associational model; deployment is not randomized.', 'Time-varying confounding, reporting bias, and spatial dependence can remain.', 'Unit fixed effects in short nonlinear panels can have incidental-parameter bias.', 'Fewer than 30 independent clusters require particular caution.'], 'fitted': records(pd.DataFrame({'observed': np.asarray(y), 'fitted': predictions, 'residual': residuals}))}


def logistic(events, cfg):
    from research_data import assign_units, filter_events
    frame = assign_units(filter_events(events, cfg, outcome_only=True), cfg)
    if len(frame) < 50 or frame.civilian.nunique() != 2:
        raise ResearchError('Event-level logit needs at least 50 events and both civilian-targeting and non-targeting events.')
    terms = [c for c in ['russian', 'jihadist'] if frame[c].nunique() > 1]
    if not terms:
        raise ResearchError('No variation in the Russian or jihadist participation indicators.')
    formula = 'civilian ~ ' + ' + '.join(terms) + ' + C(country)'
    cov, se = inference(frame)
    with warnings.catch_warnings(record=True) as caught:
        fit = smf.glm(formula, frame, family=sm.families.Binomial()).fit(**cov)
    if not fit.converged or any('separation' in str(w.message).lower() for w in caught) or not np.isfinite(fit.bse).all() or (np.abs(fit.params) > 25).any():
        raise ResearchError('Logit has separation or unstable estimates; no valid coefficients can be reported.')
    return {'status': 'ok', 'model': 'event_logistic', 'n': len(frame), 'formula': formula, 'standard_errors': se, 'coefficients': coefficient_rows(fit, True), 'diagnostics': {'aic': fit.aic, 'brier_score_in_sample': float(np.mean((frame.civilian - fit.predict()) ** 2)), 'converged': True}, 'interpretation': ['Exponentiated coefficients are odds ratios, not probabilities or risk ratios.', 'Estimates describe recorded event participation and civilian targeting; they do not establish causal effects.'], 'limitations': ['Do not filter the sample to civilian events only; that removes outcome variation.', 'Event type is excluded from predictors because it partly defines the outcome.']}


def correlations(panel, cfg):
    require_coverage(cfg)
    rows = []
    y = cfg.get('outcome', 'civilian_events')
    if y not in panel:
        raise ResearchError('The correlation outcome is missing.')
    for x in cfg.get('predictors', DEFAULT_X):
        if x not in panel:
            continue
        d = panel.loc[panel.complete_month, [x, y]].dropna()
        if len(d) < 5 or d[x].nunique() < 2 or d[y].nunique() < 2:
            continue
        p = stats.pearsonr(d[x], d[y]); s = stats.spearmanr(d[x], d[y])
        rows.append({'predictor': x, 'outcome': y, 'n': len(d), 'pearson_r': float(p.statistic), 'pearson_p_naive': float(p.pvalue), 'spearman_rho': float(s.statistic), 'spearman_p_naive': float(s.pvalue)})
    if not rows:
        raise ResearchError('No varying complete predictor/outcome pairs are available.')
    return {'status': 'ok', 'pairs': rows, 'interpretation': 'Pooled associations. Naive p-values assume independent observations and are unsuitable for causal claims or dependent panels.'}


def bayesian(panel, cfg):
    frame, _, meta = model_frame(panel, {**cfg, 'fixed_effects': 'none'})
    yname = cfg.get('outcome', 'civilian_events')
    y = frame[yname].to_numpy(float)
    if (y < 0).any() or (y % 1 != 0).any():
        raise ResearchError('Hierarchical Poisson requires a nonnegative integer outcome.')
    xs = meta['predictors']
    numeric = frame[xs].to_numpy(float)
    scale = numeric.std(axis=0); scale[scale == 0] = 1
    center = numeric.mean(axis=0)
    numeric = (numeric - center) / scale
    countries = pd.get_dummies(frame.country, prefix='country', dtype=float)
    units = pd.get_dummies(frame.unit_id, prefix='unit', dtype=float)
    X = np.column_stack([np.ones(len(frame)), numeric, countries, units])
    names = ['Intercept'] + xs + list(countries) + list(units)
    if X.shape[1] > 180:
        raise ResearchError('The browser Laplace model supports at most 180 parameters.')
    s_country = float(cfg.get('prior_country_sd', 1)); s_unit = float(cfg.get('prior_unit_sd', 1))
    if min(s_country, s_unit) <= 0:
        raise ResearchError('Prior standard deviations must be positive.')
    precision = np.r_[np.full(1 + len(xs), 1 / 2.5 ** 2), np.full(len(countries.columns), 1 / s_country ** 2), np.full(len(units.columns), 1 / s_unit ** 2)]
    off = np.log(frame.population.to_numpy(float)) if cfg.get('population_offset') else np.zeros(len(frame))
    def objective(beta):
        eta = X @ beta + off
        if np.max(eta) > 60:
            return 1e30, np.full_like(beta, 1e20)
        mu = np.exp(eta)
        return float(np.sum(mu - y * eta) + np.sum(precision * beta ** 2) / 2), X.T @ (mu - y) + precision * beta
    initial = np.zeros(X.shape[1]); initial[0] = np.log(max(y.mean(), 0.1)) - np.mean(off)
    fit = optimize.minimize(objective, initial, jac=True, method='L-BFGS-B', options={'maxiter': 600, 'ftol': 1e-11, 'gtol': 1e-6})
    if not fit.success:
        raise ResearchError('Hierarchical posterior optimization failed: ' + fit.message)
    mu = np.exp(X @ fit.x + off)
    H = X.T @ (mu[:, None] * X) + np.diag(precision)
    covariance = np.linalg.inv(H)
    sd = np.sqrt(np.diag(covariance))
    coeffs = [{'term': names[i], 'coefficient': fit.x[i], 'posterior_sd': sd[i], 'credible_low': fit.x[i] - 1.96 * sd[i], 'credible_high': fit.x[i] + 1.96 * sd[i], 'ratio': np.exp(fit.x[i]), 'ratio_low': np.exp(fit.x[i] - 1.96 * sd[i]), 'ratio_high': np.exp(fit.x[i] + 1.96 * sd[i])} for i in range(len(names))]
    return {'status': 'ok', 'model': 'bayesian_hierarchical_poisson_laplace', **meta, 'n': len(frame), 'coefficients': coeffs, 'diagnostics': {'converged': True, 'gradient_max': float(np.max(np.abs(objective(fit.x)[1]))), 'posterior_method': 'Laplace approximation around MAP; not MCMC', 'country_prior_sd': s_country, 'unit_prior_sd': s_unit}, 'interpretation': ['Country and nested administrative-unit intercepts have Gaussian shrinkage priors.', 'Numeric predictors are standardized; ratio is per one standard deviation.', 'Intervals are approximate 95% posterior credible intervals; p-values are not computed.'], 'limitations': ['Prior scales are specified, not estimated; assess sensitivity to both scales.', 'Poisson likelihood may underfit overdispersion.', 'Laplace approximation does not provide R-hat or effective sample size. Use the supplied brms R script for full MCMC.'], 'scaling': [{'term': x, 'mean': center[i], 'sd': scale[i]} for i, x in enumerate(xs)]}


def survival(events, panel, cfg):
    from research_data import assign_units, filter_events
    require_coverage(cfg)
    selected = assign_units(filter_events(events, cfg, outcome_only=True), cfg)
    selected = selected[selected.violent.eq(1)]
    start, end = pd.Timestamp(cfg['start_date']), pd.Timestamp(cfg['end_date'])
    spells = []
    for uid, group in panel.groupby('unit_id'):
        prev = start
        days = sorted(selected.loc[selected.unit_id.eq(uid), 'event_date'].unique())
        for day in days + [end]:
            day = pd.Timestamp(day)
            if day <= prev:
                continue
            baseline = group[group.month.eq(prev.to_period('M').strftime('%Y-%m'))]
            if not baseline.empty:
                row = baseline.iloc[0]
                spells.append({'unit_id': uid, 'duration_days': (day - prev).days, 'observed_attack': int(day in days), 'country': row.country, **{x: row.get(x, np.nan) for x in cfg.get('predictors', DEFAULT_X)}})
            prev = day
    d = pd.DataFrame(spells).dropna()
    xs = [x for x in cfg.get('predictors', DEFAULT_X) if x in d and d[x].nunique() > 1]
    if len(d) < 30 or d.observed_attack.sum() < 15 or not xs:
        raise ResearchError('Event-history analysis needs 30 complete spells, 15 observed attacks, and varying predictors.')
    fit = PHReg(d.duration_days.to_numpy(float), d[xs].to_numpy(float), status=d.observed_attack.to_numpy(int), strata=d.country).fit(groups=d.unit_id)
    if not np.isfinite(fit.params).all() or not np.isfinite(fit.bse).all():
        raise ResearchError('Cox model uncertainty is not finite; simplify the specification.')
    ci = fit.conf_int()
    rows = [{'term': x, 'coefficient': fit.params[i], 'standard_error': fit.bse[i], 'ci_low': ci[i, 0], 'ci_high': ci[i, 1], 'p_value': fit.pvalues[i], 'ratio': np.exp(fit.params[i]), 'ratio_low': np.exp(ci[i, 0]), 'ratio_high': np.exp(ci[i, 1])} for i, x in enumerate(xs)]
    return {'status': 'ok', 'model': 'recurrent_gap_time_cox', 'n': len(d), 'attacks': int(d.observed_attack.sum()), 'coefficients': rows, 'standard_errors': 'Robust covariance grouped by unit_id; country-stratified baseline hazard.', 'interpretation': ['Exponentiated coefficients are hazard ratios for the next recorded violent event.', 'Spells end at an observed event or are censored at coverage end; same-day attacks are collapsed.'], 'limitations': ['Covariates are frozen at spell start; proportional hazards is an assumption, not established here.', 'The first spell begins at coverage start; the last pre-coverage attack is unknown.'], 'spells': records(d[['duration_days', 'observed_attack']])}
