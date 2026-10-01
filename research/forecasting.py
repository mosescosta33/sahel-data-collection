"""Chronological backtesting; no random split or future predictor leakage."""
import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor, LogisticRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, mean_poisson_deviance, brier_score_loss, average_precision_score
from research_data import DEFAULT_X, ResearchError, require_coverage


def forecast(panel, cfg):
    require_coverage(cfg)
    target = cfg.get('outcome', 'civilian_events')
    if target not in ['civilian_events', 'violent_events', 'total_events']:
        raise ResearchError('Forecasting supports civilian, violent, or total event counts.')
    predictors = list(cfg.get('predictors', DEFAULT_X))
    if target + '_lag1' not in predictors:
        predictors.append(target + '_lag1')
    if any(x not in panel for x in predictors):
        raise ResearchError('A forecasting predictor is missing from the panel.')
    complete_previous = panel.groupby('unit_id').complete_month.shift(1).eq(True)
    d = panel[panel.complete_month & complete_previous].dropna(subset=predictors + [target]).copy()
    months = sorted(d.month.unique())
    if len(months) < 18 or len(d) < 100:
        raise ResearchError('Forecasting needs 18 covered months and 100 complete observations for chronological validation.')
    if d[target].nunique() < 2:
        raise ResearchError('Forecast target has no variation.')
    # All rows from a validation month are held out together.
    first = max(12, int(len(months) * .65))
    cutpoints = np.linspace(first, len(months), min(5, len(months) - first) + 1).astype(int)
    seed = int(cfg.get('seed', 33))
    def models():
        return {'poisson_ridge': make_pipeline(StandardScaler(), PoissonRegressor(alpha=1, max_iter=600)), 'random_forest': RandomForestRegressor(n_estimators=80, min_samples_leaf=5, max_depth=8, n_jobs=1, random_state=seed)}
    evaluations, predictions, residuals = [], [], {}
    probability_errors = []
    for i, cut in enumerate(cutpoints[:-1]):
        tr = d[d.month.isin(months[:cut])]
        te = d[d.month.isin(months[cut:cutpoints[i + 1]])]
        if te.empty:
            continue
        baseline = te[target + '_lag1'].to_numpy(float)
        evaluations.append({'model': 'last_month_baseline', 'fold': i + 1, 'train_end': months[cut - 1], 'test_start': te.month.min(), 'test_end': te.month.max(), 'n_train': len(tr), 'n_test': len(te), 'mae': mean_absolute_error(te[target], baseline), 'rmse': np.sqrt(mean_squared_error(te[target], baseline)), 'poisson_deviance': mean_poisson_deviance(te[target], np.maximum(baseline, 1e-8))})
        for name, estimator in models().items():
            estimator.fit(tr[predictors], tr[target])
            pred = np.maximum(1e-8, estimator.predict(te[predictors]))
            residuals.setdefault(name, []).extend(np.abs(te[target].to_numpy() - pred).tolist())
            evaluations.append({'model': name, 'fold': i + 1, 'train_end': months[cut - 1], 'test_start': te.month.min(), 'test_end': te.month.max(), 'n_train': len(tr), 'n_test': len(te), 'mae': mean_absolute_error(te[target], pred), 'rmse': np.sqrt(mean_squared_error(te[target], pred)), 'poisson_deviance': mean_poisson_deviance(te[target], pred)})
            for month, obs, fitted in zip(te.month, te[target], pred):
                predictions.append({'model': name, 'month': month, 'observed': int(obs), 'prediction': float(fitted)})
        if tr[target].gt(0).nunique() == 2:
            classifier = make_pipeline(StandardScaler(), LogisticRegression(C=1, max_iter=500, random_state=seed)).fit(tr[predictors], tr[target].gt(0))
            prob = classifier.predict_proba(te[predictors])[:, 1]
            probability_errors.append({'fold': i + 1, 'brier_score': brier_score_loss(te[target].gt(0), prob), 'average_precision': average_precision_score(te[target].gt(0), prob) if te[target].gt(0).any() else None})
    scores = pd.DataFrame(evaluations).groupby('model').mae.mean()
    trained_names = ['poisson_ridge', 'random_forest']
    selected = min(trained_names, key=lambda x: scores[x])
    final_model = models()[selected].fit(d[predictors], d[target])
    latest_month = sorted(panel.loc[panel.complete_month, 'month'].unique())[-1]
    next_month = str(pd.Period(latest_month, 'M') + 1)
    latest = panel[panel.month.eq(latest_month)].copy()
    # Construct next-month predictors from information available at the end of this month.
    for col in predictors:
        if not col.endswith('_lag1'):
            raise ResearchError('Future predictors must be lagged variables; non-lagged covariates require a separate scenario forecast.')
        source = 'context_fatalities' if col in ['fatalities_lag1', 'log1p_fatalities_lag1'] else col[:-5]
        if source not in latest:
            raise ResearchError('Cannot construct next-month feature from current data: ' + col)
        latest[col] = np.log1p(latest[source]) if col == 'log1p_fatalities_lag1' else latest[source]
    latest = latest.dropna(subset=predictors)
    if latest.empty:
        raise ResearchError('No units have a complete latest-month feature vector.')
    expected = np.maximum(0, final_model.predict(latest[predictors]))
    quantile = float(np.quantile(residuals[selected], .9, method='higher'))
    probabilities = None
    if d[target].gt(0).nunique() == 2:
        classifier = make_pipeline(StandardScaler(), LogisticRegression(C=1, max_iter=500, random_state=seed)).fit(d[predictors], d[target].gt(0))
        probabilities = classifier.predict_proba(latest[predictors])[:, 1]
    future = [{'unit_id': row.unit_id, 'country': row.country, 'month': next_month, 'expected_events': float(expected[i]), 'empirical_low': max(0, float(expected[i]) - quantile), 'empirical_high': float(expected[i]) + quantile, 'probability_any_event': float(probabilities[i]) if probabilities is not None else None} for i, row in enumerate(latest.itertuples())]
    return {'status': 'ok', 'model': selected, 'n': len(d), 'predictors': predictors, 'validation': evaluations, 'probability_validation': probability_errors, 'backtest': predictions, 'forecast': future, 'training_end': latest_month, 'interpretation': 'One-month-ahead predictive estimates. Models are selected using expanding-window validation MAE; compare their scores to the persistence baseline.', 'limitations': ['Reported validation is used for model selection; it is not an untouched final test set.', 'Empirical 90th-percentile absolute-error bands are descriptive and do not guarantee 90% coverage under temporal dependence.', 'Predictive associations do not establish causal effects.', 'Reporting changes or structural breaks can invalidate forecasts.']}
