"""Shared JSON API for the static website worker, CLI, tests and daily pipeline."""
import json
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from research_data import clean_events, build_panel, filter_events, descriptive, records, ResearchError

VERSION = '4.0.0'
METHODS = {
    'descriptive': ('Descriptive statistics', 'Counts, distributions, civilian-targeting rates and monthly series.'),
    'correlation': ('Correlation', 'Pearson and Spearman associations; dependence caveats.'),
    'ols': ('OLS regression', 'Continuous outcomes; robust covariance and fixed effects.'),
    'logistic': ('Civilian-targeting logit', 'Event-level binary outcome; odds ratios.'),
    'poisson': ('Poisson regression', 'Integer counts with optional population log offset.'),
    'negative_binomial': ('Negative binomial', 'NB2 count model with estimated dispersion; incidence-rate ratios.'),
    'zero_inflated': ('Zero-inflated negative binomial', 'Separate structural-zero and count processes.'),
    'hurdle': ('Poisson hurdle', 'Separate zero and truncated-positive-count components.'),
    'fixed_effects': ('Panel fixed effects', 'OLS with unit/calendar-month effects; explicit outcome scale.'),
    'did': ('Difference-in-differences', 'Single common date; unit and calendar-month effects.'),
    'event_study': ('Intervention event study', 'Lead/lag coefficients, reference month and joint pretrend test.'),
    'matching': ('Propensity-score matching', 'Pre-treatment covariates, caliper, balance and matched DiD.'),
    'weighting': ('ATT propensity weighting', 'Pre-treatment scores, overlap trimming, balance and weighted DiD.'),
    'spatial': ('Spatial clustering and KDE', 'Moran I, Gi*, BH adjustment, nearest neighbor and capital distances.'),
    'diffusion': ('Border distance and diffusion', 'User-provided country polygons; cross-border time/distance screening.'),
    'survival': ('Event-history / Cox model', 'Time until next event; recurrent gaps and censoring.'),
    'network': ('Actor-network analysis', 'Degree, betweenness, network density, components and actor HHI.'),
    'forecast': ('Forecasting', 'Expanding-window validation; count and probability forecasts.'),
    'bayesian': ('Bayesian hierarchical Poisson', 'Gaussian country/unit priors with a Laplace posterior approximation.'),
    'robustness': ('Robustness and diagnostics', 'Model family, lag, prior and fixed-effect sensitivity; missingness and fit.')
}


def safe_json(value):
    def convert(v):
        if isinstance(v, dict):
            return {str(k): convert(x) for k, x in v.items()}
        if isinstance(v, (list, tuple, np.ndarray)):
            return [convert(x) for x in v]
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (float, np.floating)):
            return float(v) if np.isfinite(v) else None
        if isinstance(v, (np.bool_,)):
            return bool(v)
        if isinstance(v, (pd.Timestamp,)):
            return v.isoformat()
        return v
    return json.dumps(convert(value), allow_nan=False, ensure_ascii=False)


def robustness(panel, cfg):
    from research_models import regression, bayesian
    cases = [('poisson', 'country_month'), ('negative_binomial', 'country_month'), ('negative_binomial', 'unit_month'), ('negative_binomial', 'country')]
    results = []
    for model, fe in cases:
        try:
            r = regression(panel, {**cfg, 'fixed_effects': fe}, model)
            rows = [x for x in r['coefficients'] if 'russian_events_lag1' in x['term']]
            results.append({'model': model, 'fixed_effects': fe, 'status': 'ok', 'n': r['n'], 'aic': r['diagnostics']['aic'], 'russian_coefficient': rows[0] if rows else None})
        except Exception as error:
            results.append({'model': model, 'fixed_effects': fe, 'status': 'unavailable', 'reason': str(error)})
    return {'status': 'ok', 'specifications': results, 'interpretation': 'Sensitivity of lagged Russian-activity association to likelihood and fixed-effect choices. Report every attempted specification; do not select by p-value.', 'limitations': ['Changing missingness across specifications can change the sample.', 'This does not resolve unmeasured confounding or establish causality.']}


def analyze(payload):
    cfg = dict(payload.get('config', {}))
    method = payload.get('method', 'descriptive')
    if method not in METHODS:
        raise ResearchError('Unknown research method.')
    events, audit = clean_events(payload.get('events'))
    panel, panel_meta = build_panel(events, cfg, payload.get('covariates'), payload.get('roster'))
    if method == 'descriptive':
        result = descriptive(events, panel, cfg)
    elif method in ['correlation', 'ols', 'poisson', 'negative_binomial', 'zero_inflated', 'hurdle', 'fixed_effects', 'logistic', 'bayesian', 'survival']:
        from research_models import correlations, regression, logistic, bayesian, survival
        if method == 'correlation':
            result = correlations(panel, cfg)
        elif method == 'logistic':
            result = logistic(events, cfg)
        elif method == 'bayesian':
            result = bayesian(panel, cfg)
        elif method == 'survival':
            result = survival(events, panel, cfg)
        else:
            if method == 'fixed_effects':
                cfg['fixed_effects'] = 'unit_month'
            result = regression(panel, cfg, 'ols' if method == 'fixed_effects' else method)
    elif method in ['did', 'event_study', 'matching', 'weighting']:
        from research_causal import difference_in_differences, event_study, matched_analysis
        result = difference_in_differences(panel, cfg) if method == 'did' else event_study(panel, cfg) if method == 'event_study' else matched_analysis(panel, cfg, method)
    elif method in ['spatial', 'diffusion', 'network']:
        from research_spatial import spatial, border_diffusion, actor_network
        result = spatial(events, cfg) if method == 'spatial' else actor_network(events, cfg) if method == 'network' else border_diffusion(events, cfg, payload.get('boundaries'))
    elif method == 'forecast':
        from forecasting import forecast
        result = forecast(panel, cfg)
    else:
        result = robustness(panel, cfg)
    result.update(method=method, method_label=METHODS[method][0], software_version=VERSION, generated_at=datetime.now(timezone.utc).isoformat(), source='ACLED', config=cfg, audit=audit, panel_metadata=panel_meta, citation='ACLED (Armed Conflict Location & Event Data). Event export; specify retrieval date, coverage and access tier in published work.')
    return result, panel


def analyze_json(payload_json):
    try:
        payload = json.loads(payload_json)
        result, panel = analyze(payload)
        # Aggregate panel only. Raw event fields and narrative notes never enter results.
        return safe_json({'result': result, 'panel': records(panel), 'panel_csv': panel.to_csv(index=False)})
    except Exception as error:
        return safe_json({'error': str(error), 'error_type': type(error).__name__})


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Run the Sahel Intel ACLED Research Lab reproducibly.')
    parser.add_argument('--events', required=True)
    parser.add_argument('--config', required=True)
    parser.add_argument('--method', choices=METHODS, default='negative_binomial')
    parser.add_argument('--covariates')
    parser.add_argument('--roster')
    parser.add_argument('--boundaries')
    parser.add_argument('--output', default='analysis/output')
    args = parser.parse_args()
    payload = {'events': Path(args.events).read_text(encoding='utf-8-sig'), 'config': json.loads(Path(args.config).read_text()), 'method': args.method}
    for key in ['covariates', 'roster', 'boundaries']:
        if getattr(args, key):
            payload[key] = Path(getattr(args, key)).read_text()
    result, panel = analyze(payload)
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    (output / (args.method + '.json')).write_text(safe_json(result), encoding='utf-8')
    panel.to_csv(output / 'panel.csv', index=False)
    print(safe_json({'method': args.method, 'status': result['status'], 'output': str(output)}))
