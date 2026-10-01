"""ACLED cleaning and panel construction shared by CPython and the browser worker."""
from io import StringIO
import json
import re
import numpy as np
import pandas as pd

AES = ['Mali', 'Burkina Faso', 'Niger']
VIOLENT = ['Battles', 'Explosions/Remote violence', 'Violence against civilians']
RUSSIAN = r'wagner|africa corps|russian|russia(?:n)? military'
JIHADIST = r'jnim|jama.at nusrat|islamic state|is sahel|isgs|aqim|ansar dine|mujao'
DEFAULT_X = ['russian_events_lag1', 'jihadist_events_lag1', 'armed_actor_count_lag1', 'log1p_fatalities_lag1']


class ResearchError(ValueError):
    pass


def read_table(value):
    if isinstance(value, pd.DataFrame):
        return value.copy()
    if value is None or (isinstance(value, str) and value == ''):
        return pd.DataFrame()
    if isinstance(value, str):
        value = value.lstrip('\ufeff')
        if value.lstrip().startswith(('[', '{')):
            value = json.loads(value)
        else:
            separator = '\t' if '\t' in value.splitlines()[0] and ',' not in value.splitlines()[0] else ','
            return pd.read_csv(StringIO(value), sep=separator, dtype=str, keep_default_na=False)
    if isinstance(value, dict):
        value = value.get('data', value.get('events', []))
    return pd.DataFrame(value)


def clean_events(value):
    df = read_table(value)
    if df.empty:
        raise ResearchError('Import an ACLED CSV/JSON export before running an analysis.')
    df.columns = [str(c).strip().lower().replace(' ', '_').lstrip('\ufeff') for c in df.columns]
    required = ['event_id_cnty', 'event_date', 'country', 'event_type', 'actor1', 'actor2']
    missing = [c for c in required if c not in df]
    if missing:
        raise ResearchError('ACLED fields missing: ' + ', '.join(missing) + '. OSINT reports are a different dataset.')
    audit = {'imported_rows': len(df)}
    for col in ['admin1', 'admin2', 'assoc_actor_1', 'assoc_actor_2', 'civilian_targeting', 'sub_event_type']:
        if col not in df:
            df[col] = ''
    for col in df.select_dtypes(include=['object', 'string']).columns:
        df[col] = df[col].fillna('').astype(str).str.strip()
    df['event_date'] = pd.to_datetime(df['event_date'], errors='coerce', format='mixed').dt.normalize()
    bad = df['event_date'].isna() | df['country'].eq('') | df['event_id_cnty'].eq('') | df['event_type'].eq('')
    audit['invalid_required_rows'] = int(bad.sum())
    df = df[~bad].copy()
    # Revisions use the most recent timestamp. Never double-count a revised ID.
    if 'timestamp' in df:
        df['_revision'] = pd.to_numeric(df['timestamp'], errors='coerce').fillna(0)
        df = df.sort_values('_revision', kind='stable')
    audit['duplicate_ids_removed'] = int(df.duplicated('event_id_cnty', keep='last').sum())
    df = df.drop_duplicates('event_id_cnty', keep='last').sort_values('event_date').reset_index(drop=True)
    for col in ['fatalities', 'latitude', 'longitude', 'geo_precision', 'time_precision']:
        df[col] = pd.to_numeric(df[col] if col in df else pd.Series(np.nan, index=df.index), errors='coerce')
    df.loc[(df.fatalities < 0) | (df.fatalities % 1 != 0), 'fatalities'] = np.nan
    df.loc[~df.latitude.between(-90, 90), 'latitude'] = np.nan
    df.loc[~df.longitude.between(-180, 180), 'longitude'] = np.nan
    df['month'] = df.event_date.dt.to_period('M').astype(str)
    actor_text = df[['actor1', 'actor2', 'assoc_actor_1', 'assoc_actor_2']].agg(' | '.join, axis=1)
    df['russian'] = actor_text.str.contains(RUSSIAN, flags=re.I, regex=True).astype(int)
    df['jihadist'] = actor_text.str.contains(JIHADIST, flags=re.I, regex=True).astype(int)
    flag = df.civilian_targeting.str.lower()
    df['civilian'] = (df.event_type.eq('Violence against civilians') | flag.isin(['civilian targeting', '1', 'true', 'yes'])).astype(int)
    df['violent'] = df.event_type.isin(VIOLENT).astype(int)
    audit.update(valid_rows=len(df), missing_admin1=int(df.admin1.eq('').sum()), missing_fatalities=int(df.fatalities.isna().sum()), missing_coordinates=int(df[['latitude', 'longitude']].isna().any(axis=1).sum()), geo_precision_counts={str(k): int(v) for k, v in df.geo_precision.value_counts(dropna=False).items()}, time_precision_counts={str(k): int(v) for k, v in df.time_precision.value_counts(dropna=False).items()})
    if df.empty:
        raise ResearchError('No valid ACLED events remain after validation.')
    return df, audit


def filter_events(df, cfg, outcome_only=False):
    countries = cfg.get('countries') or AES
    out = df[df.country.isin(countries)].copy()
    for key, op in [('start_date', 'ge'), ('end_date', 'le')]:
        if cfg.get(key):
            date = pd.Timestamp(cfg[key])
            out = out[getattr(out.event_date, op)(date)]
    if outcome_only:
        if cfg.get('actor'):
            actors = out[['actor1', 'actor2', 'assoc_actor_1', 'assoc_actor_2']].agg(' | '.join, axis=1)
            out = out[actors.str.contains(re.escape(cfg['actor']), case=False)]
        if cfg.get('event_types'):
            out = out[out.event_type.isin(cfg['event_types'])]
    return out


def assign_units(df, cfg):
    out = df.copy()
    unit = cfg.get('unit', 'admin1_month')
    if unit == 'country_month':
        out['unit_id'] = out.country
    elif unit == 'grid_month':
        cell = float(cfg.get('grid_degrees', 0.5))
        if not 0.1 <= cell <= 2:
            raise ResearchError('Grid width must be between 0.1 and 2 degrees.')
        out = out.dropna(subset=['latitude', 'longitude'])
        out = out[out.geo_precision.le(int(cfg.get('max_geo_precision', 2)))]
        out['grid_lat'] = np.floor(out.latitude / cell) * cell + cell / 2
        out['grid_lon'] = np.floor(out.longitude / cell) * cell + cell / 2
        out['unit_id'] = out.country + '|' + out.grid_lat.round(4).astype(str) + '|' + out.grid_lon.round(4).astype(str)
    else:
        out = out[out.admin1.ne('')].copy()
        out['unit_id'] = out.country + '|' + out.admin1
    return out


def require_coverage(cfg):
    if not cfg.get('coverage_confirmed'):
        raise ResearchError('Confirm that the export covers the entire selected period and countries. Missing observations cannot be treated as zero events.')
    if not cfg.get('start_date') or not cfg.get('end_date'):
        raise ResearchError('Specify the first and last dates of confirmed data coverage.')
    if pd.Timestamp(cfg['end_date']) < pd.Timestamp(cfg['start_date']):
        raise ResearchError('The end date must be on or after the start date.')


def build_panel(df, cfg, covariates=None, roster=None):
    context = assign_units(filter_events(df, cfg), cfg)
    selected = assign_units(filter_events(df, cfg, outcome_only=True), cfg)
    if context.empty:
        raise ResearchError('No events have valid unit identifiers in the selected countries and dates.')
    unit_cols = ['unit_id', 'country'] + (['admin1'] if cfg.get('unit', 'admin1_month') == 'admin1_month' else [])
    universe = context[unit_cols].drop_duplicates('unit_id')
    provided = read_table(roster)
    roster_source = 'units observed at least once in the imported event window'
    if not provided.empty:
        if 'unit_id' not in provided:
            if 'country' not in provided or 'admin1' not in provided:
                raise ResearchError('Unit roster requires unit_id/country or country/admin1 columns.')
            provided['unit_id'] = provided.country if cfg.get('unit') == 'country_month' else provided.country + '|' + provided.admin1
        if 'country' not in provided:
            raise ResearchError('Unit roster requires country.')
        provided = provided[provided.country.isin(cfg.get('countries') or AES)]
        if provided.unit_id.duplicated().any():
            raise ResearchError('The unit roster has duplicate unit_id values.')
        if not set(universe.unit_id) <= set(provided.unit_id):
            raise ResearchError('The unit roster excludes units observed in the selected export.')
        universe = provided
        roster_source = 'user-supplied unit universe'
    if cfg.get('coverage_confirmed'):
        require_coverage(cfg)
        start, end = pd.Timestamp(cfg['start_date']), pd.Timestamp(cfg['end_date'])
    else:
        start, end = context.event_date.min(), context.event_date.max()
    months = pd.period_range(start, end, freq='M').astype(str)
    if len(months) * len(universe) > 150000:
        raise ResearchError('This panel exceeds 150,000 rows. Narrow the dates or use Admin1 units.')
    if cfg.get('coverage_confirmed'):
        panel = universe.merge(pd.DataFrame({'month': months}), how='cross')
    else:
        panel = context[['unit_id', 'month']].drop_duplicates().merge(universe, on='unit_id')
    keys = ['unit_id', 'month']
    counts = selected.groupby(keys).agg(total_events=('event_id_cnty', 'size'), violent_events=('violent', 'sum'), civilian_events=('civilian', 'sum'), fatalities=('fatalities', lambda x: x.sum(min_count=1)), fatalities_missing=('fatalities', lambda x: x.isna().sum())).reset_index()
    panel = panel.merge(counts, on=keys, how='left')
    for c in ['total_events', 'violent_events', 'civilian_events', 'fatalities_missing']:
        panel[c] = panel[c].fillna(0).astype(int)
    # No selected events means zero known fatalities; event rows with missing fatalities remain unknown.
    panel.loc[panel.total_events.eq(0), 'fatalities'] = 0
    panel.loc[panel.fatalities_missing.gt(0), 'fatalities'] = np.nan
    activity = context.groupby(keys).agg(russian_events=('russian', 'sum'), jihadist_events=('jihadist', 'sum'), context_fatalities=('fatalities', lambda x: x.sum(min_count=1)), context_fatalities_missing=('fatalities', lambda x: x.isna().sum())).reset_index()
    panel = panel.merge(activity, on=keys, how='left')
    for c in ['russian_events', 'jihadist_events', 'context_fatalities_missing']:
        panel[c] = panel[c].fillna(0)
    panel.loc[panel.context_fatalities.isna() & panel.context_fatalities_missing.eq(0), 'context_fatalities'] = 0
    panel.loc[panel.context_fatalities_missing.gt(0), 'context_fatalities'] = np.nan
    actor_rows = []
    for (uid, month), g in context.groupby(keys):
        armed = pd.concat([g.actor1, g.actor2, g.assoc_actor_1, g.assoc_actor_2]).str.split(';').explode().str.strip()
        armed = armed[armed.ne('') & ~armed.str.contains(r'civilian|protester', case=False)]
        shares = armed.value_counts(normalize=True)
        actor_rows.append({'unit_id': uid, 'month': month, 'armed_actor_count': len(shares), 'actor_hhi': float((shares ** 2).sum()) if len(shares) else np.nan})
    panel = panel.merge(pd.DataFrame(actor_rows), on=keys, how='left')
    panel['armed_actor_count'] = panel.armed_actor_count.fillna(0)
    panel['civilian_rate'] = np.where(panel.total_events > 0, 100 * panel.civilian_events / panel.total_events, np.nan)
    panel['month_index'] = panel.month.map({m: i for i, m in enumerate(months)})
    # Partial months cannot be compared to complete month counts.
    panel['complete_month'] = panel.month.map(lambda m: pd.Timestamp(m) >= start and pd.Period(m, 'M').end_time.normalize() <= end)
    panel = panel.sort_values(keys).reset_index(drop=True)
    adjacent = panel.groupby('unit_id').month_index.diff().eq(1)
    for col in ['russian_events', 'jihadist_events', 'armed_actor_count', 'context_fatalities', 'civilian_events', 'violent_events', 'total_events', 'actor_hhi']:
        lag_name = 'fatalities_lag1' if col == 'context_fatalities' else col + '_lag1'
        panel[lag_name] = panel.groupby('unit_id')[col].shift(1).where(adjacent)
    panel['log1p_fatalities_lag1'] = np.log1p(panel.fatalities_lag1)
    extra = read_table(covariates)
    if not extra.empty:
        if 'unit_id' not in extra and {'country', 'admin1'} <= set(extra):
            extra['unit_id'] = extra.country if cfg.get('unit') == 'country_month' else extra.country + '|' + extra.admin1
        if not {'unit_id', 'month'} <= set(extra):
            raise ResearchError('Covariates require unit_id/month or country/admin1/month keys.')
        if extra.duplicated(keys).any():
            raise ResearchError('Covariate keys must be unique; duplicate joins would duplicate observations.')
        for c in extra.columns:
            if c not in keys + ['country', 'admin1']:
                if c in panel:
                    raise ResearchError('Covariate would overwrite constructed variable: ' + c)
                extra[c] = pd.to_numeric(extra[c], errors='coerce')
        panel = panel.merge(extra.drop(columns=['country', 'admin1'], errors='ignore'), on=keys, how='left', validate='one_to_one')
    if 'population' in panel:
        panel['population'] = pd.to_numeric(panel.population, errors='coerce')
    return panel, {'unit_universe': roster_source, 'units': len(universe), 'months': len(months), 'panel_rows': len(panel), 'zero_fill': bool(cfg.get('coverage_confirmed')), 'complete_month_rows': int(panel.complete_month.sum()), 'excluded_missing_unit_events': len(filter_events(df, cfg)) - len(context), 'outcome_filters_only': True}


def records(df):
    return json.loads(df.to_json(orient='records', date_format='iso'))


def numeric_summary(s):
    s = pd.to_numeric(s, errors='coerce').dropna()
    if s.empty:
        return {'n': 0}
    return {'n': len(s), 'mean': float(s.mean()), 'median': float(s.median()), 'variance': float(s.var(ddof=1)) if len(s) > 1 else None, 'sd': float(s.std(ddof=1)) if len(s) > 1 else None, 'min': float(s.min()), 'max': float(s.max()), 'zero_share': float(s.eq(0).mean())}


def descriptive(df, panel, cfg):
    selected = filter_events(df, cfg, outcome_only=True)
    series = selected.groupby(['country', 'month']).agg(events=('event_id_cnty', 'size'), civilian_events=('civilian', 'sum'), violent_events=('violent', 'sum'), fatalities=('fatalities', lambda x: x.sum(min_count=1)), missing_fatalities=('fatalities', lambda x: x.isna().sum())).reset_index()
    if cfg.get('coverage_confirmed'):
        series = panel[['country', 'month']].drop_duplicates().merge(series, on=['country', 'month'], how='left')
        for col in ['events', 'civilian_events', 'violent_events', 'missing_fatalities']:
            series[col] = series[col].fillna(0).astype(int)
        series.loc[series.events.eq(0), 'fatalities'] = 0
    series.loc[series.missing_fatalities.gt(0), 'fatalities'] = np.nan
    series['civilian_rate_per_100_events'] = np.where(series.events > 0, series.civilian_events / series.events * 100, np.nan)
    return {'status': 'ok', 'n_events': len(selected), 'n_panel': len(panel), 'series': records(series), 'variables': {col: numeric_summary(panel[col]) for col in ['total_events', 'civilian_events', 'fatalities', 'civilian_rate', 'russian_events', 'actor_hhi']}, 'interpretation': 'Counts are recorded events, not the universe of violence. Missing fatalities stay unknown. Rates use selected events as the denominator.'}
