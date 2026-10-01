"""Spherical distances, k-neighbor Moran/Gi*, KDE, borders, and actor networks."""
import json
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.neighbors import BallTree
import networkx as nx
from research_data import ResearchError, filter_events, records


CAPITALS = {'Mali': (12.6392, -8.0029), 'Burkina Faso': (12.3714, -1.5197), 'Niger': (13.5116, 2.1254)}


def haversine_matrix(a, b):
    a, b = np.radians(a), np.radians(b)
    dlat = a[:, None, 0] - b[None, :, 0]
    dlon = a[:, None, 1] - b[None, :, 1]
    h = np.sin(dlat / 2) ** 2 + np.cos(a[:, None, 0]) * np.cos(b[None, :, 0]) * np.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def benjamini_hochberg(p):
    order = np.argsort(p); ranks = np.arange(1, len(p) + 1)
    adjusted = np.minimum.accumulate((np.asarray(p)[order] * len(p) / ranks)[::-1])[::-1]
    q = np.empty(len(p)); q[order] = np.minimum(1, adjusted)
    return q


def spatial(events, cfg):
    d = filter_events(events, cfg, outcome_only=True)
    max_precision = int(cfg.get('max_geo_precision', 2))
    d = d.dropna(subset=['latitude', 'longitude'])
    d = d[d.geo_precision.le(max_precision)]
    if len(d) < 10:
        raise ResearchError('Spatial analysis requires ten geolocated events within the selected precision limit.')
    step = float(cfg.get('grid_degrees', 0.5))
    d = d.assign(grid_lat=np.floor(d.latitude / step) * step + step / 2, grid_lon=np.floor(d.longitude / step) * step + step / 2)
    cells = d.groupby(['country', 'grid_lat', 'grid_lon']).size().reset_index(name='events')
    if len(cells) < 5 or len(cells) > 1200:
        raise ResearchError('Moran/Gi* needs 5–1,200 observed grid cells; change the grid width or dates.')
    coords = cells[['grid_lat', 'grid_lon']].to_numpy()
    distance = haversine_matrix(coords, coords); np.fill_diagonal(distance, np.inf)
    n = len(cells); k = min(int(cfg.get('spatial_neighbors', 4)), n - 1)
    if k < 1:
        raise ResearchError('At least one spatial neighbor is required.')
    W = np.zeros((n, n))
    for i in range(n):
        W[i, np.argsort(distance[i])[:k]] = 1
    W = np.maximum(W, W.T)
    Wr = W / W.sum(axis=1)[:, None]
    x = cells.events.to_numpy(float); z = x - x.mean(); denom = z @ z
    if denom <= 0:
        raise ResearchError('Cell counts have no variance; spatial clustering statistics are undefined.')
    I = float(n / Wr.sum() * (z @ Wr @ z) / denom)
    rng = np.random.default_rng(int(cfg.get('seed', 33)))
    permutations = int(cfg.get('permutations', 199))
    if not 99 <= permutations <= 1999:
        raise ResearchError('Use 99–1,999 spatial permutations.')
    sims = []
    for _ in range(permutations):
        zz = rng.permutation(z); sims.append(float(n / Wr.sum() * (zz @ Wr @ zz) / denom))
    expected = -1 / (n - 1)
    p = (1 + sum(abs(v - expected) >= abs(I - expected) for v in sims)) / (permutations + 1)
    star = W + np.eye(n); sw = star.sum(axis=1)
    S = np.sqrt(np.mean(x ** 2) - x.mean() ** 2)
    denominator = S * np.sqrt(np.maximum(0, (n * (star ** 2).sum(axis=1) - sw ** 2) / (n - 1)))
    gi = np.divide(star @ x - x.mean() * sw, denominator, out=np.full(n, np.nan), where=denominator > 0)
    gp = 2 * stats.norm.sf(np.abs(gi)); gq = benjamini_hochberg(np.nan_to_num(gp, nan=1))
    cells['gi_star_z'] = gi; cells['gi_p_normal'] = gp; cells['gi_q_bh'] = gq
    cells['hotspot'] = np.where((gq <= .05) & (gi > 0), 'hotspot', np.where((gq <= .05) & (gi < 0), 'coldspot', 'not significant'))
    for country, capital in CAPITALS.items():
        mask = cells.country.eq(country)
        cells.loc[mask, 'distance_to_capital_km'] = haversine_matrix(cells.loc[mask, ['grid_lat', 'grid_lon']].to_numpy(), np.array([capital])).ravel()
    # KDE is a visualization of observed event concentration, not a significance test.
    bandwidth = float(cfg.get('kde_bandwidth_km', 50))
    if bandwidth <= 0:
        raise ResearchError('KDE bandwidth must be positive.')
    event_coords = d[['latitude', 'longitude']].to_numpy()
    tree = BallTree(np.radians(event_coords), metric='haversine')
    density = []
    for point in coords:
        near = tree.query_radius(np.radians(point[None]), r=3 * bandwidth / 6371.0088, return_distance=True)
        distances = near[1][0] * 6371.0088
        density.append(float(np.exp(-.5 * (distances / bandwidth) ** 2).sum() / (2 * np.pi * bandwidth ** 2)))
    cells['kde_events_per_km2'] = density
    # Event-level nearest-neighbor mean is descriptive; no CSR index without an area boundary.
    nearest, _ = tree.query(np.radians(event_coords), k=2)
    return {'status': 'ok', 'n_events': len(d), 'n_cells': n, 'moran_i': I, 'moran_expected': expected, 'moran_permutation_p': p, 'permutations': permutations, 'neighbors': k, 'mean_nearest_neighbor_km': float(nearest[:, 1].mean() * 6371.0088), 'kde_bandwidth_km': bandwidth, 'cells': records(cells), 'interpretation': 'Moran tests counts across observed grid cells. Gi* p-values use a normal approximation and BH false-discovery adjustment.', 'limitations': ['Only occupied cells are included; upload a complete spatial universe for population-wide inference. Results are conditional on observed cells.', 'Degree grids have latitude-dependent area and are not PRIO-GRID.', 'KDE and nearest-neighbor distance describe observed concentration, not risk per population.', 'Geolocation uncertainty is filtered, not eliminated.']}


def border_diffusion(events, cfg, border_geojson):
    from shapely.geometry import shape, Point
    from shapely.ops import transform
    if not border_geojson:
        raise ResearchError('Import country-boundary GeoJSON for border-distance and diffusion analysis.')
    geo = json.loads(border_geojson) if isinstance(border_geojson, str) else border_geojson
    polygons = {}
    # Spherical azimuthal equidistant, centered at 15N/0E, no PROJ dependency.
    def project(lon, lat, z=None):
        lon, lat = np.radians(np.asarray(lon)), np.radians(np.asarray(lat))
        phi0 = np.radians(15)
        cosine = np.sin(phi0) * np.sin(lat) + np.cos(phi0) * np.cos(lat) * np.cos(lon)
        c = np.arccos(np.clip(cosine, -1, 1))
        k = np.divide(c, np.sin(c), out=np.ones_like(c), where=np.abs(c) > 1e-12)
        x = 6371008.8 * k * np.cos(lat) * np.sin(lon)
        y = 6371008.8 * k * (np.cos(phi0) * np.sin(lat) - np.sin(phi0) * np.cos(lat) * np.cos(lon))
        return x, y
    for f in geo.get('features', []):
        props = f.get('properties', {})
        country = props.get('country', props.get('name', props.get('ADMIN')))
        if country in (cfg.get('countries') or CAPITALS):
            polygons[country] = transform(project, shape(f['geometry']))
    d = filter_events(events, cfg, outcome_only=True).dropna(subset=['latitude', 'longitude']).copy()
    d = d[d.geo_precision.le(int(cfg.get('max_geo_precision', 2)))]
    if len(polygons) < 2 or len(d) < 10:
        raise ResearchError('At least two named country polygons and ten located events are required.')
    shared = []
    names = list(polygons)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            line = polygons[a].boundary.intersection(polygons[b].boundary)
            if line.is_empty or line.length <= 100:
                continue
            shared.append((a, b, line))
    if not shared:
        raise ResearchError('GeoJSON polygons do not share exact borders. Supply a topologically consistent country-boundary dataset.')
    distances = []
    for row in d.itertuples():
        point = transform(project, Point(row.longitude, row.latitude))
        candidates = [point.distance(line) / 1000 for a, b, line in shared if row.country in [a, b]]
        distances.append(min(candidates) if candidates else np.nan)
    d['shared_border_distance_km'] = distances
    threshold = float(cfg.get('border_km', 50)); days = int(cfg.get('diffusion_days', 30))
    near = d[d.shared_border_distance_km.le(threshold)].sort_values('event_date')
    source = near[near.jihadist.eq(1)]
    # At most one indicator per target event, avoiding a manufactured event count from many pairs.
    hits = []
    for row in near.itertuples():
        prior = source[(source.country != row.country) & (source.event_date < row.event_date) & (source.event_date >= row.event_date - pd.Timedelta(days=days))]
        cross = haversine_matrix(np.array([[row.latitude, row.longitude]]), prior[['latitude', 'longitude']].to_numpy()).ravel() if not prior.empty else []
        hits.append(int(any(x <= threshold for x in cross)))
    near['preceded_by_cross_border_jihadist_event'] = hits
    counts = near.groupby(['country', 'month']).agg(border_events=('event_id_cnty', 'size'), preceded_events=('preceded_by_cross_border_jihadist_event', 'sum'), mean_shared_border_distance_km=('shared_border_distance_km', 'mean')).reset_index()
    return {'status': 'ok', 'border_km': threshold, 'lookback_days': days, 'n_border_events': len(near), 'series': records(counts), 'interpretation': 'Recorded border events preceded by a nearby jihadist event in another country. This is a diffusion screening measure, not a causal estimate.', 'limitations': ['Country polygons must use WGS84 and properties country/name/ADMIN.', 'Border distances use a spherical azimuthal equidistant projection centered on 15N/0E; nonradial distances remain approximate.', 'No territorial-control or deployment footprint is inferred from event coordinates.']}


def actor_network(events, cfg):
    d = filter_events(events, cfg, outcome_only=True)
    graph = nx.Graph()
    for row in d.itertuples():
        a, b = row.actor1, row.actor2
        if a:
            graph.add_node(a)
        if b:
            graph.add_node(b)
        if a and b and a != b:
            old = graph.get_edge_data(a, b, {}).get('weight', 0)
            graph.add_edge(a, b, weight=old + 1, distance=1 / (old + 1))
    if graph.number_of_nodes() < 2 or graph.number_of_edges() == 0:
        raise ResearchError('Actor network needs interactions between at least two named primary actors.')
    if graph.number_of_nodes() > 1500:
        raise ResearchError('Narrow the actor/date filter; network exceeds 1,500 actors.')
    bet = nx.betweenness_centrality(graph, k=min(100, graph.number_of_nodes()), normalized=True, weight='distance', seed=int(cfg.get('seed', 33)))
    degree = nx.degree_centrality(graph)
    weights = dict(graph.degree(weight='weight')); total = sum(weights.values())
    rows = [{'actor': a, 'degree': graph.degree(a), 'weighted_degree': weights[a], 'degree_centrality': degree[a], 'betweenness_centrality': bet[a], 'interaction_share': weights[a] / total} for a in graph]
    edges = [{'actor1': a, 'actor2': b, 'events': e['weight']} for a, b, e in graph.edges(data=True)]
    return {'status': 'ok', 'n_events': len(d), 'n_actors': graph.number_of_nodes(), 'n_edges': graph.number_of_edges(), 'density': nx.density(graph), 'components': nx.number_connected_components(graph), 'actor_hhi': sum((w / total) ** 2 for w in weights.values()), 'nodes': sorted(rows, key=lambda x: -x['weighted_degree']), 'edges': sorted(edges, key=lambda x: -x['events']), 'interpretation': 'Edges count recorded Actor1/Actor2 interactions. Co-occurrence does not mean alliance, hostility, or influence.', 'limitations': ['Actor labels are preserved, not merged into an assumed identity.', 'Weighted betweenness uses inverse interaction counts as edge distance and samples up to 100 pivots.', 'Associated actors enter panel participation counts, but network edges use primary actors only.']}
