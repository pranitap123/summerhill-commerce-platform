// Public API of the reporting module (G5): read models for the back office that combine several
// modules: order search and the one-page order dossier, and the admin metrics.
export { searchOrders, orderDossier } from './orders'
export type { OrderSearchRow, OrderDossier, TimelineEntry } from './orders'
export { computeMetrics, METRIC_DEFINITIONS } from './metrics'
export type { Metrics, MetricName } from './metrics'
