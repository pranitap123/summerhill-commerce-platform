import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api'
import type { SpanExporter } from '@opentelemetry/sdk-trace-base'

/**
 * OpenTelemetry tracing (G6-08, OPERATIONS §2). Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (or a
 * test passes an exporter): without a registered provider every call here is a no-op, so nothing
 * changes for tests or a plain `npm run dev`.
 *
 * One checkout is one trace across processes: W3C trace context travels in the outbox event
 * (`_trace`, moved into the job by the relay) and in the Checkout Session's metadata, which Stripe
 * hands back on the webhook. Only ids and parameterised SQL are recorded, never values.
 */
export interface TraceCarrier {
  traceparent?: string
  tracestate?: string
}

const tracer = () => trace.getTracer('grocery-marketplace')

/** The active trace context, to hand to another process; null when tracing is off. */
export function currentTraceCarrier(): TraceCarrier | null {
  const carrier: TraceCarrier = {}
  propagation.inject(context.active(), carrier)
  return carrier.traceparent ? carrier : null
}

/** Runs `fn` in a new span, a child of `parent` when given (else of the active span). */
export async function inSpan<T>(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: TraceCarrier | null },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const ctx = options.parent?.traceparent
    ? propagation.extract(context.active(), options.parent)
    : context.active()
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    ctx,
    async (span) => {
      try {
        return await fn(span)
      } catch (err) {
        span.recordException(err as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

export { SpanKind }

let started = false

/**
 * Registers the tracer provider (W3C propagation, async context) and the pg and undici (fetch,
 * Elasticsearch) instrumentations. Call before `pg` is first imported. Returns whether tracing is on.
 */
export async function startTracing(service: string, exporter?: SpanExporter): Promise<boolean> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (started || (!exporter && !endpoint)) return started
  const [{ NodeTracerProvider }, base, { resourceFromAttributes }, { registerInstrumentations }] =
    await Promise.all([
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/instrumentation'),
    ])
  const [{ PgInstrumentation }, { UndiciInstrumentation }] = await Promise.all([
    import('@opentelemetry/instrumentation-pg'),
    import('@opentelemetry/instrumentation-undici'),
  ])
  const processor = exporter
    ? new base.SimpleSpanProcessor(exporter)
    : new base.BatchSpanProcessor(
        new (await import('@opentelemetry/exporter-trace-otlp-http')).OTLPTraceExporter(),
      )
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? `grocery-${service}`,
    }),
    spanProcessors: [processor],
  })
  provider.register()
  registerInstrumentations({
    instrumentations: [
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new UndiciInstrumentation(),
    ],
  })
  started = true
  return true
}
